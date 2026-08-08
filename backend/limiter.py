try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address
except ModuleNotFoundError:
    from collections import defaultdict, deque
    from functools import wraps
    import inspect
    from time import monotonic
    from fastapi.responses import JSONResponse

    class RateLimitExceeded(Exception):
        pass

    def get_remote_address(request):
        return request.client.host if request and request.client else "unknown"

    async def _rate_limit_exceeded_handler(request, exc):
        return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})

    class Limiter:
        def __init__(self, key_func):
            self.key_func = key_func
            self._hits = defaultdict(deque)

        def limit(self, limit_value):
            max_requests, window_seconds = self._parse_limit(limit_value)

            def decorator(func):
                signature = inspect.signature(func)

                @wraps(func)
                async def wrapper(*args, **kwargs):
                    bound = signature.bind_partial(*args, **kwargs)
                    request = bound.arguments.get("request")
                    key = self.key_func(request)
                    now = monotonic()
                    hits = self._hits[(key, limit_value)]
                    while hits and hits[0] <= now - window_seconds:
                        hits.popleft()
                    if len(hits) >= max_requests:
                        raise RateLimitExceeded(limit_value)
                    hits.append(now)
                    return await func(*args, **kwargs)

                return wrapper

            return decorator

        @staticmethod
        def _parse_limit(limit_value):
            count, period = limit_value.split("/", 1)
            windows = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}
            return int(count), windows[period.rstrip("s")]


limiter = Limiter(key_func=get_remote_address)
