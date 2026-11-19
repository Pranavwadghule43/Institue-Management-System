import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("ims")


def database_unavailable(e: Exception) -> bool:
    if not isinstance(e, DBAPIError):
        return False
    state = getattr(e.orig, "sqlstate", None)
    # psycopg can omit SQLSTATE when the pooler rejects a connection before it opens.
    return e.connection_invalidated or (
        isinstance(e, OperationalError) and e.statement is None and (not state or state[:2] in {"08", "28"})
    )


def log_failure(logger: logging.Logger, context: str, e: Exception) -> None:
    cause = e.orig if isinstance(e, DBAPIError) else e
    state = getattr(cause, "sqlstate", None)
    # DB error strings can contain connection details, bound values, and rejected rows.
    # Log the exception types and stack frames without rendering exception messages or locals.
    reason = "-"
    if database_unavailable(e):
        message = str(cause).lower()
        if "password authentication failed" in message or state == "28P01":
            reason = "database password authentication failed"
        elif "failed to resolve host" in message:
            reason = "database host resolution failed"
        else:
            reason = "database connection unavailable"
    frames = "\n".join(f"  {frame.filename}:{frame.lineno} in {frame.name}" for frame in traceback.extract_tb(e.__traceback__))
    logger.error("%s error=%s cause=%s sqlstate=%s reason=%s\n%s", context, type(e).__name__, type(cause).__name__,
                 state or "-", reason, frames)


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, field_errors: dict | None = None):
        self.status, self.code, self.message, self.field_errors = status, code, message, field_errors or {}


def not_found(what: str) -> AppError:
    return AppError(404, f"{what.upper().replace(' ', '_')}_NOT_FOUND", f"{what.capitalize()} not found.")


def bad(code: str, message: str, field: str | None = None) -> AppError:
    return AppError(400, code, message, {field: message} if field else None)


def conflict(code: str, message: str) -> AppError:
    return AppError(409, code, message)


# DB constraint / trigger name -> deterministic business error.
CONSTRAINT_ERRORS = {
    "students_enquiry_id_key": ("ENQUIRY_ALREADY_CONVERTED", "This enquiry is already converted to a student."),
    "one_non_cancelled_bill_per_job": ("BILL_ALREADY_EXISTS", "This service job already has a current bill."),
    "users_username_key": ("USERNAME_TAKEN", "Username already taken."),
    "courses_code_key": ("COURSE_CODE_EXISTS", "A course with this code already exists."),
    "course_subtypes_course_id_name_key": ("SUBTYPE_EXISTS", "This sub-type already exists for the course."),
    "service_categories_name_key": ("CATEGORY_EXISTS", "A category with this name already exists."),
    "expense_categories_name_key": ("CATEGORY_EXISTS", "A category with this name already exists."),
    "services_service_code_key": ("SERVICE_CODE_EXISTS", "A service with this code already exists."),
    "student_payments_idempotency_key_key": ("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for another request."),
    "service_payments_idempotency_key_key": ("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for another request."),
    "service_payments_bill_id_key": ("BILL_ALREADY_PAID", "This bill is already paid."),
}


def integrity_to_app_error(e: IntegrityError) -> AppError:
    text = str(e.orig)
    if "IMS_ACCOUNT_LIMIT_REACHED" in text:
        if "role=ADMIN" in text:
            return conflict("ADMIN_ACCOUNT_LIMIT_REACHED", "Only one Admin account is allowed for this institute.")
        return conflict("STAFF_ACCOUNT_LIMIT_REACHED", "A maximum of 4 Staff accounts is allowed for this institute.")
    for name, (code, message) in CONSTRAINT_ERRORS.items():
        if name in text:
            return conflict(code, message)
    log.warning("unmapped integrity error: %s", type(e.orig).__name__)
    return conflict("CONFLICT", "The request conflicts with existing data.")


def _body(code: str, message: str, field_errors: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "field_errors": field_errors or {}}}


def install(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app(_: Request, e: AppError):
        return JSONResponse(_body(e.code, e.message, e.field_errors), status_code=e.status)

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, e: IntegrityError):
        err = integrity_to_app_error(e)
        return JSONResponse(_body(err.code, err.message), status_code=err.status)

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def _validation(_: Request, e: RequestValidationError | ValidationError):
        skip = 1 if isinstance(e, RequestValidationError) else 0  # drop the "body"/"query" prefix
        fields = {".".join(str(p) for p in err["loc"][skip:]) or "body": err["msg"].removeprefix("Value error, ") for err in e.errors()}
        return JSONResponse(_body("VALIDATION_ERROR", "Some fields are invalid.", fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(e.status_code, "HTTP_ERROR")
        return JSONResponse(_body(code, str(e.detail)), status_code=e.status_code, headers=getattr(e, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, e: Exception):
        route = getattr(request.scope.get("route"), "path", "<unmatched>")
        log_failure(log, f"unhandled error on {request.method} {route}", e)
        return JSONResponse(_body("INTERNAL_ERROR", "Something went wrong. Please try again."), status_code=500)
