from collections import deque
from datetime import UTC, datetime, timedelta

_requests: deque[tuple[datetime, str, int, float]] = deque(maxlen=5000)


def record_request(path: str, status: int, duration_ms: float) -> None:
    _requests.append((datetime.now(UTC), path, status, duration_ms))


def request_metrics(minutes: int = 15) -> dict:
    cutoff = datetime.now(UTC) - timedelta(minutes=minutes)
    rows = [row for row in _requests if row[0] >= cutoff and row[1].startswith("/api/")]
    durations = sorted(row[3] for row in rows)
    errors = sum(1 for row in rows if row[2] >= 500)

    def percentile(value: float) -> float:
        if not durations:
            return 0.0
        index = min(len(durations) - 1, max(0, round((len(durations) - 1) * value)))
        return round(durations[index], 2)

    slowest = sorted(rows, key=lambda row: row[3], reverse=True)[:10]
    return {
        "window_minutes": minutes,
        "requests": len(rows),
        "errors": errors,
        "error_rate": round(errors * 100 / len(rows), 2) if rows else 0.0,
        "p50_ms": percentile(0.50),
        "p95_ms": percentile(0.95),
        "p99_ms": percentile(0.99),
        "slowest": [{"path": path, "status": status, "duration_ms": round(duration, 2), "at": at} for at, path, status, duration in slowest],
    }
