from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    app_name: str = "IMS API"
    api_v1_prefix: str = "/api/v1"
    database_url: str
    frontend_origin: str = "http://127.0.0.1:5173"
    institute_timezone: str = "Asia/Kolkata"
    file_storage_root: str = "./storage"
    max_upload_mb: int = 5
    log_level: str = "INFO"
    expose_docs: bool | None = None  # default: on outside production

    # Security seam (owned by the security developer; values must be agreed with them)
    session_hours: int = 12
    session_idle_minutes: int = 30
    login_max_attempts: int = 5
    login_lock_minutes: int = 15
    aadhaar_enc_key: str | None = None  # Fernet key (urlsafe base64, 32 bytes)
    aadhaar_hash_key: str | None = None  # HMAC key for exact-match Aadhaar search

    @property
    def production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def docs_enabled(self) -> bool:
        return (not self.production) if self.expose_docs is None else self.expose_docs

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.institute_timezone)


settings = Settings()

if settings.production:  # fail fast instead of discovering missing secrets on the first Aadhaar entry
    missing = [k for k in ("aadhaar_enc_key", "aadhaar_hash_key") if not getattr(settings, k)]
    if missing:
        raise RuntimeError(f"Production start refused: set {', '.join(m.upper() for m in missing)}")
