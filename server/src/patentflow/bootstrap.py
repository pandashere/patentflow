"""启动引导:建表后确保配置文件管理员存在且为 GL(防锁死的恢复通道)。"""
from __future__ import annotations

from .config import Settings
from .db import Database
from .domain.sysconfig import get_system, merged_defaults, save_system
from .security import new_id
from .timeutil import now


async def ensure_bootstrap(db: Database, settings: Settings) -> None:
    async with db.tx() as conn:
        async with conn.execute("SELECT 1 FROM settings WHERE key='system'") as cur:
            has_cfg = await cur.fetchone()
        if not has_cfg:
            await save_system(conn, merged_defaults(settings.initial_business))
        else:
            cfg = await get_system(conn)
            await save_system(conn, cfg)

        if settings.admins:
            async with conn.execute("SELECT id FROM teams ORDER BY id LIMIT 1") as cur:
                team = await cur.fetchone()
            team_id = team["id"] if team else "t-default"
            if not team:
                await conn.execute("INSERT INTO teams(id, name, pl_id) VALUES('t-default', '默认团队', NULL)")
            for email in settings.admins:
                async with conn.execute("SELECT id, role FROM users WHERE email = ?", (email,)) as cur:
                    u = await cur.fetchone()
                if u is None:
                    await conn.execute(
                        "INSERT INTO users(id, name, email, role, team_id, created_at) VALUES(?,?,?,?,?,?)",
                        (new_id("u-"), email.split("@")[0], email, "gl", team_id, now()),
                    )
                elif u["role"] != "gl":
                    await conn.execute(
                        "UPDATE users SET role='gl', session_epoch = session_epoch + 1 WHERE id=?", (u["id"],)
                    )
