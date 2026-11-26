"""Aadhaar document storage check and cleanup (25 Nov 2026, final 26 Nov 2026).

IMS does not collect, store or retain personal Aadhaar information (team instruction, 26 Nov 2026). This script checks
the application-managed document storage (FILE_STORAGE_ROOT) and the document metadata, and removes what is left:

  * Aadhaar documents: service-job documents whose type or file name says Aadhaar (Udyog Aadhaar / MSME is not one),
    including ones already deleted in the app (the app keeps their files);
  * orphan files: files in FILE_STORAGE_ROOT that no row in `files` points to. The app can never show them, so they are
    unnecessary copies. Their names are random, so their contents are unknown; they are removed too.

Usage (from the backend folder, with the venv's python and the API's env file):
    .venv\\Scripts\\python scripts\\aadhaar_documents.py --env-file <file> inventory        # read only
    .venv\\Scripts\\python scripts\\aadhaar_documents.py --env-file <file> delete           # dry run: lists what would go
    .venv\\Scripts\\python scripts\\aadhaar_documents.py --env-file <file> delete --confirm # removes it

Run it on the machine that holds FILE_STORAGE_ROOT for the live API. Take and verify a backup first
(scripts/backup_db.py), then let the old backups expire (`backup_db.py prune`), see docs/DPDP_AADHAAR_REMOVAL.md.

Printed: document id, job code, upload date, size, whether the file exists — never file names (they may hold a person's
name) and never contents. On --confirm, each Aadhaar document's file is overwritten and removed, its metadata is scrubbed
(file name, type and checksum) and the rows are marked deleted, so the job history still shows that a document existed.
Overwriting is best effort (SSDs and backups keep copies), which is why backups must also expire.
"""
import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))


def load_env_file(path: str | None) -> None:
    if not path:
        return
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def find_documents(db):
    from sqlalchemy import select

    from app.models import File, ServiceJob, ServiceJobDocument
    from app.routers.jobs import mentions_aadhaar

    rows = db.execute(select(ServiceJobDocument, File, ServiceJob.job_code)
                      .join(File, File.id == ServiceJobDocument.file_id)
                      .join(ServiceJob, ServiceJob.id == ServiceJobDocument.job_id)
                      .order_by(ServiceJobDocument.id)).all()
    return [(d, f, job) for d, f, job in rows if mentions_aadhaar(f"{d.document_type or ''} {f.original_name}")]


def find_orphans(db, root: Path) -> list[Path]:
    from sqlalchemy import select

    from app.models import File

    if not root.is_dir():
        return []
    known = {(root / k).resolve() for k in db.scalars(select(File.storage_key))}
    return sorted(p for p in root.rglob("*") if p.is_file() and p.resolve() not in known)


def shred(path: Path) -> None:
    size = path.stat().st_size
    with open(path, "r+b") as fh:  # best-effort overwrite before unlinking
        fh.write(os.urandom(size))
        fh.flush()
        os.fsync(fh.fileno())
    path.unlink()


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Aadhaar document storage check and cleanup")
    p.add_argument("--env-file")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inventory")
    d = sub.add_parser("delete")
    d.add_argument("--confirm", action="store_true", help="really remove (default: dry run)")
    a = p.parse_args(argv)
    load_env_file(a.env_file)

    from app.common import audit, now
    from app.config import settings
    from app.db import SessionLocal

    root = Path(settings.file_storage_root).resolve()
    with SessionLocal() as db:
        found = find_documents(db)
        orphans = find_orphans(db, root)
        total = sum(f.size_bytes or 0 for _, f, _ in found)
        print(f"Storage checked: {root}")
        print(f"Aadhaar documents: {len(found)} ({sum(1 for x, _, _ in found if x.deleted_at is None)} visible in the app, "
              f"{sum(1 for x, _, _ in found if x.deleted_at is not None)} deleted in the app), {total / 1048576:.2f} MB")
        for doc, f, job in found:
            path = (root / f.storage_key).resolve()
            exists = path.is_file() and root in path.parents
            print(f"  doc {doc.id:>6}  job {job:<16} uploaded {doc.created_at:%Y-%m-%d}  {f.size_bytes or 0:>9} bytes  "
                  f"file {'present' if exists else 'missing'}{'  (deleted in app)' if doc.deleted_at else ''}")
        print(f"Orphan files (no database row, unreachable from the app): {len(orphans)}, "
              f"{sum(o.stat().st_size for o in orphans) / 1048576:.2f} MB")
        if a.cmd == "inventory":
            return 0
        if not a.confirm:
            print("\nDry run: nothing removed. Take and verify a backup, then add --confirm.")
            return 0

        removed = 0
        for doc, f, job in found:
            path = (root / f.storage_key).resolve()
            if root not in path.parents:
                print(f"  doc {doc.id}: storage path outside FILE_STORAGE_ROOT, skipped")
                continue
            if path.is_file():
                shred(path)
                removed += 1
            t = now()
            ext = f.original_name.rsplit(".", 1)[-1].lower() if "." in f.original_name else "bin"
            f.original_name = f"removed.{ext}"[:255]      # the old name could hold a person's name
            f.checksum = None
            f.deleted_at = f.deleted_at or t
            doc.document_type = "Removed document"
            doc.deleted_at = doc.deleted_at or t
        for o in orphans:
            shred(o)
        audit(db, None, "AADHAAR_DOCUMENTS_DELETED", "Service Job", "documents",
              f"Aadhaar document cleanup: {len(found)} documents ({removed} files) and {len(orphans)} orphan files removed",
              after={"documents": len(found), "files_removed": removed, "orphan_files_removed": len(orphans)})
        db.commit()
        print(f"\nRemoved: {removed} Aadhaar document files ({len(found)} rows scrubbed and marked deleted) and "
              f"{len(orphans)} orphan files. Audit entry written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
