"""Request-scoped timings. No SQL text, document data or credentials."""
from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from time import perf_counter


@dataclass
class RequestTiming:
    query_count: int = 0
    query_ms: float = 0.0
    operations: dict[str, float] = field(default_factory=lambda: defaultdict(float))


current_timing: ContextVar[RequestTiming | None] = ContextVar("ims_request_timing", default=None)


@contextmanager
def timed_operation(name: str):
    timing = current_timing.get()
    start = perf_counter()
    try:
        yield
    finally:
        if timing is not None:
            timing.operations[name] += (perf_counter() - start) * 1000
