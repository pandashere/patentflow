# PATENTFLOW · 专利状态跟踪系统

轻量级内网专利状态跟踪系统 —— 五阶段流水线(草案 → 可专利性审查 → 专利实施 → 专利检索 → DOI 撰写),同行审查门禁、阶段级版本控制、可配置 KPI,为几十人研发团队设计。

特性一览:私有/团队/公开三级可见性(私有对 GL/PL 完全透明且锁定草案阶段)· reviewer 邀请制审查门禁(人数、加权下限、维度权重均可由 GL 配置)· 阶段默认周期自动排期 · 阶段数据只增不改的版本快照 · 专利归档(完成/放弃,只读可恢复)· 共同发明人与专利转交(单件 / 批量 / 离职交接)· 审查轮次 · GL/PL 阶段趋势折线统计 · 个人中心(API Token 自助、通知偏好、新建默认值)· 成员管理与数据导出(JSON/CSV)· SSO / 通知回调 / KPI 自由计分钩子均按接口预留。

账号兜底:配置文件定义的系统管理员(非业务用户)登录独立后台 `/sysadmin`,负责重置密码、恢复账号、强制下线、重新指定 GL,全部操作留审计。

## 目录

- **`server/`** — 后端:Python 3.10+ / FastAPI / aiosqlite(WAL + 全局写锁 + 乐观锁),单进程,无重型依赖
- **`src/`** — 前端:React + TypeScript + Vite + Tailwind
- **`docs/01-用户需求.md`** — 原始需求
- **`docs/02-设计方案与答疑.md`** — 设计方案与 40 条需求决策
- **`patentflow.config.example.yaml`** — 部署配置示例

## 本地开发

```bash
# 后端(需要 uv)
cd server
uv sync
uv run pytest                                   # 后端测试
PATENTFLOW_DB=./dev.db uv run patentflow --config ../patentflow.config.example.yaml seed   # 导入演示数据(密码 demo1234)
PATENTFLOW_DB=./dev.db PATENTFLOW_DEMO=1 PATENTFLOW_ADMIN_PASSWORD='换成你的密码' \
  uv run patentflow --config ../patentflow.config.example.yaml serve --port 8000

# 前端(另开终端,/api 自动代理到 8000)
npm install
npm run dev
```

演示模式(`PATENTFLOW_DEMO=1`)下,右上角可在 普通用户 / PL / GL / Reviewer 四个演示账号间切换;系统管理员后台在 `/sysadmin`。

## 部署

```bash
npm run build                                   # 前端产物在 dist/
cd server && uv run patentflow hash-password    # 生成系统管理员密码哈希,填入配置 sysadmin.password_hash
PATENTFLOW_STATIC=../dist uv run patentflow --config /etc/patentflow.yaml serve --host 0.0.0.0 --port 8000
```

首次部署:用系统管理员登录 `/sysadmin` → 新建团队 → 新建首个 GL(得到一次性临时密码)→ GL 登录业务系统后维护成员与配置。
