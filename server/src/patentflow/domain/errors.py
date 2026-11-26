from __future__ import annotations


class DomainError(Exception):
    """业务错误:API 层统一转成 {status, code, message} JSON。"""

    def __init__(self, status: int, code: str, message: str, **extra: object) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra


def not_found(what: str = "资源") -> DomainError:
    return DomainError(404, "not_found", f"{what}不存在或不在你的可见范围内")


def forbidden(msg: str = "没有权限执行该操作") -> DomainError:
    return DomainError(403, "forbidden", msg)


def bad_request(msg: str, code: str = "invalid", **extra: object) -> DomainError:
    return DomainError(400, code, msg, **extra)


def conflict(msg: str, **extra: object) -> DomainError:
    return DomainError(409, "conflict", msg, **extra)
