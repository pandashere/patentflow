from __future__ import annotations

from ..config import Settings
from ..db import Database
from ..notify import Notifier


async def run_reminders(db: Database, settings: Settings, notifier: Notifier) -> int:  # 占位,后续提交实现
    return 0
