"""Per-user request limits for endpoints that can be abused for bulk copying or heavy work (23 Nov security patch SEC-11).

Counts are kept in this process's memory (a sliding one-minute window). With several uvicorn workers each worker counts
separately, so the effective limit is the number below times the worker count: still a firm cap on scraping.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends

from .errors import AppError
from .security import CurrentUser, get_current_user

WINDOW_SECONDS = 60
LIMITS = {
    "search": 60,          # Ctrl+K search
    "export": 30,          # Excel report downloads
    "document": 60,        # service-job document downloads
    "upload": 30,          # service-job document uploads
    "whatsapp": 20,        # automatic WhatsApp PDF sends
}

_hits: dict[tuple[str, int], deque] = defaultdict(deque)
_lock = threading.Lock()


def check(bucket: str, user_id: int, at: float | None = None) -> int:
    """0 when the call may go ahead (and is counted), otherwise the seconds until it may."""
    t = time.monotonic() if at is None else at
    with _lock:
        q = _hits[(bucket, user_id)]
        while q and q[0] <= t - WINDOW_SECONDS:
            q.popleft()
        if len(q) >= LIMITS[bucket]:
            return max(1, int(q[0] + WINDOW_SECONDS - t) + 1)
        q.append(t)
        return 0


def reset() -> None:
    with _lock:
        _hits.clear()


def limited(bucket: str):
    if bucket not in LIMITS:
        raise ValueError(bucket)

    def dep(user: CurrentUser = Depends(get_current_user)) -> None:
        if wait := check(bucket, user.id):
            raise AppError(429, "RATE_LIMITED", f"Too many requests. Try again in {wait} seconds.", headers={"Retry-After": str(wait)})
    return dep
