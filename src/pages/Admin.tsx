import { cn } from '@/lib/utils'
import { useStore, teamName } from '@/lib/store'
import { USERS } from '@/lib/data'
import { ROLE_LABEL, type Role } from '@/lib/types'
import { SectionTitle } from '@/components/pf'
import { KeyRound, Link2, ShieldCheck, Webhook } from 'lucide-react'

const ROLE_STYLE: Record<Role, string> = {
  user: 'bg-slate-100 text-slate-600',
  pl: 'bg-sky-100 text-sky-800',
  gl: 'bg-[#12141f] text-teal-400',
}

export default function Admin() {
  const { me, config, setConfig } = useStore()
  const isGl = me.role === 'gl'
  const myTeamUsers = USERS.filter((u) => me.role === 'gl' || u.teamId === me.teamId)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <SectionTitle
        en="TENANCY"
        zh="租户管理"
        right={
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
            {isGl ? 'GL · 全局管理' : 'PL · 仅本组成员(只读)'}
          </span>
        }
      />

      {/* 成员与角色 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">成员与角色</h3>
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/70 text-left">
                <th className="px-4 py-2.5 ui-label text-slate-500">姓名</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">角色</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">团队</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">邮箱</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">SSO 绑定</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {myTeamUsers.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{u.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{u.title}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', ROLE_STYLE[u.role])}>
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">{teamName(u.teamId)}</td>
                  <td className="px-4 py-3 font-mono-x text-xs text-slate-500">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.ssoBound ? (
                      <span className="inline-flex items-center gap-1 text-xs text-teal-700">
                        <Link2 className="size-3" />
                        {u.ssoIssuer}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">未绑定</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Reviewer 不是行政角色,不在此表维护 —— 它以「按专利邀请」的方式存在(见 review_assignment)。
        </p>
      </section>

      {/* SSO 提供方 */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-teal-700" />
          SSO 接入(IdentityProvider 接口)
        </h3>
        <div className="divide-y rounded-lg border bg-card">
          {config.ssoProviders.map((p) => (
            <div key={p.issuer} className="flex items-center gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="mt-0.5 font-mono-x text-[11px] text-slate-400">
                  issuer: {p.issuer} · GET /auth/sso/{p.issuer}/begin → callback(issuer, subject)
                </div>
              </div>
              <button
                type="button"
                disabled={!isGl || p.issuer === 'local'}
                onClick={() =>
                  setConfig({
                    ...config,
                    ssoProviders: config.ssoProviders.map((x) =>
                      x.issuer === p.issuer ? { ...x, enabled: !x.enabled } : x,
                    ),
                  })
                }
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                  p.enabled ? 'bg-teal-600' : 'bg-slate-300',
                )}
                role="switch"
                aria-checked={p.enabled}
                aria-label={`${p.name} 开关`}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                    p.enabled ? 'left-[22px]' : 'left-0.5',
                  )}
                />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-dashed bg-slate-50/60 px-4 py-3 text-xs leading-relaxed text-slate-600">
          <strong>接入方式:</strong>新增一个实现 <code className="font-mono-x">IdentityProvider</code> 接口的类
          (<code className="font-mono-x">begin_auth / complete_auth</code>),注册为新 issuer 即可。
          身份绑定策略可配:email 自动匹配 / 首次登录账密绑定 / GL 预绑定 subject。
        </div>
      </section>

      {/* 系统参数 */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-teal-700" />
          系统参数
        </h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">可专利性审查通过人数 n</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                至少 n 名 reviewer 判定「通过」才可进入实施阶段;任一打回自动退回草案
              </div>
            </div>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={!isGl}
                  onClick={() => setConfig({ ...config, reviewPassCount: n })}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-md border font-mono-x text-sm font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                    config.reviewPassCount === n
                      ? 'border-teal-600 bg-teal-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Webhook className="size-4 text-slate-400" />
                通知 Webhook 回调地址
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                通知事件(审查 / 截止提醒 / 阶段流转)将以 POST + 签名头发送到该地址
              </div>
            </div>
            <input
              value={config.webhookUrl}
              disabled={!isGl}
              onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
              className="w-full max-w-sm rounded-md border px-3 py-2 font-mono-x text-xs outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-50"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
