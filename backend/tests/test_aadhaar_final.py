"""Final Aadhaar removal (26 Nov 2026): no Aadhaar in the schema or code paths, and old backups expire."""
import importlib.util
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

from app import models
from app.config import Settings

AADHAAR = re.compile(r"(aadhaa?r|aadhar|adhaar|adhar|uidai)", re.I)
ROOT = Path(__file__).resolve().parents[1]


def test_no_model_maps_an_aadhaar_column():
    found = [f"{t.name}.{c.name}" for t in models.Base.metadata.sorted_tables for c in t.columns
             if AADHAAR.search(c.name) and "udyog" not in c.name.lower()]
    assert found == []


def test_no_aadhaar_specific_crypto_or_reveal_left():
    from app import common
    for name in ("aadhaar_hash", "aadhaar_decrypt", "aadhaar_mask", "aadhaar_columns", "OptAadhaar"):
        assert not hasattr(common, name), name
    assert "aadhaar_hash_key" not in Settings.model_fields
    app_src = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "app").rglob("*.py"))
    assert not re.search(r"/aadhaar[\"'/]", app_src)                 # no reveal routes
    assert "aadhaar_ciphertext" not in app_src and "aadhaar_lookup_hash" not in app_src and "aadhaar_last4" not in app_src


def test_final_migration_is_guarded_and_drops_only_the_six_columns():
    sql = (ROOT / "sql" / "2026-11-26_aadhaar_final_removal.sql").read_text(encoding="utf-8")
    assert sql.count("BEGIN;") == 1 and "COMMIT;" in sql
    assert "Stopped, nothing changed" in sql                          # preflight stops on values / unrelated dependents
    assert " CASCADE" not in sql.upper()                              # RESTRICT only: never takes unrelated objects with it
    dropped = re.findall(r"DROP COLUMN IF EXISTS (\w+)", sql)
    assert sorted(dropped) == sorted(["aadhaar_ciphertext", "aadhaar_last4", "aadhaar_lookup_hash"] * 2)
    assert re.findall(r"ALTER TABLE public\.(\w+)\s+DROP COLUMN", sql) == ["students", "enquiries"]
    assert "DELETE FROM" not in sql.upper() and "UPDATE public." not in sql   # no rows changed
    assert not (ROOT / "sql" / "2026-11-25_aadhaar_DELETE_requires_approval.sql").exists()


def _load_backup_module():
    spec = importlib.util.spec_from_file_location("backup_db", ROOT / "scripts" / "backup_db.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _fake_backups(folder: Path, ages_days: list[int]) -> list[Path]:
    out = []
    for age in ages_days:
        stamp = (datetime.now() - timedelta(days=age)).strftime("%Y%m%d-%H%M%S")
        f = folder / f"ims-backup-{stamp}.imsbak"
        f.write_bytes(b"x")
        out.append(f)
    return out


def test_backups_older_than_keep_days_expire(tmp_path, monkeypatch):
    mod = _load_backup_module()
    monkeypatch.setenv("BACKUP_KEEP_DAYS", "30")
    old, mid, new = _fake_backups(tmp_path, [45, 31, 2])
    keep = _fake_backups(tmp_path, [29])[0]
    mod.prune(tmp_path, dry_run=True)
    assert all(p.exists() for p in (old, mid, new, keep))            # dry run removes nothing
    mod.prune(tmp_path)
    assert not old.exists() and not mid.exists() and new.exists() and keep.exists()


def test_the_newest_backup_is_never_deleted(tmp_path, monkeypatch):
    mod = _load_backup_module()
    monkeypatch.setenv("BACKUP_KEEP_DAYS", "7")
    a, b = _fake_backups(tmp_path, [90, 60])
    mod.prune(tmp_path)
    assert not a.exists() and b.exists()                              # the only remaining (newest) backup stays


def test_keep_days_must_be_valid(tmp_path, monkeypatch):
    mod = _load_backup_module()
    monkeypatch.setenv("BACKUP_KEEP_DAYS", "0")
    _fake_backups(tmp_path, [1])
    try:
        mod.prune(tmp_path)
    except SystemExit as e:
        assert "BACKUP_KEEP_DAYS" in str(e)
    else:
        raise AssertionError("expected SystemExit")
    assert os.listdir(tmp_path)
