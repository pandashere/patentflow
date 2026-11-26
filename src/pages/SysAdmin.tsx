import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { ROLE_LABEL, type Role, type Team, type User } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AlertTriangle, KeyRound, LogOut, Plus, RotateCcw, ShieldAlert, UserCheck, X } from 'lucide-react'

// —— 系统管理员后台(/sysadmin) ——
// 兜底账号:用户名/密码来自配置文件,不是业务用户;只做账号救援,看不到任何专利数据。

interface AdminUser extends User {
  hasPassword: boolean
  activeTokens: number
  activeSessions: number
}

interface Overview {
  users: AdminUser[]
  teams: Team[]
  glCount: number
}

interface AuditRow {
  id: string
  at: string
  admin: string
  action: string
  target: string
  detail: string
  ip: string
}

const ACTION_LABEL: Record<string, string> = {
  login: '登录', login_failed: '登录失败', 'reset_password:temp': '重置密码(临时密码)',
  'reset_password:link': '重置密码(链接)', revoke_sessions: '强制下线', 'revoke_sessions:tokens': '强制下线并吊销 Token',
  reactivate: '恢复账号', update_user: '调整角色/团队', create_user: '新建账号', create_team: '新建团队',
}

const inputCls = 'rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20'

export default function SysAdmin() {
  const [admin, setAdmin] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    api.get<{ username: string }>('/sysadmin/me')
      .then((r) => setAdmin(r.username))
      .catch(() => setAdmin(null))
      .finally(() => setChecked(true))
  }, [])

  if (!checked) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">加载中…</div>
  return admin ? <Console admin={admin} onLogout={() => setAdmin(null)} /> : <AdminLogin onOk={setAdmin} />
}

function AdminLogin({ onOk }: { onOk: (u: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#12141f] px-4">
      <form
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            const r = await api.post<{ username: string }>('/sysadmin/login', { username, password })
            onOk(r.username)
          } catch (err) {
            setMsg(err instanceof ApiError ? err.message : String(err))
          }
        }}
      >
        <div className="flex items-center gap-2 text-red-700">
          <ShieldAlert className="size-5" />
          <span className="ui-label">SYSTEM ADMIN</span>
        </div>
        <h1 className="mt-2 text-lg font-bold">系统管理员后台</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          兜底账号,由部署配置文件定义,仅用于账号救援。业务用户请从 <a href="/" className="text-teal-700 hover:underline">普通登录页</a> 进入。
        </p>
        <label className="mt-5 block ui-label text-slate-500" htmlFor="sa-user">用户名</label>
        <input id="sa-user" value={username} onChange={(e) => setUsername(e.target.value)} className={cn(inputCls, 'mt-1 w-full py-2')} autoComplete="username" />
        <label className="mt-3 block ui-label text-slate-500" htmlFor="sa-pwd">密码</label>
        <input id="sa-pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={cn(inputCls, 'mt-1 w-full py-2')} autoComplete="current-password" />
        {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}
        <button type="submit" disabled={!username || !password} className="mt-5 w-full rounded-md bg-[#12141f] py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
          登录
        </button>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">所有操作(含失败的登录尝试)都会写入审计日志。会话 2 小时后过期。</p>
      </form>
    </div>
  )
}

function Console({ admin, onLogout }: { admin: string; onLogout: () => void }) {
  const [ov, setOv] = useState<Overview | null>(null)
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null)
  const [newTeam, setNewTeam] = useState('')
  const [nu, setNu] = useState({ name: '', email: '', title: '', teamId: '', role: 'user' as Role })

  const load = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([api.get<Overview>('/sysadmin/overview'), api.get<AuditRow[]>('/sysadmin/audit')])
      setOv(o)
      setAudit(a)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout()
      else setErr(String(e))
    }
  }, [onLogout])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    }
    await load()
  }

  if (!ov) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">加载中…</div>
  const users = ov.users.filter((u) => !q || u.name.includes(q) || u.email.includes(q.toLowerCase()))

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center gap-3 border-b bg-[#12141f] px-6 text-white">
        <ShieldAlert className="size-5 text-red-400" />
        <span className="font-mono-x text-sm font-bold tracking-widest">PATENTFLOW · SYSADMIN</span>
        <span className="ml-auto text-xs text-slate-400">已登录:{admin}</span>
        <button
          type="button"
          onClick={async () => { await api.post('/sysadmin/logout').catch(() => {}); onLogout() }}
          className="flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
        >
          <LogOut className="size-3.5" />
          退出
        </button>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">账号救援</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            这里只处理账号本身:重置密码、恢复被停用的账号、强制下线、调整角色与团队。专利内容与日常成员管理由 GL 在业务系统中完成。
          </p>
        </div>

        {ov.glCount === 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            当前没有在职的 GL,业务系统中无人能管理成员与配置。请在下表中把一位成员的角色设为 GL,或新建一个 GL 账号。
          </div>
        )}
        {err && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-700">
            {err}
            <button type="button" onClick={() => setErr('')} className="ml-auto" aria-label="关闭"><X className="size-4" /></button>
          </div>
        )}

        {/* 账号列表 */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">全部账号({ov.users.length})</h2>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名 / 邮箱" className={cn(inputCls, 'w-56')} />
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-slate-50/70 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">账号</th>
                  <th className="px-3 py-2.5 font-medium">角色</th>
                  <th className="px-3 py-2.5 font-medium">团队</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">登录方式</th>
                  <th className="px-3 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => (
                  <tr key={u.id} className={cn(u.deactivated && 'bg-slate-50 text-slate-400')}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{u.name}</div>
                      <div className="font-mono-x text-[11px] text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={u.role}
                        onChange={(e) => {
                          const role = e.target.value as Role
                          setConfirm({
                            title: `把 ${u.name} 的角色改为 ${ROLE_LABEL[role]}?`,
                            body: '角色变更后,该账号现有的登录会话会失效,需要重新登录。',
                            run: () => run(() => api.patch(`/sysadmin/users/${u.id}`, { role })),
                          })
                        }}
                        className={cn(inputCls, 'py-1 text-xs')}
                        aria-label={`${u.name} 的角色`}
                      >
                        {(['user', 'pl', 'gl'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={u.teamId}
                        onChange={(e) => run(() => api.patch(`/sysadmin/users/${u.id}`, { teamId: e.target.value }))}
                        className={cn(inputCls, 'py-1 text-xs')}
                        aria-label={`${u.name} 的团队`}
                      >
                        {ov.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {u.deactivated
                        ? <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">已停用 · {u.deactivated.at.slice(0, 10)}</span>
                        : <span className="text-slate-500">{u.activeSessions} 个会话 · {u.activeTokens} 个 Token</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {u.hasPassword ? '本地密码' : '未设密码'}
                      {u.ssoBound && ` · SSO(${u.ssoIssuer})`}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <ActBtn
                          icon={KeyRound}
                          onClick={() => setConfirm({
                            title: `为 ${u.name} 生成临时密码?`,
                            body: '旧密码立即失效,现有登录全部下线。临时密码只显示一次,请线下告知本人,并提醒登录后在个人中心修改。',
                            run: () => run(async () => {
                              const r = await api.post<{ tempPassword: string }>(`/sysadmin/users/${u.id}/reset-password`, { mode: 'temp' })
                              setSecret({ title: `${u.name} 的临时密码`, value: r.tempPassword, note: '只显示这一次。' })
                            }),
                          })}
                        >
                          临时密码
                        </ActBtn>
                        <ActBtn
                          icon={KeyRound}
                          onClick={() => run(async () => {
                            const r = await api.post<{ link: string }>(`/sysadmin/users/${u.id}/reset-password`, { mode: 'link' })
                            setSecret({ title: `${u.name} 的重置链接`, value: r.link, note: '30 分钟内有效,已同时经通知接口发给本人。' })
                          })}
                        >
                          重置链接
                        </ActBtn>
                        <ActBtn
                          icon={LogOut}
                          onClick={() => setConfirm({
                            title: `强制 ${u.name} 下线并吊销全部 Token?`,
                            body: '适用于账号疑似被盗用。密码不变;如需同时更换密码,请再生成临时密码。',
                            run: () => run(() => api.post(`/sysadmin/users/${u.id}/revoke-sessions?revokeTokens=true`)),
                          })}
                        >
                          强制下线
                        </ActBtn>
                        {u.deactivated && (
                          <ActBtn icon={UserCheck} onClick={() => run(() => api.post(`/sysadmin/users/${u.id}/reactivate`))}>
                            恢复账号
                          </ActBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 新建 */}
        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-semibold">新建账号</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">首次部署建首个 GL,或补救性开号。日常加人请由 GL 在业务系统中操作。</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input placeholder="姓名" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} className={inputCls} />
              <input placeholder="邮箱" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} className={inputCls} />
              <input placeholder="职位(可选)" value={nu.title} onChange={(e) => setNu({ ...nu, title: e.target.value })} className={inputCls} />
              <select value={nu.teamId} onChange={(e) => setNu({ ...nu, teamId: e.target.value })} className={inputCls} aria-label="团队">
                <option value="">选择团队…</option>
                {ov.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })} className={inputCls} aria-label="角色">
                {(['user', 'pl', 'gl'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button
                type="button"
                disabled={!nu.name.trim() || !nu.email.trim() || !nu.teamId}
                onClick={() => run(async () => {
                  const r = await api.post<{ tempPassword: string }>('/sysadmin/users', nu)
                  setSecret({ title: `${nu.name} 的初始密码`, value: r.tempPassword, note: '只显示这一次,请提醒本人登录后修改。' })
                  setNu({ name: '', email: '', title: '', teamId: '', role: 'user' })
                })}
                className="flex items-center justify-center gap-1.5 rounded-md bg-[#12141f] text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                <Plus className="size-3.5" />
                创建
              </button>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-semibold">团队</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ov.teams.map((t) => <span key={t.id} className="rounded-full border px-2.5 py-1 text-xs text-slate-600">{t.name}</span>)}
              {ov.teams.length === 0 && <span className="text-xs text-muted-foreground">还没有团队,请先新建。</span>}
            </div>
            <div className="mt-3 flex gap-2">
              <input placeholder="新团队名称" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} className={cn(inputCls, 'flex-1')} />
              <button
                type="button"
                disabled={!newTeam.trim()}
                onClick={() => run(async () => { await api.post('/sysadmin/teams', { name: newTeam.trim() }); setNewTeam('') })}
                className="rounded-md border px-3 text-[13px] hover:bg-slate-50 disabled:opacity-40"
              >
                新建团队
              </button>
            </div>
          </div>
        </section>

        {/* 审计 */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <RotateCcw className="size-4 text-slate-400" />
            审计日志(最近 200 条)
          </h2>
          <div className="divide-y rounded-lg border bg-card text-[13px]">
            {audit.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">暂无记录</p>}
            {audit.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="font-mono-x text-[11px] text-slate-400">{a.at}</span>
                <span className={cn('font-medium', a.action === 'login_failed' && 'text-red-600')}>{ACTION_LABEL[a.action] ?? a.action}</span>
                {a.target && <span className="font-mono-x text-xs text-slate-500">{a.target}</span>}
                {a.detail && <span className="font-mono-x text-[11px] text-slate-400">{a.detail}</span>}
                <span className="ml-auto text-[11px] text-slate-400">{a.admin} · {a.ip}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="text-[13px] text-slate-600">{confirm.body}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setConfirm(null); load() }} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">取消</button>
            <button
              type="button"
              onClick={async () => { const c = confirm; setConfirm(null); await c.run() }}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              确认
            </button>
          </div>
        </Dialog>
      )}
      {secret && (
        <Dialog title={secret.title} onClose={() => setSecret(null)}>
          <code className="block break-all rounded-md border bg-slate-50 px-3 py-2.5 font-mono-x text-sm">{secret.value}</code>
          <p className="mt-2 text-xs text-muted-foreground">{secret.note}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => navigator.clipboard?.writeText(secret.value)} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">复制</button>
            <button type="button" onClick={() => setSecret(null)} className="rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white">我已记下</button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function ActBtn({ icon: Icon, onClick, children }: { icon: typeof KeyRound; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
    >
      <Icon className="size-3" />
      {children}
    </button>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100" aria-label="关闭"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
