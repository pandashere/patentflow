import { useState } from 'react'
import { useStore } from '@/lib/store'
import { KeyRound, ScanFace, SquarePen } from 'lucide-react'

// 登录页:本地账密 + SSO 入口(接口解耦演示)
// 每个 SSO provider 对应后端 identity/provider 的一个实现,这里只做 UI 示意。
export default function Login() {
  const { setLoggedIn, config } = useStore()
  const [account, setAccount] = useState('chenxi@corp.local')
  const [password, setPassword] = useState('')
  const [ssoHint, setSsoHint] = useState<string | null>(null)

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
              setLoggedIn(true)
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
              <label htmlFor="password" className="ui-label text-slate-500">密码</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
                placeholder="演示环境任意输入"
              />
            </div>
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
    </div>
  )
}
