"""时间工具:日期一律按配置时区计算(避免 UTC/本地混用导致差一天)。"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_tz = ZoneInfo("Asia/Shanghai")
_frozen: datetime | None = None  # 测试用:冻结「现在」


def set_timezone(name: str) -> None:
    global _tz
    _tz = ZoneInfo(name)


def freeze(dt: datetime | None) -> None:
    global _frozen
    _frozen = dt


def now_dt() -> datetime:
    if _frozen is not None:
        return _frozen.astimezone(_tz) if _frozen.tzinfo else _frozen.replace(tzinfo=_tz)
    return datetime.now(_tz)


def now() -> str:
    """分钟精度的本地时间串,与前端一致:YYYY-MM-DD HH:MM"""
    return now_dt().strftime("%Y-%m-%d %H:%M")


def today() -> str:
    return now_dt().strftime("%Y-%m-%d")


def add_days(d: str, n: int) -> str:
    return (date.fromisoformat(d[:10]) + timedelta(days=n)).isoformat()


def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b[:10]) - date.fromisoformat(a[:10])).days
