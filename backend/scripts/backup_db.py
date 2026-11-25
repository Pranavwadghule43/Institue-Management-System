"""Encrypted IMS backups and restore (23 Nov 2026 security patch SEC-02).

One backup = one encrypted file holding the full database dump plus the service-job documents folder:
    ims-backup-YYYYMMDD-HHMMSS.imsbak

Usage (Windows PowerShell, from the backend folder, with the venv's python):
    .venv\\Scripts\\python scripts\\backup_db.py new-key                       # once: prints a backup key; keep it in a password manager
    .venv\\Scripts\\python scripts\\backup_db.py backup  --out D:\\IMS-Backups  # make a backup (keeps the newest 30)
    .venv\\Scripts\\python scripts\\backup_db.py verify  D:\\IMS-Backups\\ims-backup-....imsbak
    .venv\\Scripts\\python scripts\\backup_db.py restore D:\\IMS-Backups\\ims-backup-....imsbak --to-url <SPARE database URL> --files-to D:\\restore-files

Settings come from environment variables (or the same --env-file the API uses):
    DATABASE_URL       database to back up (read access to every table is enough)
    BACKUP_ENC_KEY     Fernet key from `new-key`. Different from DATA_ENC_KEY, and stored separately from the backups.
    FILE_STORAGE_ROOT  documents folder to include (optional)
    PG_BIN             folder with pg_dump / pg_restore of the SAME or NEWER major version as the server (optional;
                       defaults to PATH, then the PostgreSQL that ships with pgserver)

The restore refuses to write into the database named in DATABASE_URL: always restore into a spare database first and
check it. Restoring over the live database is a deliberate manual step for the database owner.
"""
import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

from cryptography.fernet import Fernet, InvalidToken

MAGIC = b"IMSBAK1\n"
KEEP = 30


def load_env_file(path: str | None) -> None:
    if not path:
        return
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def libpq_url(url: str) -> tuple[str, str | None]:
    """SQLAlchemy URL -> plain libpq URL for pg_dump, with the password moved to PGPASSWORD (never on the command line)."""
    url = url.replace("postgresql+psycopg://", "postgresql://", 1).replace("postgres+psycopg://", "postgresql://", 1)
    parts = urlsplit(url)
    password = unquote(parts.password) if parts.password else None
    netloc = parts.netloc.rsplit("@", 1)
    if len(netloc) == 2:
        user = netloc[0].split(":", 1)[0]
        netloc_clean = f"{user}@{netloc[1]}"
    else:
        netloc_clean = parts.netloc
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if k != "password"])
    return urlunsplit((parts.scheme, netloc_clean, parts.path, query, "")), password


def tool(name: str) -> str:
    folder = os.environ.get("PG_BIN")
    exe = name + (".exe" if os.name == "nt" else "")
    if folder and (Path(folder) / exe).exists():
        return str(Path(folder) / exe)
    if found := shutil.which(name):
        return found
    try:
        import pgserver  # noqa: PLC0415 - optional, ships PostgreSQL binaries for local use

        bundled = Path(pgserver.__file__).parent / "pginstall" / "bin" / exe
        if bundled.exists():
            return str(bundled)
    except ImportError:
        pass
    sys.exit(f"{name} not found. Install the PostgreSQL client tools (same or newer version as the server) and set PG_BIN.")


def fernet() -> Fernet:
    key = os.environ.get("BACKUP_ENC_KEY")
    if not key:
        sys.exit("Set BACKUP_ENC_KEY (create one with: backup_db.py new-key).")
    if key in {os.environ.get("DATA_ENC_KEY"), os.environ.get("AADHAAR_ENC_KEY")} - {None}:
        sys.exit("BACKUP_ENC_KEY must be different from DATA_ENC_KEY (the document key).")
    return Fernet(key)


def run(cmd: list[str], password: str | None) -> None:
    env = dict(os.environ)
    if password:
        env["PGPASSWORD"] = password
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"{Path(cmd[0]).name} failed:\n{result.stderr.strip()[-2000:]}")


def backup(out: Path) -> Path:
    url, password = libpq_url(os.environ["DATABASE_URL"])
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    with tempfile.TemporaryDirectory() as tmp:
        dump = Path(tmp) / "database.dump"
        # --enable-row-security: works for the limited ims_api role too (its RLS policies show it every row).
        run([tool("pg_dump"), "--format=custom", "--no-owner", "--no-privileges", "--enable-row-security", "--file", str(dump), url], password)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(dump, "database.dump")
            root = os.environ.get("FILE_STORAGE_ROOT")
            count = 0
            if root and Path(root).is_dir():
                for f in sorted(Path(root).rglob("*")):
                    if f.is_file():
                        z.write(f, "files/" + f.relative_to(root).as_posix())
                        count += 1
            z.writestr("README.txt", f"IMS backup {stamp}\nDatabase: pg_dump custom format\nDocuments: {count} files (already encrypted with DATA_ENC_KEY)\n")
    target = out / f"ims-backup-{stamp}.imsbak"
    target.write_bytes(MAGIC + fernet().encrypt(buf.getvalue()))
    old = sorted(out.glob("ims-backup-*.imsbak"))[:-KEEP]
    for f in old:
        f.unlink()
    print(f"Backup written: {target} ({target.stat().st_size // 1024} KB, {count} documents). Removed {len(old)} old backup(s).")
    return target


def open_backup(path: Path) -> zipfile.ZipFile:
    raw = path.read_bytes()
    if not raw.startswith(MAGIC):
        sys.exit("Not an IMS backup file.")
    try:
        return zipfile.ZipFile(io.BytesIO(fernet().decrypt(raw[len(MAGIC):])))
    except InvalidToken:
        sys.exit("Can't decrypt: wrong BACKUP_ENC_KEY or the file is damaged.")


def verify(path: Path) -> None:
    z = open_backup(path)
    bad = z.testzip()
    if bad or "database.dump" not in z.namelist():
        sys.exit(f"Backup damaged ({bad or 'database.dump missing'}).")
    with tempfile.TemporaryDirectory() as tmp:
        dump = Path(tmp) / "database.dump"
        dump.write_bytes(z.read("database.dump"))
        listing = subprocess.run([tool("pg_restore"), "--list", str(dump)], capture_output=True, text=True)
        if listing.returncode != 0:
            sys.exit("database.dump can't be read by pg_restore.")
    tables = sum(1 for line in listing.stdout.splitlines() if " TABLE DATA " in line)
    files = sum(1 for n in z.namelist() if n.startswith("files/"))
    print(f"OK: {path.name} decrypts, {tables} tables with data, {files} documents.")


def restore(path: Path, to_url: str, files_to: Path | None) -> None:
    live, _ = libpq_url(os.environ.get("DATABASE_URL", ""))
    target, password = libpq_url(to_url)
    if live and urlsplit(live)._replace(query="") == urlsplit(target)._replace(query=""):
        sys.exit("Refusing to restore into DATABASE_URL (the live database). Restore into a spare database and check it first.")
    z = open_backup(path)
    with tempfile.TemporaryDirectory() as tmp:
        dump = Path(tmp) / "database.dump"
        dump.write_bytes(z.read("database.dump"))
        run([tool("pg_restore"), "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", target, str(dump)], password)
    if files_to:
        names = [n for n in z.namelist() if n.startswith("files/") and not n.endswith("/")]
        for n in names:
            rel = Path(n[len("files/"):])
            if rel.is_absolute() or ".." in rel.parts:
                sys.exit(f"Unsafe path in backup: {n}")
            dest = files_to / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(z.read(n))
        print(f"Documents restored: {len(names)} files into {files_to}")
    print("Database restored into the spare database. Open the app against it and check before using it.")


def main(argv: list[str]) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--env-file", help="read settings from this file (e.g. C:\\Projects\\ims-local\\local.env)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("new-key")
    b = sub.add_parser("backup")
    b.add_argument("--out", required=True, type=Path)
    v = sub.add_parser("verify")
    v.add_argument("file", type=Path)
    r = sub.add_parser("restore")
    r.add_argument("file", type=Path)
    r.add_argument("--to-url", required=True)
    r.add_argument("--files-to", type=Path)
    a = p.parse_args(argv)
    load_env_file(a.env_file)
    if a.cmd == "new-key":
        print(Fernet.generate_key().decode())
        print("Save this key in a password manager, NOT next to the backups. Without it the backups can't be opened.", file=sys.stderr)
    elif a.cmd == "backup":
        if not os.environ.get("DATABASE_URL"):
            sys.exit("Set DATABASE_URL or pass --env-file.")
        backup(a.out)
    elif a.cmd == "verify":
        verify(a.file)
    else:
        restore(a.file, a.to_url, a.files_to)


if __name__ == "__main__":
    main(sys.argv[1:])
