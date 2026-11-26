from __future__ import annotations

from tests.helpers import PWD, H, world
from tests.test_patents import mk

A = "/api/sysadmin"


def admin_login(client):  # type: ignore[no-untyped-def]
    r = client.post(f"{A}/login", json={"username": "admin", "password": "rescue-me-123"})
    assert r.status_code == 200, r.text


def test_sysadmin_is_not_a_business_user(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    assert client.post(f"{A}/login", json={"username": "admin", "password": "x"}).status_code == 401
    assert client.get(f"{A}/overview").status_code == 401
    admin_login(client)
    ov = client.get(f"{A}/overview").json()
    assert ov["glCount"] == 1 and all(u["email"] != "admin" for u in ov["users"])
    # 管理员会话不能访问业务接口(看不到任何专利)
    assert client.get("/api/patents").status_code == 401
    assert client.post("/api/auth/login", json={"email": "admin", "password": "rescue-me-123"}).status_code == 401
    # 业务用户也进不了管理后台
    client.cookies.clear()
    assert client.get(f"{A}/overview", headers=H("gl")).status_code == 401


def test_reset_password_temp_and_link(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.post("/api/auth/login", json={"email": "u1@corp.local", "password": PWD})
    user_cookie = client.cookies.get("pf_session")
    admin_login(client)
    tmp = client.post(f"{A}/users/u1/reset-password", json={"mode": "temp"}).json()["tempPassword"]
    # 旧会话失效、旧密码失效、临时密码可用
    client.cookies.set("pf_session", user_cookie)
    assert client.get("/api/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "u1@corp.local", "password": PWD}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "u1@corp.local", "password": tmp}).status_code == 200
    link = client.post(f"{A}/users/u2/reset-password", json={"mode": "link"}).json()["link"]
    token = link.split("token=")[1]
    assert client.post("/api/auth/password/reset", json={"token": token, "password": "brandnew1"}).status_code == 200
    actions = [a["action"] for a in client.get(f"{A}/audit").json()]
    assert "reset_password:temp" in actions and "reset_password:link" in actions


def test_recover_gl_and_reactivate_and_bootstrap_new_deployment(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    mk(client)
    admin_login(client)
    # 指定新的 GL
    assert client.patch(f"{A}/users/pl1", json={"role": "gl"}).json()["role"] == "gl"
    # 恢复被停用的账号(无需交接)
    client.post("/api/users/u2/deactivate", json={}, headers=H("gl"))
    assert client.post(f"{A}/users/u2/reactivate").status_code == 200
    assert client.post("/api/auth/login", json={"email": "u2@corp.local", "password": PWD}).status_code == 200
    # 首次部署:建团队与首个 GL,返回一次性临时密码
    admin_login(client)
    t = client.post(f"{A}/teams", json={"name": "新团队"}).json()
    r = client.post(f"{A}/users", json={"name": "新GL", "email": "boss@corp.local", "teamId": t["id"], "role": "gl"}).json()
    assert client.post("/api/auth/login", json={"email": "boss@corp.local", "password": r["tempPassword"]}).status_code == 200


def test_revoke_sessions(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    admin_login(client)
    client.post(f"{A}/users/u1/revoke-sessions?revokeTokens=true")
    assert client.get("/api/me", headers=H("u1")).status_code == 401


def test_disabled_without_config(tmp_path) -> None:  # type: ignore[no-untyped-def]
    from fastapi.testclient import TestClient

    from patentflow.app import create_app
    from patentflow.config import Settings

    with TestClient(create_app(Settings(db_path=str(tmp_path / "x.db"), reminder_interval_seconds=0))) as c:
        assert c.post(f"{A}/login", json={"username": "", "password": ""}).json()["code"] == "sysadmin_disabled"
