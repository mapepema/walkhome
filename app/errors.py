"""Errors that map 1:1 onto the API's ``{detail, code?}`` error body."""

from __future__ import annotations

from typing import Optional


class WalkhomeError(Exception):
    """A failure the client should see, with an HTTP status and a stable code."""

    def __init__(self, detail: str, status: int = 400, code: Optional[str] = None):
        super().__init__(detail)
        self.detail = detail
        self.status = status
        self.code = code


class NotFound(WalkhomeError):
    def __init__(self, detail: str = "not found", code: Optional[str] = None):
        super().__init__(detail, 404, code)


class Conflict(WalkhomeError):
    def __init__(self, detail: str, code: Optional[str] = None):
        super().__init__(detail, 409, code)


class Forbidden(WalkhomeError):
    def __init__(self, detail: str = "forbidden", code: Optional[str] = None):
        super().__init__(detail, 403, code)


class Unauthorized(WalkhomeError):
    def __init__(self, detail: str = "authentication required", code: str = "unauthenticated"):
        super().__init__(detail, 401, code)


class TooManyRequests(WalkhomeError):
    def __init__(self, detail: str, retry_after_s: int = 60):
        super().__init__(detail, 429, "rate_limited")
        self.retry_after_s = retry_after_s
