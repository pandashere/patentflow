import { useState } from 'react'
import { useStore } from '@/lib/store'
import { KeyRound, MailQuestion, ScanFace, SquarePen, X } from 'lucide-react'

// 登录页:本地账密 + SSO 入口(接口解耦演示)
// 每个 SSO provider 对应后端 identity/provider 的一个实现,这里只做 UI 示意。
export default function Login() {
  const { setLoggedIn, config, login, requestPasswordReset, resetPassword } = useStore()
  const [account, setAccount] = useState('chenxi@corp.local')
  const [password, setPassword] = useState('')
  const [loginMsg, setLoginMsg] = useState('')
  const [ssoHint, setSsoHint] = useState<string | null>(null)

  // 忘记密码:申请 → (demo 展示链接)→ 打开链接设新密码
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLink, setForgotLink] = useState<string | null>(null)
  const [forgotSent, setForgotSent] = useState(false)
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [pwd1, setPwd1] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const enabledSso = config.ssoProviders.filter((p) => p.enabled && p.issuer !== 'local')

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
          <div className="mt-8 flex gap-6 font-mono-x text-[11px] tracking-widest text-[#6b7386]">
            <span>01 DRAFT</span>
            <span>02 REVIEW</span>
            <span>03 IMPL</span>
            <span>04 SEARCH</span>
            <span>05 DOI</span>
          </div>
        </div>
        <div className="font-mono-x text-[10px] tracking-widest text-[#565f75]">
          SQLITE · SINGLE PROCESS · SSO-READY
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm">
          <div className="ui-label text-teal-700">SIGN IN</div>
          <h2 className="mt-1 text-xl font-bold">登录专利管理系统</h2>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              const r = login(account, password)
              if (r === 'unknown') setLoginMsg('账号不存在')
              else if (r === 'wrong') setLoginMsg('密码错误。忘记密码可通过下方「忘记密码」重置')
              else setLoginMsg('')
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
                placeholder="演示环境任意输入"
              />
            </div>
            {loginMsg && <p className="text-xs text-red-600">{loginMsg}</p>}
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#12141f] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <KeyRound className="size-4" />
              本地账号登录
            </button>
          </form>

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
              <button type="button" onClick={() => setLoggedIn(true)} className="mt-2 block font-medium text-teal-700 underline underline-offset-2">
                模拟 SSO 登录成功 →
              </button>
            </div>
          )}

          <p className="mt-6 text-center text-[11px] text-slate-400">
            首次 SSO 登录将引导绑定本地账号(email 自动匹配 / 账密验证 / GL 预绑定)
          </p>
        </div>
      </div>

      {/* 忘记密码:经通知接口(webhook → 邮件/IM 适配器)投递一次性带 token 的重置链接 */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setForgotOpen(false)}>
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
              <button type="button" onClick={() => setForgotOpen(false)} className="rounded p-1 hover:bg-slate-100" aria-label="关闭">
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
                  <button type="button" onClick={() => setForgotOpen(false)} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
                    关闭
                  </button>
                  <button
                    type="button"
                    disabled={!forgotEmail.trim()}
                    onClick={() => { setForgotLink(requestPasswordReset(forgotEmail)); setForgotSent(true) }}
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
                  <button type="button" onClick={() => setForgotOpen(false)} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">
                    关闭
                  </button>
                  <button
                    type="button"
                    disabled={!pwd1 || !pwd2}
                    onClick={() => {
                      if (pwd1 !== pwd2) { setResetMsg({ ok: false, text: '两次输入的新密码不一致' }); return }
                      const r = resetPassword(resetToken, pwd1)
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
