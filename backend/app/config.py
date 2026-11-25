from zoneinfo import ZoneInfo

from pydantic import AliasChoices, Field, SecretStr
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
    login_lock_minutes: int = 15  # longest wait after repeated wrong passwords (the wait grows from login_wait_seconds)
    login_wait_seconds: int = 30
    password_hash_n: int = 2**17  # scrypt cost (OWASP: N=2^17, r=8, p=1 -> 128 MiB per hash)
    password_hash_parallel: int = 2  # at most this many hashes at once, so sign-in floods can't exhaust memory
    # Data-encryption key (Fernet, urlsafe base64, 32 bytes) for uploaded documents. 25 Nov 2026 (DPDP, Aadhaar removed):
    # IMS no longer collects Aadhaar, so the key is now named DATA_ENC_KEY; the old name AADHAAR_ENC_KEY is still read so
    # existing servers keep working and older encrypted files stay readable. AADHAAR_HASH_KEY is no longer used.
    data_enc_key: str | None = Field(None, validation_alias=AliasChoices("data_enc_key", "aadhaar_enc_key"))
    whatsapp_enabled: bool = False
    whatsapp_access_token: SecretStr = SecretStr("")
    whatsapp_app_secret: SecretStr = SecretStr("")
    whatsapp_verify_token: SecretStr = SecretStr("")
    whatsapp_phone_number_id: str = ""
    whatsapp_graph_version: str = ""
    whatsapp_receipt_template: str = ""
    whatsapp_bill_template: str = ""
    whatsapp_template_language: str = "en"
    whatsapp_pdf_font: str = ""

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

def production_problems(s: Settings) -> list[str]:
    """Settings that make a production server unsafe (23 Nov security patch SEC-08). Empty list = OK."""
    problems = [] if s.data_enc_key else ["set DATA_ENC_KEY (documents are encrypted with it)"]
    for origin in s.origins:
        host = origin.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0].lower()
        if not origin.lower().startswith("https://") or host in ("localhost", "127.0.0.1", "0.0.0.0"):
            problems.append(f"FRONTEND_ORIGIN must be the real https:// web address (got {origin})")
    if not s.origins:
        problems.append("set FRONTEND_ORIGIN to the real https:// web address")
    if s.expose_docs:
        problems.append("EXPOSE_DOCS must be off in production")
    if s.password_hash_n < 2**17:
        problems.append("PASSWORD_HASH_N must be at least 131072 in production")
    db = s.database_url.lower()
    local_db = any(h in db for h in ("@localhost", "@127.0.0.1", "host=/", "@/"))
    if not local_db and "sslmode=verify-full" not in db:
        problems.append("DATABASE_URL must end with ?sslmode=verify-full&sslrootcert=<CA file> (SEC-13)")
    return problems


if settings.production:  # fail fast instead of discovering an unsafe setting after go-live
    if problems := production_problems(settings):
        raise RuntimeError("Production start refused: " + "; ".join(problems))
