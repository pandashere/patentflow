from __future__ import annotations

from tests.helpers import PWD, H, add_user, world
from tests.test_patents import adv, mk


def test_offboarding_requires_assignment_and_hides_private(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client, title="团队A")["id"]
    priv = mk(client, vis="private", title="秘密草案")["id"]
    b = mk(client, "u2")["id"]
    adv(client, b, "u2")
    client.post(f"/api/patents/{b}/reviewers", json={"userId": "u1"}, headers=H("u2"))
    url = "/api/users/u1/deactivate"
    assert client.post(url, json={}, headers=H("pl1")).status_code == 403
    r = client.post(url, json={}, headers=H("gl")).json()
    assert r["code"] == "unassigned" and r["patentIds"] == [a]  # 私有草案不在名单(GL 不可见)
    r = client.post(url, json={"assignments": {a: "u2"}}, headers=H("gl")).json()
    assert r == {"transferred": 2, "reviewsWithdrawn": 1}
    # 私有草案转为团队可见交给本组 PL;Token 吊销;审查邀请撤销
    p = client.get(f"/api/patents/{priv}", headers=H("pl1")).json()
    assert p["ownerId"] == "pl1" and p["visibility"] == "team"
    assert client.get("/api/me", headers=H("u1")).status_code == 401
    rv = client.get(f"/api/patents/{b}", headers=H("u2")).json()["stageData"]["patentability"]["reviewers"]
    assert rv == []
    assert client.post("/api/auth/login", json={"email": "u1@corp.local", "password": PWD}).status_code == 401
    # 恢复
    assert client.post("/api/users/u1/reactivate", headers=H("gl")).status_code == 200


def test_role_change(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    assert client.patch("/api/users/gl", json={"role": "user"}, headers=H("gl")).status_code == 400  # 不能降级自己
    assert client.patch("/api/users/u2", json={"role": "pl"}, headers=H("u1")).status_code == 403
    assert client.patch("/api/users/u2", json={"role": "pl", "teamId": "t2"}, headers=H("gl")).json()["role"] == "pl"
    r = client.post("/api/users", json={"name": "新人", "email": "new@corp.local", "teamId": "t1"}, headers=H("gl"))
    assert r.status_code == 201
    assert client.post("/api/users", json={"name": "新人", "email": "new@corp.local", "teamId": "t1"},
                       headers=H("gl")).status_code == 409


def test_config_validation(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    cfg = client.get("/api/config", headers=H("u1")).json()
    assert client.put("/api/config", json=cfg, headers=H("pl1")).status_code == 403
    assert client.put("/api/config", json={**cfg, "reviewPassCount": 0}, headers=H("gl")).status_code == 400
    assert client.put("/api/config", json={**cfg, "reviewPassCount": 1}, headers=H("gl")).status_code == 200
    assert client.get("/api/config", headers=H("u1")).json()["reviewPassCount"] == 1


def test_token_scope_and_lifecycle(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    # Token 不能派生 Token,需网页会话
    assert client.post("/api/tokens", json={"name": "x", "days": 30}, headers=H("u1")).status_code == 403
    client.post("/api/auth/login", json={"email": "u1@corp.local", "password": PWD})
    r = client.post("/api/tokens", json={"name": "脚本", "days": 30, "scope": "read"}).json()
    ro = {"Authorization": f"Bearer {r['token']}"}
    client.cookies.clear()
    assert client.get("/api/patents", headers=ro).status_code == 200
    w = client.post("/api/patents", json={"title": "x"}, headers=ro)
    assert w.status_code == 403 and w.json()["code"] == "token_read_only"
    listed = client.get("/api/tokens", headers=H("u1")).json()
    assert all("…" in t["token"] for t in listed)  # 明文只返回一次
    assert client.delete(f"/api/tokens/{r['id']}", headers=H("u2")).status_code == 403
    assert client.delete(f"/api/tokens/{r['id']}", headers=H("gl")).status_code == 200
    assert client.get("/api/patents", headers=ro).status_code == 401


def test_notifications_respect_private_and_prefs(client, notifier) -> None:  # type: ignore[no-untyped-def]
    world(client)
    priv = mk(client, vis="private")["id"]
    client.post(f"/api/patents/{priv}/archive", json={"kind": "abandoned", "reason": "x"}, headers=H("u1"))
    # 私有专利事件不发给 PL/GL(即便默认配置 transition 发给 PL/GL)
    for uid in ("pl1", "gl"):
        assert client.get("/api/notifications", headers=H(uid)).json() == []
    pub = mk(client)["id"]
    client.put("/api/me/prefs", json={"notifyEvents": {"review": True, "due": True, "transition": False}}, headers=H("gl"))
    adv(client, pub)
    texts = [n["text"] for n in client.get("/api/notifications", headers=H("pl1")).json()]
    assert any("已推进至" in t for t in texts)
    assert client.get("/api/notifications", headers=H("gl")).json() == []  # 个人屏蔽了流转事件
    assert notifier.sent and all(r["id"] != "u1" for ev in notifier.sent for r in ev["recipients"])  # 不发给操作者本人


def test_export_excludes_private(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    mk(client, vis="private", title="秘密")
    mk(client, title="公开的")
    assert client.get("/api/export.json", headers=H("pl1")).status_code == 403
    data = client.get("/api/export.json", headers=H("gl")).json()
    assert [p["title"] for p in data["patents"]] == ["公开的"]
    csv = client.get("/api/export/patents.csv", headers=H("gl")).text
    assert "秘密" not in csv and "公开的" in csv


def test_bootstrap_shape(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    mk(client, vis="private")
    add_user(client, "x9", "user", "t2")
    b = client.get("/api/bootstrap", headers=H("gl")).json()
    assert {"me", "users", "patents", "kpiRules", "kpiReports", "cycles", "prefs", "config"} <= set(b)
    assert b["patents"] == []  # GL 看不到私有
    assert b["config"]["reviewPassCount"] == 2
