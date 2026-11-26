"""测试辅助:直接写库建团队/用户(跳过 API),并提供登录后的客户端。"""
from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from patentflow.security import hash_password

PWD = "secret123"


def db_exec(client: TestClient, sql: str, params: tuple = ()) -> None:
    path = client.app.state.settings.db_path  # type: ignore[attr-defined]
    with sqlite3.connect(path) as c:
        c.execute(sql, params)


def add_team(client: TestClient, tid: str, name: str, pl: str | None = None) -> None:
    db_exec(client, "INSERT OR REPLACE INTO teams(id, name, pl_id) VALUES(?,?,?)", (tid, name, pl))


def add_user(client: TestClient, uid: str, role: str = "user", team: str = "t1", email: str | None = None) -> str:
    email = email or f"{uid}@corp.local"
    db_exec(
        client,
        "INSERT INTO users(id, name, email, title, role, team_id, password_hash, created_at) VALUES(?,?,?,?,?,?,?,?)",
        (uid, uid.upper(), email, "", role, team, hash_password(PWD), "2026-01-01 00:00"),
    )
    return email


def login(app, email: str) -> TestClient:  # type: ignore[no-untyped-def]
    c = TestClient(app)
    c.__enter__()  # 共享 app lifespan 已由主 client 启动;这里只为独立 cookie jar
    r = c.post("/api/auth/login", json={"email": email, "password": PWD})
    assert r.status_code == 200, r.text
    return c
