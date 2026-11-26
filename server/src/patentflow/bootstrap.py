"""启动引导:建表后初始化业务配置。

账号兜底不再依赖「某些业务用户保底为 GL」,而是由配置文件中的系统管理员(sysadmin)负责:
它不是业务用户,登录独立后台,可重置密码、恢复账号、指定 GL、为首次部署建团队与首个 GL。
"""
from __future__ import annotations

from .config import Settings
from .db import Database
from .domain.sysconfig import get_system, merged_defaults, save_system


async def ensure_bootstrap(db: Database, settings: Settings) -> None:
    async with db.tx() as conn:
        async with conn.execute("SELECT 1 FROM settings WHERE key='system'") as cur:
            has_cfg = await cur.fetchone()
        if not has_cfg:
            await save_system(conn, merged_defaults(settings.initial_business))
        else:
            await save_system(conn, await get_system(conn))
