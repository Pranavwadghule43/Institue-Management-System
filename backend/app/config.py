from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    app_name: str = "IMS API"
    api_v1_prefix: str = "/api/v1"
    database_url: str
    frontend_origin: str = "http://localhost:5173"
    institute_timezone: str = "Asia/Kolkata"
    file_storage_root: str = "./storage"
    max_upload_mb: int = 5
    log_level: str = "INFO"
    expose_docs: bool = True

    # Security seam (owned by the security developer; values must be agreed with them)
    session_hours: int = 12
    login_max_attempts: int = 5
    login_lock_minutes: int = 15
    aadhaar_enc_key: str | None = None  # Fernet key (urlsafe base64, 32 bytes)
    aadhaar_hash_key: str | None = None  # HMAC key for exact-match Aadhaar search

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.institute_timezone)


settings = Settings()
