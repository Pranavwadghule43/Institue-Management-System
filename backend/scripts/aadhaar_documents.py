"""Aadhaar document inventory and approved deletion (25 Nov 2026, TASK A5).

IMS no longer accepts Aadhaar documents. This script finds the ones uploaded before that, without opening them, and
(only with --confirm, after written approval) removes the files from FILE_STORAGE_ROOT and marks the rows deleted.

Usage (from the backend folder, with the venv's python and the API's env file):
    .venv\\Scripts\\python scripts\\aadhaar_documents.py --env-file C:\\Projects\\ims-local\\local.env inventory
    .venv\\Scripts\\python scripts\\aadhaar_documents.py --env-file <file> delete            # dry run: lists what would go
    .venv\\Scripts\\python scripts\\aadhaar_documents.py --env-file <file> delete --confirm  # really deletes (needs approval)

What is printed: document id, job code, upload date, size, whether the file exists — never the file name (it may hold a
person's name) and never the contents. Documents already deleted in the app are included: the app keeps their files.
Before `delete --confirm`: take and verify an encrypted backup (scripts/backup_db.py) and get written approval; see
docs/DPDP_AADHAAR_REMOVAL.md. Overwriting before unlinking is best effort only (SSDs and backups keep copies), which is
why files uploaded after 23 Nov are also encrypted with DATA_ENC_KEY.
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


def find(db):
    from sqlalchemy import select

    from app.models import File, ServiceJob, ServiceJobDocument
    from app.routers.jobs import mentions_aadhaar

    rows = db.execute(select(ServiceJobDocument, File, ServiceJob.job_code)
                      .join(File, File.id == ServiceJobDocument.file_id)
                      .join(ServiceJob, ServiceJob.id == ServiceJobDocument.job_id)
                      .order_by(ServiceJobDocument.id)).all()
    return [(d, f, job) for d, f, job in rows if mentions_aadhaar(f"{d.document_type or ''} {f.original_name}")]


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Aadhaar document inventory / approved deletion")
    p.add_argument("--env-file")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inventory")
    d = sub.add_parser("delete")
    d.add_argument("--confirm", action="store_true", help="really delete (default: dry run)")
    a = p.parse_args(argv)
    load_env_file(a.env_file)

    from app.common import audit, now
    from app.config import settings
    from app.db import SessionLocal

    root = Path(settings.file_storage_root).resolve()
    with SessionLocal() as db:
        found = find(db)
        total = sum(f.size_bytes or 0 for _, f, _ in found)
        print(f"Aadhaar documents found: {len(found)} ({sum(1 for x, _, _ in found if x.deleted_at is None)} visible in the app, "
              f"{sum(1 for x, _, _ in found if x.deleted_at is not None)} deleted in the app), {total / 1048576:.2f} MB")
        for doc, f, job in found:
            path = (root / f.storage_key).resolve()
            exists = path.is_file() and root in path.parents
            print(f"  doc {doc.id:>6}  job {job:<16} uploaded {doc.created_at:%Y-%m-%d}  {f.size_bytes or 0:>9} bytes  "
                  f"file {'present' if exists else 'missing'}{'  (deleted in app)' if doc.deleted_at else ''}")
        if a.cmd == "inventory":
            return 0
        if not a.confirm:
            print("\nDry run: nothing deleted. Add --confirm after written approval and a verified backup.")
            return 0
        removed = 0
        for doc, f, job in found:
            path = (root / f.storage_key).resolve()
            if root not in path.parents:
                print(f"  doc {doc.id}: storage path outside FILE_STORAGE_ROOT, skipped")
                continue
            if path.is_file():
                size = path.stat().st_size
                with open(path, "r+b") as fh:  # best-effort overwrite before unlinking
                    fh.write(os.urandom(size))
                    fh.flush()
                    os.fsync(fh.fileno())
                path.unlink()
                removed += 1
            t = now()
            doc.deleted_at = doc.deleted_at or t
            f.deleted_at = f.deleted_at or t
        audit(db, None, "AADHAAR_DOCUMENTS_DELETED", "Service Job", "documents",
              f"Approved Aadhaar document removal: {len(found)} documents, {removed} files removed from storage",
              after={"documents": len(found), "files_removed": removed})
        db.commit()
        print(f"\nDeleted: {removed} files removed, {len(found)} document rows marked deleted. Audit entry written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
