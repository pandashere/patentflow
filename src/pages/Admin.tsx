import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore, teamName } from '@/lib/store'
import { TEAMS } from '@/lib/data'
import {
  NOTIFY_EVENT_LABEL, ROLE_LABEL, STAGES,
  type NotifyEvent, type Role,
} from '@/lib/types'
import { SectionTitle } from '@/components/pf'
import { Download, Link2, ShieldCheck, UserPlus, Webhook } from 'lucide-react'

const ROLE_STYLE: Record<Role, string> = {
  user: 'bg-slate-100 text-slate-600',
  pl: 'bg-sky-100 text-sky-800',
  gl: 'bg-[#12141f] text-teal-400',
}

const inputCls =
  'rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-50 disabled:text-slate-400'

export default function Admin() {
  const {
    me, config, setConfig, users, updateMember, addMember,
    tokens, adminRevokeToken, patents, transitions, versions, kpiRules,
  } = useStore()
  const isGl = me.role === 'gl'
  const myTeamUsers = users.filter((u) => me.role === 'gl' || u.teamId === me.teamId)

  const [adding, setAdding] = useState(false)
  const [newbie, setNew] = useState({ name: '', email: '', title: '', teamId: 't1', role: 'user' as Role })
  const [exported, setExported] = useState('')

  const download = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
    setExported(filename)
    setTimeout(() => setExported(''), 2500)
  }

  const exportJson = () =>
    download(
      `patentflow-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(), exportedBy: me.id,
          config, users, patents, transitions, versions, kpiRules,
        },
        null,
        2,
      ),
      'application/json',
    )

  const exportCsv = () => {
    const esc = (s: string) => `"${s.replaceAll('"', '""')}"`
    const rows = patents.map((p) => [
      p.code, esc(p.title), users.find((u) => u.id === p.ownerId)?.name ?? p.ownerId,
      teamName(p.teamId), p.visibility, p.stage,
      p.archived ? (p.archived.kind === 'completed' ? '完成归档' : '放弃归档') : '在研',
      p.createdAt, p.dueDates[p.stage] ?? '',
    ].join(','))
    download(
      `patentflow-patents-${new Date().toISOString().slice(0, 10)}.csv`,
      `﻿编号,标题,负责人,团队,可见性,阶段,状态,创建日,当前截止\n${rows.join('\n')}`,
      'text/csv;charset=utf-8',
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <SectionTitle
        en="TENANCY"
        zh="租户管理"
        right={
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
            {isGl ? 'GL · 全局管理(可编辑)' : 'PL · 仅本组成员(只读)'}
          </span>
        }
      />

      {/* 成员与角色 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">成员与角色</h3>
          {isGl && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              <UserPlus className="size-3.5" />
              添加成员
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-teal-200 bg-teal-50/50 p-4">
            <label className="block">
              <span className="ui-label text-slate-500">姓名</span>
              <input value={newbie.name} onChange={(e) => setNew({ ...newbie, name: e.target.value })} className={cn(inputCls, 'mt-1 w-28')} />
            </label>
            <label className="block">
              <span className="ui-label text-slate-500">邮箱</span>
              <input value={newbie.email} onChange={(e) => setNew({ ...newbie, email: e.target.value })} placeholder="name@corp.local" className={cn(inputCls, 'mt-1 w-44')} />
            </label>
            <label className="block">
              <span className="ui-label text-slate-500">职位</span>
              <input value={newbie.title} onChange={(e) => setNew({ ...newbie, title: e.target.value })} placeholder="工程师" className={cn(inputCls, 'mt-1 w-32')} />
            </label>
            <label className="block">
              <span className="ui-label text-slate-500">团队</span>
              <select value={newbie.teamId} onChange={(e) => setNew({ ...newbie, teamId: e.target.value })} className={cn(inputCls, 'mt-1')} aria-label="团队">
                {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="ui-label text-slate-500">角色</span>
              <select value={newbie.role} onChange={(e) => setNew({ ...newbie, role: e.target.value as Role })} className={cn(inputCls, 'mt-1')} aria-label="角色">
                <option value="user">普通用户</option>
                <option value="pl">PL</option>
                <option value="gl">GL</option>
              </select>
            </label>
            <button
              type="button"
              disabled={!newbie.name.trim() || !newbie.email.trim()}
              onClick={() => { addMember({ ...newbie, name: newbie.name.trim(), email: newbie.email.trim() }); setAdding(false); setNew({ name: '', email: '', title: '', teamId: 't1', role: 'user' }) }}
              className="rounded-md bg-teal-700 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              确认添加
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/70 text-left">
                <th className="px-4 py-2.5 ui-label text-slate-500">姓名</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">角色</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">团队</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">邮箱</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">SSO 绑定</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">API Token</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {myTeamUsers.map((u) => {
                const activeTokens = tokens.filter((t) => t.userId === u.id && !t.revoked)
                return (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{u.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{u.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      {isGl ? (
                        <select
                          value={u.role}
                          onChange={(e) => updateMember(u.id, { role: e.target.value as Role })}
                          className={cn(inputCls, 'py-1 text-xs')}
                          aria-label={`${u.name} 的角色`}
                        >
                          <option value="user">普通用户</option>
                          <option value="pl">PL</option>
                          <option value="gl">GL</option>
                        </select>
                      ) : (
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', ROLE_STYLE[u.role])}>
                          {ROLE_LABEL[u.role]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isGl ? (
                        <select
                          value={u.teamId}
                          onChange={(e) => updateMember(u.id, { teamId: e.target.value })}
                          className={cn(inputCls, 'py-1 text-xs')}
                          aria-label={`${u.name} 的团队`}
                        >
                          {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">{teamName(u.teamId)}</span>
                      )}
                    </td>
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
                    <td className="px-4 py-3">
                      {activeTokens.length === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="font-mono-x">{activeTokens.length} 个有效</span>
                          {isGl && (
                            <button
                              type="button"
                              onClick={() => activeTokens.forEach((t) => adminRevokeToken(t.id))}
                              className="text-red-600 hover:underline"
                            >
                              全部吊销
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Reviewer 不是行政角色,不在此表维护 —— 它以「按专利邀请」的方式存在(见 review_assignment)。
          专利负责人变更在专利详情页操作(负责人/本组 PL/GL)。
        </p>
      </section>

      {/* 审查门禁 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">审查门禁规则</h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">通过人数 n</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                至少 n 名 reviewer 判定「通过」且加权达标才可进入实施;任一打回自动退回草案
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

          <div className="border-t pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">加权均分下限</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  「通过」的加权均分低于该值时不计入门禁(提交通过会被拦截并提示)
                </div>
              </div>
              <input
                type="number" min={1} max={5} step={0.5}
                value={config.reviewMinWeighted}
                disabled={!isGl}
                onChange={(e) => setConfig({ ...config, reviewMinWeighted: Math.min(5, Math.max(1, Number(e.target.value))) })}
                className={cn(inputCls, 'w-20 text-center font-mono-x')}
                aria-label="加权均分下限"
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {config.reviewDims.map((d, i) => (
                <div key={d.key} className="rounded-md border bg-slate-50/60 p-3">
                  <label className="ui-label text-slate-500">维度 {i + 1} 名称</label>
                  <input
                    value={d.label}
                    disabled={!isGl}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reviewDims: config.reviewDims.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                      })
                    }
                    className={cn(inputCls, 'mt-1 w-full')}
                  />
                  <label className="mt-2 block ui-label text-slate-500">权重</label>
                  <input
                    type="number" min={0.5} max={3} step={0.5}
                    value={d.weight}
                    disabled={!isGl}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reviewDims: config.reviewDims.map((x, j) =>
                          (j === i ? { ...x, weight: Math.min(3, Math.max(0.5, Number(e.target.value))) } : x),
                        ),
                      })
                    }
                    className={cn(inputCls, 'mt-1 w-20 font-mono-x')}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 阶段默认周期 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">阶段默认周期(天)</h3>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs text-muted-foreground">
            新建专利 / 推进阶段时,按此自动算出对应阶段的 due date(发明人可在详情页再调整)。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {STAGES.map((s) => (
              <label key={s.key} className="block rounded-md border bg-slate-50/60 p-3">
                <span className="ui-label text-slate-500">{s.label}</span>
                <input
                  type="number" min={1} max={180}
                  value={config.stageDefaults[s.key]}
                  disabled={!isGl}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      stageDefaults: { ...config.stageDefaults, [s.key]: Math.max(1, Number(e.target.value)) },
                    })
                  }
                  className={cn(inputCls, 'mt-1.5 w-full text-center font-mono-x')}
                />
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* 通知默认 */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Webhook className="size-4 text-teal-700" />
          通知默认与回调
        </h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div>
            <div className="text-sm font-medium">事件默认接收人</div>
            <p className="mt-0.5 text-xs text-muted-foreground">新专利按此默认配置通知人;单个专利可在详情页「通知设置」覆盖。</p>
            <div className="mt-3 space-y-2">
              {(Object.keys(NOTIFY_EVENT_LABEL) as NotifyEvent[]).map((ev) => (
                <div key={ev} className="flex items-center gap-3">
                  <span className="w-20 text-[13px] font-medium">{NOTIFY_EVENT_LABEL[ev]}</span>
                  <div className="flex gap-1.5">
                    {([['owner', '发明人'], ['pl', '本组 PL'], ['gl', 'GL']] as const).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        disabled={!isGl}
                        onClick={() =>
                          setConfig({
                            ...config,
                            notifyDefaults: {
                              ...config.notifyDefaults,
                              [ev]: { ...config.notifyDefaults[ev], [k]: !config.notifyDefaults[ev][k] },
                            },
                          })
                        }
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                          config.notifyDefaults[ev][k]
                            ? 'border-[#12141f] bg-[#12141f] text-white'
                            : 'text-slate-500 hover:bg-slate-50',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Webhook 回调地址</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                通知事件将以 POST + 签名头发送到该地址;个人可在「个人中心」订阅/屏蔽事件
              </div>
            </div>
            <input
              value={config.webhookUrl}
              disabled={!isGl}
              onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
              className={cn(inputCls, 'w-full max-w-sm font-mono-x text-xs')}
            />
          </div>
        </div>
      </section>

      {/* 编号与分类词表 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">编号与分类规范</h3>
        <div className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-3">
          <div>
            <label className="ui-label text-slate-500">专利编号前缀</label>
            <input
              value={config.numberPrefix}
              disabled={!isGl}
              onChange={(e) => setConfig({ ...config, numberPrefix: e.target.value.toUpperCase() })}
              className={cn(inputCls, 'mt-1.5 w-28 font-mono-x')}
            />
            <p className="mt-1.5 text-[11px] text-slate-400">新专利编号形如 {config.numberPrefix || 'PF'}-{new Date().getFullYear()}-0xx</p>
          </div>
          <div className="sm:col-span-2">
            <label className="ui-label text-slate-500">class 分类建议词表(自由文本的输入联想,不强制)</label>
            <textarea
              rows={2}
              disabled={!isGl}
              value={config.classSuggestions.join('、')}
              onChange={(e) =>
                setConfig({ ...config, classSuggestions: e.target.value.split(/[、,,\n]/).map((s) => s.trim()).filter(Boolean) })
              }
              className={cn(inputCls, 'mt-1.5 w-full')}
            />
          </div>
        </div>
      </section>

      {/* 数据导出 */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Download className="size-4 text-teal-700" />
          数据导出
        </h3>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-5">
          <button
            type="button"
            onClick={exportJson}
            className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
          >
            <Download className="size-3.5" />
            全量导出 JSON
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-[13px] font-medium hover:bg-slate-50"
          >
            <Download className="size-3.5" />
            专利清单 CSV
          </button>
          <span className="text-xs text-muted-foreground">
            {exported ? `已下载 ${exported}` : 'JSON 含专利/流转/版本/KPI/配置全量;CSV 为专利清单(含归档状态),用于汇报'}
          </span>
        </div>
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
    </div>
  )
}
