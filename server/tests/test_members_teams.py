from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from tests.helpers import PWD, H, world
from tests.test_patents import mk


def reg(client, email="new@corp.local", team="t1"):  # type: ignore[no-untyped-def]
    return client.post("/api/auth/register", json={"name": "新人", "email": email, "teamId": team, "password": "newpass123"})


# —— 添加成员 ——
def test_add_member_permissions_and_activation(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    body = {"name": "甲", "email": "a@corp.local", "teamId": "t1"}
    assert client.post("/api/users", json=body, headers=H("u1")).status_code == 403
    assert client.post("/api/users", json={**body, "teamId": "t2"}, headers=H("pl1")).status_code == 403  # 非本组
    assert client.post("/api/users", json={**body, "role": "pl"}, headers=H("pl1")).status_code == 403  # PL 只能加普通用户
    assert client.post("/api/users", json={**body, "teamId": "nope"}, headers=H("gl")).status_code == 400  # 必须选团队
    r = client.post("/api/users", json=body, headers=H("pl1")).json()
    assert r["user"]["teamId"] == "t1"
    token = r["activationLink"].split("token=")[1]
    assert client.post("/api/auth/password/reset", json={"token": token, "password": "activated1"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "a@corp.local", "password": "activated1"}).status_code == 200
    # GL 可关闭 PL 的成员管理权限
    cfg = client.get("/api/config", headers=H("gl")).json()
    cfg["members"]["plCanManage"] = False
    client.put("/api/config", json=cfg, headers=H("gl"))
    assert client.post("/api/users", json={**body, "email": "b@corp.local"}, headers=H("pl1")).status_code == 403


# —— 自助注册与审批 ——
def test_register_pending_and_pl_approval(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    assert [t["name"] for t in client.get("/api/auth/teams").json()] == ["平台组", "算法组"]
    assert reg(client).status_code == 201
    assert reg(client).status_code == 409  # 重复邮箱
    # 待审批:不能登录,且不出现在成员列表
    r = client.post("/api/auth/login", json={"email": "new@corp.local", "password": "newpass123"})
    assert r.status_code == 403 and r.json()["code"] == "pending_approval"
    assert all(u["email"] != "new@corp.local" for u in client.get("/api/users", headers=H("gl")).json())
    # 审批人:本组 PL 与 GL 能看到,别组 PL 看不到
    assert len(client.get("/api/registrations", headers=H("pl1")).json()) == 1
    assert client.get("/api/registrations", headers=H("pl2")).json() == []
    assert any("新注册待审批" in n["text"] for n in client.get("/api/notifications", headers=H("pl1")).json())
    uid = client.get("/api/registrations", headers=H("gl")).json()[0]["id"]
    assert client.post(f"/api/registrations/{uid}/approve", json={}, headers=H("pl2")).status_code == 403
    assert client.post(f"/api/registrations/{uid}/approve", json={"role": "pl"}, headers=H("pl1")).status_code == 403
    assert client.post(f"/api/registrations/{uid}/approve", json={}, headers=H("pl1")).status_code == 200
    assert client.post("/api/auth/login", json={"email": "new@corp.local", "password": "newpass123"}).status_code == 200


def test_gl_approves_with_adjustment_and_reject(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    reg(client, "x@corp.local")
    reg(client, "y@corp.local")
    pend = {u["email"]: u["id"] for u in client.get("/api/registrations", headers=H("gl")).json()}
    client.post(f"/api/registrations/{pend['x@corp.local']}/approve", json={"teamId": "t2", "role": "pl"}, headers=H("gl"))
    u = next(u for u in client.get("/api/users", headers=H("gl")).json() if u["email"] == "x@corp.local")
    assert (u["teamId"], u["role"]) == ("t2", "pl")
    client.post(f"/api/registrations/{pend['y@corp.local']}/reject", json={"reason": "非本部门"}, headers=H("gl"))
    assert client.get("/api/registrations", headers=H("gl")).json() == []
    assert reg(client, "y@corp.local").status_code == 201  # 被拒后可重新申请


def test_registration_can_be_closed(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    cfg = client.get("/api/config", headers=H("gl")).json()
    cfg["members"]["selfRegistration"] = False
    client.put("/api/config", json=cfg, headers=H("gl"))
    assert client.get("/api/auth/providers").json()["selfRegistration"] is False
    assert reg(client).status_code == 403
    assert client.get("/api/auth/teams").status_code == 403


def test_sysadmin_can_approve(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    reg(client)
    client.post("/api/sysadmin/login", json={"username": "admin", "password": "rescue-me-123"})
    pend = [u for u in client.get("/api/sysadmin/overview").json()["users"] if u.get("pending")]
    assert len(pend) == 1
    assert client.post(f"/api/sysadmin/registrations/{pend[0]['id']}/approve", json={}).status_code == 200


# —— 团队与 PL ——
def team(client, tid):  # type: ignore[no-untyped-def]
    return next(t for t in client.get("/api/teams", headers=H("gl")).json() if t["id"] == tid)


def role(client, uid):  # type: ignore[no-untyped-def]
    return next(u for u in client.get("/api/users", headers=H("gl")).json() if u["id"] == uid)


def test_create_team_with_pl_moves_member(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client, "u2")["id"]
    assert client.post("/api/teams", json={"name": "新组"}, headers=H("pl1")).status_code == 403
    assert client.post("/api/teams", json={"name": "平台组"}, headers=H("gl")).status_code == 409
    t = client.post("/api/teams", json={"name": "新组", "plId": "u2"}, headers=H("gl")).json()
    assert t["plId"] == "u2"
    u2 = role(client, "u2")
    assert (u2["role"], u2["teamId"]) == ("pl", t["id"])
    # 专利留在原组(决策 30)
    assert client.get(f"/api/patents/{pid}", headers=H("u1")).json()["teamId"] == "t1"
    # 角色变化后旧会话需重新登录(Token 不受 epoch 影响,这里用登录态验证)
    client.post("/api/auth/login", json={"email": "u2@corp.local", "password": PWD})
    assert client.get("/api/me").json()["role"] == "pl"


def test_switch_pl_demotes_old_and_conflicts(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    r = client.put("/api/teams/t1/pl", json={"userId": "u1"}, headers=H("gl")).json()
    assert r == {"changed": True, "moved": False, "demoted": True}
    assert role(client, "pl1")["role"] == "user" and role(client, "u1")["role"] == "pl"
    # 其他团队的现任 PL 不能直接被挪走
    assert client.put("/api/teams/t1/pl", json={"userId": "pl2"}, headers=H("gl")).status_code == 409
    # 保留原 PL 角色
    client.put("/api/teams/t1/pl", json={"userId": "u2", "demoteOld": False}, headers=H("gl"))
    assert role(client, "u1")["role"] == "pl"
    # 撤销 PL
    client.put("/api/teams/t1/pl", json={"userId": None}, headers=H("gl"))
    assert team(client, "t1")["plId"] is None


def test_rename_and_delete_team(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.patch("/api/teams/t2", json={"name": "算法二组"}, headers=H("gl"))
    assert team(client, "t2")["name"] == "算法二组"
    assert client.delete("/api/teams/t2", headers=H("gl")).status_code == 409  # 有成员
    t = client.post("/api/teams", json={"name": "空组"}, headers=H("gl")).json()
    assert client.delete(f"/api/teams/{t['id']}", headers=H("gl")).status_code == 200


def test_demoting_pl_clears_team_leader(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/teams/t1/pl", json={"userId": "pl1"}, headers=H("gl"))
    client.patch("/api/users/pl1", json={"role": "user"}, headers=H("gl"))
    assert team(client, "t1")["plId"] is None


# —— 回调连通性 ——
class _Hook(BaseHTTPRequestHandler):
    got: list = []
    status = 200

    def do_POST(self):  # noqa: N802
        n = int(self.headers["Content-Length"])
        _Hook.got.append((self.headers.get("X-PatentFlow-Signature"), json.loads(self.rfile.read(n))))
        self.send_response(_Hook.status)
        self.end_headers()

    def log_message(self, *a):  # type: ignore[no-untyped-def]
        pass


def serve():  # type: ignore[no-untyped-def]
    srv = HTTPServer(("127.0.0.1", 0), _Hook)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}/hook"


def test_webhook_connectivity(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    srv, url = serve()
    try:
        assert client.post("/api/notify/test-webhook", json={"url": url}, headers=H("pl1")).status_code == 403
        r = client.post("/api/notify/test-webhook", json={"url": url}, headers=H("gl")).json()
        assert r["ok"] and r["status"] == 200 and _Hook.got[-1][1]["test"] is True
        _Hook.status = 500
        r = client.post("/api/notify/test-webhook", json={"url": url}, headers=H("gl")).json()
        assert not r["ok"] and r["status"] == 500 and "500" in r["error"]
        r = client.post("/api/notify/test-webhook", json={"url": "http://127.0.0.1:1/x"}, headers=H("gl")).json()
        assert not r["ok"] and r["error"].startswith("无法连接")
        assert client.post("/api/notify/test-webhook", json={"url": "ftp://x"}, headers=H("gl")).json()["ok"] is False
    finally:
        _Hook.status = 200
        srv.shutdown()


def test_personal_notify_test_and_preview(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    r = client.post("/api/me/notify-test", headers=H("u1")).json()
    assert r["inApp"] and r["webhookConfigured"] is False and r["quietNow"] is False  # 10:00 不在 22-08
    assert any("测试通知" in n["text"] for n in client.get("/api/notifications", headers=H("u1")).json())
    pid = mk(client)["id"]
    client.put("/api/me/prefs", json={"notifyEvents": {"review": True, "due": True, "transition": False}}, headers=H("pl1"))
    cfg = [{"stage": "draft", "userIds": ["r1"], "includePl": True, "includeOwner": True, "events": ["transition"]}]
    rows = client.post(f"/api/patents/{pid}/notification-settings/preview",
                       json={"event": "transition", "config": cfg}, headers=H("u1")).json()["recipients"]
    by = {x["id"]: x for x in rows}
    assert by["u1"]["delivered"] and by["r1"]["delivered"]
    assert by["pl1"]["delivered"] is False and "关闭" in by["pl1"]["reason"]
    # 预演不产生真实通知
    assert all("draft" not in n["text"] for n in client.get("/api/notifications", headers=H("r1")).json())
