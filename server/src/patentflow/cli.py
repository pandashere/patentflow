"""命令行:patentflow serve | seed | set-password"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

from .config import load_settings
from .db import Database


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="patentflow", description="PATENTFLOW 专利状态跟踪系统")
    ap.add_argument("--config", default=None, help="配置文件路径(默认 patentflow.config.yaml 或 $PATENTFLOW_CONFIG)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="启动服务")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    sd = sub.add_parser("seed", help="导入演示数据(所有演示账号密码 demo1234)")
    sd.add_argument("--force", action="store_true", help="清空现有业务数据后导入")
    sp = sub.add_parser("set-password", help="为账号设置本地密码(首个管理员登录用)")
    sp.add_argument("email")
    sp.add_argument("--password", default=None)
    args = ap.parse_args(argv)

    if args.config:
        os.environ["PATENTFLOW_CONFIG"] = args.config
    settings = load_settings()

    if args.cmd == "serve":
        import uvicorn

        from .app import create_app

        uvicorn.run(create_app(settings), host=args.host, port=args.port)
        return

    async def with_db(fn):  # type: ignore[no-untyped-def]
        from .bootstrap import ensure_bootstrap

        db = Database(settings.db_path)
        await db.connect()
        try:
            await ensure_bootstrap(db, settings)
            return await fn(db)
        finally:
            await db.close()

    if args.cmd == "seed":
        from .seed import DEMO_PASSWORD, seed

        try:
            r = asyncio.run(with_db(lambda db: seed(db, force=args.force)))
        except RuntimeError as e:
            sys.exit(str(e))
        print(f"已导入 {r['users']} 个账号、{r['patents']} 件专利;演示密码:{DEMO_PASSWORD}")
    elif args.cmd == "set-password":
        pw = args.password or getpass.getpass("新密码(≥8 位):")
        if len(pw) < 8:
            sys.exit("密码至少 8 位")
        from .security import hash_password

        async def go(db: Database) -> int:
            async with db.tx() as conn:
                cur = await conn.execute(
                    "UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1 WHERE email = ?",
                    (hash_password(pw), args.email.strip().lower()))
                return cur.rowcount

        if not asyncio.run(with_db(go)):
            sys.exit("账号不存在")
        print("密码已更新")


if __name__ == "__main__":
    main()
