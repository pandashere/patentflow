from __future__ import annotations

from tests.helpers import PWD, add_team, add_user, db_exec


def setup(client):  # type: ignore[no-untyped-def]
    add_team(client, "t1", "平台组")
    return add_user(client, "u1")


def test_login_and_me_requires_auth(client) -> None:  # type: ignore[no-untyped-def]
    email = setup(client)
    assert client.post("/api/auth/login", json={"email": email, "password": "bad"}).status_code == 401
    # 不存在的账号与密码错误话术一致(防枚举)
    r1 = client.post("/api/auth/login", json={"email": "nobody@x", "password": "x"}).json()
    r2 = client.post("/api/auth/login", json={"email": email, "password": "bad"}).json()
    assert r1["message"] == r2["message"]
    r = client.post("/api/auth/login", json={"email": email, "password": PWD})
    assert r.status_code == 200 and r.json()["user"]["id"] == "u1"


def test_forgot_and_reset_password_invalidates_sessions(client) -> None:  # type: ignore[no-untyped-def]
    email = setup(client)
    client.post("/api/auth/login", json={"email": email, "password": PWD})
    same = client.post("/api/auth/password/forgot", json={"email": "nobody@x"}).json()
    r = client.post("/api/auth/password/forgot", json={"email": email}).json()
    assert r["message"] == same["message"] and "demoLink" not in same
    token = r["demoLink"].split("token=")[1]
    assert client.post("/api/auth/password/reset", json={"token": token, "password": "short"}).status_code == 422
    assert client.post("/api/auth/password/reset", json={"token": token, "password": "newpass123"}).status_code == 200
    # 一次性
    assert client.post("/api/auth/password/reset", json={"token": token, "password": "newpass123"}).status_code == 400
    # 旧会话失效
    assert client.get("/api/auth/providers").status_code == 200
    assert client.post("/api/me/password", json={"old": "x", "new": "abcdefgh"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": email, "password": "newpass123"}).status_code == 200


def test_sso_not_connected(client) -> None:  # type: ignore[no-untyped-def]
    assert client.get("/api/auth/sso/corp-oidc/begin").status_code == 501
