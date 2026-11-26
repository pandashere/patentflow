import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { api, ApiError } from '@/lib/api'
import { KeyRound, MailQuestion, ScanFace, SquarePen, X } from 'lucide-react'

// 登录页:本地账密 + SSO 入口(接口解耦演示)
// 每个 SSO provider 对应后端 identity/provider 的一个实现,这里只做 UI 示意。
export default function Login({ onResetDone }: { onResetDone?: () => void } = {}) {
  const { providers, login, requestPasswordReset, resetPassword } = useStore()
  const [account, setAccount] = useState(providers.demo ? 'chenxi@corp.local' : '')
  const [password, setPassword] = useState('')
  const [loginMsg, setLoginMsg] = useState('')
  const [ssoHint, setSsoHint] = useState<string | null>(null)

  // 忘记密码:申请 → (demo 展示链接)→ 打开链接设新密码
  const [urlToken] = useState(() => new URLSearchParams(window.location.search).get('token'))
  const [forgotOpen, setForgotOpen] = useState(!!urlToken)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLink, setForgotLink] = useState<string | null>(null)
  const [forgotSent, setForgotSent] = useState(false)
  const [resetToken, setResetToken] = useState<string | null>(urlToken)
  const [pwd1, setPwd1] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const enabledSso = providers.sso.filter((p) => p.enabled && p.issuer !== 'local')
  const [busy, setBusy] = useState(false)
  const closeForgot = () => { setForgotOpen(false); onResetDone?.() }
  const [mode, setMode] = useState<'login' | 'register'>('login')

  // 邮件/IM 中的重置链接形如 /reset?token=…:打开后直接进入设置新密码
  useEffect(() => {
    if (urlToken) window.history.replaceState(null, '', window.location.pathname.replace(/reset\/?$/, ''))
  }, [])

  return (
    <div className="flex min-h-dvh">
      {/* 左侧品牌区 */}
      <div className="hidden w-[46%] flex-col justify-between bg-[#12141f] p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-teal-600">
            <SquarePen className="size-4" strokeWidth={2.2} />
          </div>
          <span className="font-mono-x text-sm font-bold tracking-widest">PATENTFLOW</span>
        </div>
        <div>
          <div className="ui-label text-teal-400">INTERNAL · PATENT PIPELINE</div>
          <h1 className="mt-3 text-3xl font-bold leading-snug tracking-tight">
            从草案到 DOI,
            <br />
            一条看得见的流水线。
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#9aa3ba]">
            五阶段状态跟踪、可专利性同行审查、阶段级数据版本与可配置 KPI ——
            为几十人研发团队设计的轻量化内网服务。
          </p>
          {/* 五阶段流水线示意 */}
          <div className="mt-10 max-w-md">
            <div className="relative grid grid-cols-5">
              <div className="absolute left-[10%] right-[10%] top-4 h-px bg-gradient-to-r from-slate-500 via-teal-500 to-violet-500 opacity-60" />
              {([
                ['草案', '#94a3b8', '想法成稿'],
                ['审查', '#14b8a6', 'reviewer 门禁'],
                ['实施', '#3b82f6', '方案落地'],
                ['检索', '#f59e0b', '新颖性检索'],
                ['DOI', '#8b5cf6', '成果撰写'],
              ] as const).map(([label, c, desc], i) => (
                <div key={label} className="relative flex flex-col items-center text-center">
                  <span
                    className="flex size-8 items-center justify-center rounded-full border-2 bg-[#12141f] font-mono-x text-[11px] font-bold"
                    style={{ borderColor: c, color: c, boxShadow: i === 1 ? `0 0 0 5px ${c}26` : undefined }}
                  >
                    {i + 1}
                  </span>
                  <span className="mt-2 text-xs font-medium text-white">{label}</span>
                  <span className="mt-0.5 text-[10px] leading-tight text-[#6b7386]">{desc}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2 text-[11px]">
              {[['版本只增不改', '每次保存一个快照'], ['审查按轮次', '打回后修改再审'], ['KPI 事件口径', '首次到达才计分']].map(([t, d]) => (
                <div key={t} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div className="font-medium text-slate-200">{t}</div>
                  <div className="mt-0.5 text-[#6b7386]">{d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="font-mono-x text-[10px] tracking-widest text-[#565f75]">
          SQLITE · SINGLE PROCESS · SSO-READY
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm">
          {mode === 'register' ? (
            <RegisterPanel onBack={(email) => { setMode('login'); if (email) { setAccount(email); setLoginMsg('') } }} />
          ) : (<>
          <div className="ui-label text-teal-700">SIGN IN</div>
          <h2 className="mt-1 text-xl font-bold">登录专利管理系统</h2>

          <form
            className="mt-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              const err = await login(account.trim(), password)
              setBusy(false)
              setLoginMsg(err ? (err.includes('审批') ? err : `${err}。忘记密码可点击「忘记密码?」重置`) : '')
            }}
          >
            <div>
              <label htmlFor="account" className="ui-label text-slate-500">账号</label>
              <input
                id="account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="mt-1.5 w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
                placeholder="name@corp.local"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="ui-label text-slate-500">密码</label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotOpen(true); setForgotEmail(account); setForgotLink(null)
                    setForgotSent(false); setResetToken(null); setPwd1(''); setPwd2(''); setResetMsg(null)
                  }}
                  className="text-[11px] text-teal-700 hover:underline"
                >
                  忘记密码?
                </button>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
                placeholder={providers.demo ? '演示账号密码:demo1234' : ''}
              />
            </div>
            {loginMsg && <p className="text-xs text-red-600">{loginMsg}</p>}
            <button
              type="submit"
              disabled={busy || !account.trim() || !password}
              className="flex w-full disabled:opacity-50 items-center justify-center gap-2 rounded-md bg-[#12141f] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <KeyRound className="size-4" />
              本地账号登录
            </button>
          </form>
          {providers.selfRegistration && (
            <p className="mt-3 text-center text-[13px] text-slate-500">
              还没有账号?
              <button type="button" onClick={() => setMode('register')} className="ml-1 font-medium text-teal-700 hover:underline">注册</button>
            </p>
          )}

          <div className="my-5 flex items-center gap-3 text-[11px] text-slate-400">
            <div className="h-px flex-1 bg-border" />
            <span className="font-mono-x tracking-widest">OR SSO</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            {enabledSso.map((p) => (
              <button
                key={p.issuer}
                type="button"
                onClick={() => setSsoHint(p.issuer)}
                className="flex w-full items-center gap-2.5 rounded-md border bg-white px-3.5 py-2.5 text-sm transition-colors hover:border-teal-600 hover:bg-teal-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                <ScanFace className="size-4 text-teal-700" />
                <span className="flex-1 text-left">{p.name}</span>
                <span className="font-mono-x text-[10px] text-slate-400">{p.issuer}</span>
              </button>
            ))}
          </div>

          {ssoHint && (
          <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-teal-900">
              <strong className="font-semibold">SSO 接口占位:</strong>
              生产环境此处重定向到 <code className="font-mono-x text-[11px]">/auth/sso/{ssoHint}/begin</code>,
              回调返回 ExternalIdentity(issuer + subject)后按绑定策略匹配本地租户。
              新增 Provider 实现即可接入,业务代码零改动。
              <span className="mt-2 block text-teal-800">当前尚未接入(SSO 设计待定)。</span>
            </div>
          )}

          <p className="mt-6 text-center text-[11px] text-slate-400">
            首次 SSO 登录将引导绑定本地账号(email 自动匹配 / 账密验证 / GL 预绑定)
          </p>
          <p className="mt-3 text-center text-[11px] text-slate-400">
            账号异常、无法登录?请联系系统管理员 ·{' '}
            <a href="/sysadmin" className="text-slate-500 underline underline-offset-2 hover:text-slate-700">管理员入口</a>
          </p>
          </>)}
        </div>
      </div>

      {/* 忘记密码:经通知接口(webhook → 邮件/IM 适配器)投递一次性带 token 的重置链接 */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => closeForgot()}>
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-bold">
                <MailQuestion className="size-4 text-teal-700" />
                {resetToken ? '设置新密码' : '重置密码'}
              </h3>
              <button type="button" onClick={() => closeForgot()} className="rounded p-1 hover:bg-slate-100" aria-label="关闭">
                <X className="size-4" />
              </button>
            </div>

            {!resetToken ? (
              <>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  输入账号后,系统生成一次性重置 token(30 分钟内有效、用后作废),
                  经通知接口把带 token 的链接投递给本人 —— 与系统通知共用同一 webhook 回调通道。
                </p>
                <label className="mt-3 block ui-label text-slate-500">账号</label>
                <input
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="name@corp.local"
                  className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
                />
                {forgotSent && (
                  <div className="mt-3 space-y-2">
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      如果该账号已注册,重置链接已通过通知接口投递(30 分钟内有效)。
                      无论账号是否存在都显示此提示,不泄露注册状态。
                    </p>
                    {forgotLink && (
                      <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs text-teal-900">
                        <div className="font-medium">demo 环境直接展示投递内容:</div>
                        <code className="mt-1 block break-all font-mono-x text-[11px]">{forgotLink}</code>
                        <button
                          type="button"
                          onClick={() => setResetToken(new URL(forgotLink).searchParams.get('token'))}
                          className="mt-2 font-medium text-teal-700 underline underline-offset-2"
                        >
                          模拟打开重置链接 →
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => closeForgot()} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
                    关闭
                  </button>
                  <button
                    type="button"
                    disabled={!forgotEmail.trim()}
                    onClick={async () => {
                      const r = await requestPasswordReset(forgotEmail.trim()).catch(() => null)
                      setForgotLink(r?.demoLink ?? null); setForgotSent(true)
                    }}
                    className="rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    发送重置链接
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  链接 token 校验通过(<code className="font-mono-x text-[11px]">{resetToken.slice(0, 12)}…</code>)。
                  新密码生效后该 token 立即作废。
                </p>
                <label className="mt-3 block ui-label text-slate-500">新密码(≥8 位)</label>
                <input
                  type="password"
                  value={pwd1}
                  onChange={(e) => setPwd1(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
                />
                <label className="mt-3 block ui-label text-slate-500">确认新密码</label>
                <input
                  type="password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
                />
                {resetMsg && (
                  <p className={`mt-2 text-xs ${resetMsg.ok ? 'text-teal-700' : 'text-red-600'}`}>{resetMsg.text}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => closeForgot()} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
                    关闭
                  </button>
                  <button
                    type="button"
                    disabled={!pwd1 || !pwd2}
                    onClick={async () => {
                      if (pwd1 !== pwd2) { setResetMsg({ ok: false, text: '两次输入的新密码不一致' }); return }
                      const r = await resetPassword(resetToken, pwd1)
                      if (r === 'ok') setResetMsg({ ok: true, text: '密码已重置,token 已作废。请用新密码登录。' })
                      else if (r === 'weak') setResetMsg({ ok: false, text: '新密码至少 8 位' })
                      else if (r === 'expired') setResetMsg({ ok: false, text: '链接已过期,请重新申请' })
                      else setResetMsg({ ok: false, text: '链接无效或已使用,请重新申请' })
                    }}
                    className="rounded-md bg-[#12141f] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    确认重置
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// —— 自助注册:选择团队,提交后进入待审批(GL / 所选团队 PL / 系统管理员审批) ——
function RegisterPanel({ onBack }: { onBack: (email?: string) => void }) {
  const [teams, setTeams] = useState<{ id: string; name: string }[] | null>(null)
  const [f, setF] = useState({ name: '', email: '', title: '', teamId: '', password: '', password2: '' })
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/auth/teams')
      .then(setTeams)
      .catch((e) => { setTeams([]); setMsg(e instanceof ApiError ? e.message : String(e)) })
  }, [])

  const cls = 'mt-1.5 w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20'

  if (done) {
    return (
      <div>
        <div className="ui-label text-teal-700">REGISTERED</div>
        <h2 className="mt-1 text-xl font-bold">申请已提交</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{done}</p>
        <button type="button" onClick={() => onBack(f.email.trim())} className="mt-6 w-full rounded-md bg-[#12141f] py-2.5 text-sm font-medium text-white hover:opacity-90">
          返回登录
        </button>
      </div>
    )
  }

  const ready = f.name.trim() && f.email.includes('@') && f.teamId && f.password.length >= 8 && f.password === f.password2
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (f.password !== f.password2) { setMsg('两次输入的密码不一致'); return }
        setBusy(true)
        try {
          const r = await api.post<{ message: string }>('/auth/register', {
            name: f.name.trim(), email: f.email.trim(), title: f.title.trim(), teamId: f.teamId, password: f.password,
          })
          setDone(r.message)
        } catch (err) {
          setMsg(err instanceof ApiError ? err.message : String(err))
        }
        setBusy(false)
      }}
    >
      <div className="ui-label text-teal-700">SIGN UP</div>
      <h2 className="mt-1 text-xl font-bold">注册账号</h2>
      <p className="mt-1 text-xs text-muted-foreground">提交后需由 GL 或所选团队的 PL 审批,通过后即可登录。</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="ui-label text-slate-500">姓名</span>
          <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={cls} />
        </label>
        <label className="block">
          <span className="ui-label text-slate-500">职位(可选)</span>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={cls} />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="ui-label text-slate-500">工作邮箱</span>
        <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@corp.local" className={cls} />
      </label>
      <label className="mt-3 block">
        <span className="ui-label text-slate-500">所属团队</span>
        <select value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })} className={cls} disabled={!teams?.length}>
          <option value="">{teams === null ? '加载中…' : '选择团队…'}</option>
          {teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="ui-label text-slate-500">密码(≥8 位)</span>
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={cls} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="ui-label text-slate-500">确认密码</span>
          <input type="password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} className={cls} autoComplete="new-password" />
        </label>
      </div>
      {f.password2 && f.password !== f.password2 && <p className="mt-2 text-xs text-red-600">两次输入的密码不一致</p>}
      {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}
      <button type="submit" disabled={!ready || busy} className="mt-5 w-full rounded-md bg-[#12141f] py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
        {busy ? '提交中…' : '提交注册申请'}
      </button>
      <p className="mt-3 text-center text-[13px] text-slate-500">
        已有账号?
        <button type="button" onClick={() => onBack()} className="ml-1 font-medium text-teal-700 hover:underline">返回登录</button>
      </p>
    </form>
  )
}
