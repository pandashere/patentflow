import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore, teamName } from '@/lib/store'
import { TEAMS } from '@/lib/data'
import {
  NOTIFY_EVENT_LABEL, ROLE_LABEL, STAGES,
  type NotifyEvent, type Role,
} from '@/lib/types'
import { SectionTitle, StagePill, ToneTag, VisibilityTag } from '@/components/pf'
import { Modal } from './PatentDetail'
import { Download, Link2, Plus, ShieldCheck, UserMinus, UserPlus, Webhook } from 'lucide-react'

const ROLE_STYLE: Record<Role, string> = {
  user: 'bg-slate-100 text-slate-600',
  pl: 'bg-sky-100 text-sky-800',
  gl: 'bg-[#12141f] text-teal-400',
}

const inputCls =
  'rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-50 disabled:text-slate-400'

export default function Admin() {
  const {
    me, config, setConfig, users, updateMember,
    tokens, adminRevokeToken,
    cycles, saveCycle, closeCycle, reactivateMember,
  } = useStore()
  const [offboarding, setOffboarding] = useState<string | null>(null)
  const isGl = me.role === 'gl'
  const myTeamUsers = users.filter((u) => me.role === 'gl' || u.teamId === me.teamId)

  const [exported, setExported] = useState('')
  const [newCycle, setNewCycle] = useState({ name: '', start: '', end: '' })

  // 导出由后端生成(GL 权限校验;私有专利及其版本/流转不进入导出)
  const download = (path: string, label: string) => {
    const a = document.createElement('a')
    a.href = `/api${path}`
    a.download = ''
    a.click()
    setExported(label)
    setTimeout(() => setExported(''), 2500)
  }
  const exportJson = () => download('/export.json', 'JSON 全量导出')
  const exportCsv = () => download('/export/patents.csv', '专利清单 CSV')

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <SectionTitle
        page
        en="TENANCY"
        zh="租户管理"
        right={
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
            {isGl ? 'GL · 全局管理(可编辑)' : 'PL · 仅本组成员(只读)'}
          </span>
        }
      />

      <PendingRegistrations />

      <TeamsPanel />

      {/* 成员与角色 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">成员与角色</h3>
          <AddMemberButton />
        </div>

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
                {isGl && <th className="px-4 py-2.5 ui-label text-slate-500">状态</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {myTeamUsers.map((u) => {
                const activeTokens = tokens.filter((t) => t.userId === u.id && !t.revoked)
                return (
                  <tr key={u.id} className={cn(u.deactivated && 'bg-slate-50 text-slate-400')}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{u.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{u.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      {isGl ? (
                        <select
                          value={u.role}
                          disabled={u.id === me.id}
                          title={u.id === me.id ? '不能降级自己' : undefined}
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
                    {isGl && (
                      <td className="px-4 py-3">
                        {u.deactivated ? (
                          <span className="flex items-center gap-2">
                            <ToneTag tone="neutral">已停用</ToneTag>
                            <button type="button" onClick={() => reactivateMember(u.id)} className="text-xs text-teal-700 hover:underline">
                              恢复
                            </button>
                          </span>
                        ) : u.id !== me.id ? (
                          <button
                            type="button"
                            onClick={() => setOffboarding(u.id)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
                          >
                            <UserMinus className="size-3.5" />
                            停用 / 离职交接
                          </button>
                        ) : (
                          <ToneTag tone="ok">在职</ToneTag>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Reviewer 不是行政角色,不在此表维护 —— 它以「按专利邀请」的方式存在(见 review_assignment)。
          专利转交在专利详情页「更多」或个人中心操作;成员停用时须先完成离职交接。
          成员换组时,其名下专利留在原组,由原组 PL 或 GL 在详情页手动迁移。
          账号异常(忘记密码、唯一 GL 离职或被误降级等)由配置文件中的系统管理员在独立后台 /sysadmin 处理。
        </p>
      </section>

      {/* 权限矩阵 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">权限矩阵(后端强制校验,前端仅显隐)</h3>
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/70 text-left">
                <th className="px-4 py-2.5 ui-label text-slate-500">能力</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">普通用户</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">PL</th>
                <th className="px-4 py-2.5 ui-label text-slate-500">GL</th>
              </tr>
            </thead>
            <tbody className="divide-y text-[13px]">
              {([
                ['新建专利 / 编辑本人的专利内容', '本人', '本人', '本人'],
                ['推进 / 回退 / 归档 / 转交 / 申请延期', '本人专利', '本组成员专利', '全部(非私有)'],
                ['删除专利(从未离开草案且未邀请 reviewer)', '本人专利', '本人专利', '本人专利'],
                ['迁移专利所属团队', '—', '本组专利', '全部(非私有)'],
                ['审批超阈值延期', '—', '本组(含自己的专利,留痕)', '全部'],
                ['查看团队可见专利', '同组', '本组', '全部'],
                ['查看私有专利', '仅本人', '不可见', '不可见'],
                ['可专利性审查打分', '被邀请时', '被邀请时', '被邀请时'],
                ['KPI 规则管理', '—', '本组规则', '全局规则'],
                ['专利周期 / 逾期策略 / 审查门禁等系统配置', '—', '只读', '可编辑'],
                ['成员与角色管理 / 停用与离职交接', '—', '本组只读', '可编辑(不能降级自己)'],
                ['跨周期标记 / Token 全局吊销 / 数据导出', '—', '—', '可操作'],
                ['账号救援(重置密码 / 恢复账号 / 指定 GL)', '—', '—', '系统管理员(配置文件账号,独立后台)'],
              ] as [string, string, string, string][]).map(([cap, u, pl, gl]) => (
                <tr key={cap}>
                  <td className="px-4 py-2.5 font-medium">{cap}</td>
                  <td className={cn('px-4 py-2.5', u === '—' ? 'text-slate-300' : 'text-slate-600')}>{u}</td>
                  <td className={cn('px-4 py-2.5', pl === '—' ? 'text-slate-300' : 'text-slate-600')}>{pl}</td>
                  <td className={cn('px-4 py-2.5', gl === '—' ? 'text-slate-300' : 'text-slate-600')}>{gl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          共同发明人可编辑内容但不可操作;reviewer 仅对被邀请专利有审查打分权。
          后端每个写接口以 FastAPI 依赖注入重做以上校验,前端隐藏按钮只是体验层。
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
                本轮至少 n 名 reviewer 判定「通过」且加权达标才可进入实施;本轮有打回则门禁关闭,由发明人修改后发起新一轮
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
              <div className="text-sm font-medium">reviewer 审查期限(天)</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                邀请后 N 天为该 reviewer 的审查截止日;到期只发提醒,不自动撤销或判定
              </div>
            </div>
            <input
              type="number" min={1} max={60}
              value={config.reviewerDueDays}
              disabled={!isGl}
              onChange={(e) => setConfig({ ...config, reviewerDueDays: Math.max(1, Number(e.target.value)) })}
              className={cn(inputCls, 'w-20 text-center font-mono-x')}
              aria-label="reviewer 审查期限"
            />
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

      {/* 专利周期 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">专利周期(项目级时间窗口)</h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <p className="text-xs text-muted-foreground">
            周期由 GL 定义项目的整体专利窗口;任何人自定的阶段周期、KPI 目标截止日都必须落在周期内(超出自动截断)。
            专利按创建日归入周期;周期收口后 KPI 冻结为快照,未完成的专利转入逾期管理或由 GL 标记跨周期。
          </p>
          <div className="divide-y rounded-md border">
            {cycles.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {c.name}
                    <span className={cn(
                      'rounded-full px-2 py-px text-[10px] font-medium',
                      c.status === 'active' ? 'bg-teal-50 text-teal-700' : 'bg-slate-200 text-slate-500',
                    )}>
                      {c.status === 'active' ? '进行中' : '已收口'}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono-x text-xs text-muted-foreground">
                    {c.start} ~ {c.end}
                    {c.closedAt && <span className="ml-2">收口于 {c.closedAt}</span>}
                  </div>
                </div>
                {isGl && c.status === 'active' && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      结束日
                      <input
                        type="date"
                        value={c.end}
                        onChange={(e) => saveCycle({ ...c, end: e.target.value })}
                        className={cn(inputCls, 'py-1')}
                        aria-label={`${c.name} 结束日`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => closeCycle(c.id)}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      收口
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {isGl && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
              <label className="block">
                <span className="ui-label text-slate-500">周期名称</span>
                <input
                  value={newCycle.name}
                  onChange={(e) => setNewCycle({ ...newCycle, name: e.target.value })}
                  placeholder="如 2027 年度"
                  className={cn(inputCls, 'mt-1 w-32')}
                />
              </label>
              <label className="block">
                <span className="ui-label text-slate-500">开始</span>
                <input type="date" value={newCycle.start} onChange={(e) => setNewCycle({ ...newCycle, start: e.target.value })} className={cn(inputCls, 'mt-1')} aria-label="周期开始" />
              </label>
              <label className="block">
                <span className="ui-label text-slate-500">结束</span>
                <input type="date" value={newCycle.end} onChange={(e) => setNewCycle({ ...newCycle, end: e.target.value })} className={cn(inputCls, 'mt-1')} aria-label="周期结束" />
              </label>
              <button
                type="button"
                disabled={!newCycle.name.trim() || !newCycle.start || !newCycle.end || newCycle.end <= newCycle.start}
                onClick={() => {
                  saveCycle({
                    id: `c${Date.now()}`, name: newCycle.name.trim(),
                    start: newCycle.start, end: newCycle.end, status: 'active',
                  })
                  setNewCycle({ name: '', start: '', end: '' })
                }}
                className="rounded-md bg-teal-700 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                新建周期
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 逾期策略 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">逾期策略</h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">延期审批阈值(天)</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                同一阶段累计延期 ≤ 该值自动生效;超过则挂起,需本组 PL 或 GL 批准(PL 可自批,留痕)
              </div>
            </div>
            <input
              type="number" min={1} max={90}
              value={config.overdue.extensionApprovalThreshold}
              disabled={!isGl}
              onChange={(e) =>
                setConfig({ ...config, overdue: { ...config.overdue, extensionApprovalThreshold: Math.max(1, Number(e.target.value)) } })
              }
              className={cn(inputCls, 'w-20 text-center font-mono-x')}
              aria-label="延期审批阈值"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">放弃归档退出 KPI 分母的提前量(天)</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                放弃日早于周期结束前 N 天,才退出该周期 KPI 分母;之后放弃的仍计入,防止收口前突击放弃刷分
              </div>
            </div>
            <input
              type="number" min={0} max={180}
              value={config.overdue.abandonExcludeDays}
              disabled={!isGl}
              onChange={(e) => setConfig({ ...config, overdue: { ...config.overdue, abandonExcludeDays: Math.max(0, Number(e.target.value)) } })}
              className={cn(inputCls, 'w-20 text-center font-mono-x')}
              aria-label="放弃归档提前量"
            />
          </div>

          {([
            ['freezeAdvanceOnOverdue', '阶段逾期时冻结推进', '开启后,当前阶段已逾期的专利不能推进到下一阶段,须先申请延期或调整截止日'],
            ['includeCrossCycleInKpi', '跨周期专利计入 KPI', 'GL 标记为跨周期的专利,其周期内的阶段推进事件是否计入 KPI 分子/分母'],
          ] as const).map(([key, label, desc]) => (
            <div key={key} className="flex flex-wrap items-center gap-3 border-t pt-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
              </div>
              <button
                type="button"
                disabled={!isGl}
                onClick={() => setConfig({ ...config, overdue: { ...config.overdue, [key]: !config.overdue[key] } })}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                  config.overdue[key] ? 'bg-teal-600' : 'bg-slate-300',
                )}
                role="switch"
                aria-checked={config.overdue[key]}
                aria-label={label}
              >
                <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', config.overdue[key] ? 'left-[22px]' : 'left-0.5')} />
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">自动催办节奏</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                逾期后按节奏自动给负责人发催办通知(demo 为配置占位,实际由后端定时任务执行)
              </div>
            </div>
            <div className="flex gap-1.5">
              {([['off', '关闭'], ['3d', '每 3 天'], ['7d', '每 7 天']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  disabled={!isGl}
                  onClick={() => setConfig({ ...config, overdue: { ...config.overdue, autoNudge: v } })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                    config.overdue.autoNudge === v ? 'border-[#12141f] bg-[#12141f] text-white' : 'text-slate-500 hover:bg-slate-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
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
          <WebhookField />
          <div className="rounded-md border border-dashed bg-slate-50/60 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
            <strong>账号安全事件</strong>(忘记密码的重置链接)经同一 webhook 回调投递,由邮件/IM 适配器送达本人:
            <strong>强制送达</strong>,不受个人订阅与免打扰影响;链接带一次性 token,30 分钟有效、用后作废;
            无论账号是否存在都返回相同话术,不泄露注册状态。
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
      {offboarding && <OffboardDialog userId={offboarding} onClose={() => setOffboarding(null)} />}
    </div>
  )
}

// —— 停用 / 离职交接 ——
// 非私有专利必须逐件指定接收人;私有草案可指定,不指定则自动转为团队可见并交给本组 PL。
// 停用同时吊销其全部 Token、撤销其尚未提交的 reviewer 邀请。
function OffboardDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { patents, users, activeUsers, deactivateMember, userById } = useStore()
  const u = userById(userId)
  // 私有草案对 GL/PL 完全透明:这里只显示件数,不显示标题;指定接收人须由本人在个人中心提前转交
  const owned = patents.filter((p) => p.ownerId === userId && p.visibility !== 'private')
  const pendingReviews = patents.filter((p) => p.stageData.patentability.reviewers.some((r) => r.userId === userId && !r.score)).length
  const pl = users.find((x) => x.role === 'pl' && x.teamId === u.teamId && x.id !== userId)
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [all, setAll] = useState('')
  const missing = owned.filter((p) => p.visibility !== 'private' && !assign[p.id]).length
  const candidates = activeUsers.filter((x) => x.id !== userId)

  return (
    <Modal
      title={`停用 ${u.name} · 离职交接`}
      wide
      onClose={onClose}
      confirm={{
        label: missing ? `还有 ${missing} 件未指定接收人` : '确认交接并停用',
        tone: 'danger',
        disabled: missing > 0,
        onClick: async () => { if ((await deactivateMember(userId, assign)) === 'ok') onClose() },
      }}
    >
      <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        <li>名下 {owned.length} 件非私有专利,必须逐件指定接收人。</li>
        <li>
          其私有草案对你不可见(不显示件数与标题)。本人可在个人中心「专利转交」中提前指定接收人;
          停用时仍未转交的,将转为「团队可见」并交给本组 PL{pl ? `(${pl.name})` : ''}。
        </li>
        <li>停用后吊销其全部 API Token;撤销其 {pendingReviews} 个未提交的审查邀请,并通知相关发明人。</li>
      </ul>
      {owned.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="text-slate-500">一键全部交给</span>
            <select
              value={all}
              onChange={(e) => {
                setAll(e.target.value)
                setAssign(Object.fromEntries(owned.map((p) => [p.id, e.target.value])))
              }}
              className="rounded-md border bg-white px-2 py-1 text-xs outline-none focus:border-teal-600"
            >
              <option value="">—</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="divide-y rounded-md border">
            {owned.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px]">{p.title}</span>
                <VisibilityTag v={p.visibility} />
                <StagePill stage={p.stage} />
                <select
                  value={assign[p.id] ?? ''}
                  onChange={(e) => setAssign({ ...assign, [p.id]: e.target.value })}
                  className={cn(
                    'w-32 rounded-md border bg-white px-2 py-1 text-xs outline-none focus:border-teal-600',
                    !assign[p.id] && 'border-red-300',
                  )}
                  aria-label={`${p.title} 的接收人`}
                >
                  <option value="">选择接收人…</option>
                  {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

// —— 待审批注册:GL 看全部,PL 看本组;GL 审批时可调整团队与角色 ——
function PendingRegistrations() {
  const { pendingRegistrations, approveRegistration, rejectRegistration, me, teams } = useStore()
  const [patch, setPatch] = useState<Record<string, { teamId: string; role: Role }>>({})
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  if (pendingRegistrations.length === 0) return null
  const isGl = me.role === 'gl'
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        待审批的注册
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{pendingRegistrations.length}</span>
      </h3>
      <div className="divide-y rounded-lg border border-amber-200 bg-amber-50/30">
        {pendingRegistrations.map((u) => {
          const p = patch[u.id] ?? { teamId: u.teamId, role: 'user' as Role }
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {u.name}
                  {u.title && <span className="ml-2 text-xs font-normal text-muted-foreground">{u.title}</span>}
                </div>
                <div className="font-mono-x text-[11px] text-slate-500">{u.email} · 申请于 {u.pending?.at}</div>
              </div>
              {isGl ? (
                <>
                  <select value={p.teamId} onChange={(e) => setPatch({ ...patch, [u.id]: { ...p, teamId: e.target.value } })} className={cn(inputCls, 'py-1 text-xs')} aria-label="团队">
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === u.teamId ? '(申请)' : ''}</option>)}
                  </select>
                  <select value={p.role} onChange={(e) => setPatch({ ...patch, [u.id]: { ...p, role: e.target.value as Role } })} className={cn(inputCls, 'py-1 text-xs')} aria-label="角色">
                    <option value="user">普通用户</option>
                    <option value="pl">PL</option>
                    <option value="gl">GL</option>
                  </select>
                </>
              ) : (
                <span className="text-xs text-slate-500">申请加入「{teamName(u.teamId)}」</span>
              )}
              {rejecting === u.id ? (
                <span className="flex items-center gap-1.5">
                  <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因(会告知对方)" className={cn(inputCls, 'w-44 py-1 text-xs')} />
                  <button type="button" disabled={!reason.trim()} onClick={() => { rejectRegistration(u.id, reason.trim()); setRejecting(null); setReason('') }} className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40">确认拒绝</button>
                  <button type="button" onClick={() => setRejecting(null)} className="text-xs text-slate-400">取消</button>
                </span>
              ) : (
                <span className="flex gap-1.5">
                  <button type="button" onClick={() => approveRegistration(u.id, isGl ? p : {})} className="rounded-md bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:opacity-90">通过</button>
                  <button type="button" onClick={() => { setRejecting(u.id); setReason('') }} className="rounded-md border px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">拒绝</button>
                </span>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">通过后对方会收到通知,即可用注册时设置的密码登录。</p>
    </section>
  )
}

// —— 添加成员:必须选团队;PL 只能向本组添加普通用户。成功后显示一次激活链接 ——
function AddMemberButton() {
  const { me, teams, addMember, canManageTeam, config } = useStore()
  const manageable = teams.filter((t) => canManageTeam(t.id))
  const [open, setOpen] = useState(false)
  const [m, setM] = useState({ name: '', email: '', title: '', teamId: '', role: 'user' as Role })
  const [link, setLink] = useState<{ name: string; url: string } | null>(null)
  if (manageable.length === 0) {
    return me.role === 'pl' && !config.members.plCanManage
      ? <span className="text-xs text-muted-foreground">GL 已收回 PL 的添加成员权限</span>
      : null
  }
  const isGl = me.role === 'gl'
  const teamId = m.teamId || (isGl ? '' : manageable[0].id)
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setM({ name: '', email: '', title: '', teamId: isGl ? '' : manageable[0].id, role: 'user' }) }}
        className="flex items-center gap-1.5 rounded-md bg-[#12141f] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        <UserPlus className="size-3.5" />
        添加成员
      </button>
      {open && (
        <Modal
          title="添加成员"
          onClose={() => setOpen(false)}
          confirm={{
            label: '添加并发送激活链接', tone: 'dark',
            disabled: !m.name.trim() || !m.email.includes('@') || !teamId,
            onClick: async () => {
              const url = await addMember({ ...m, teamId, name: m.name.trim(), email: m.email.trim() })
              if (url) { setOpen(false); setLink({ name: m.name.trim(), url }) }
            },
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="ui-label text-slate-500">姓名</span>
              <input autoFocus value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} className={cn(inputCls, 'mt-1 w-full')} />
            </label>
            <label className="block">
              <span className="ui-label text-slate-500">职位(可选)</span>
              <input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder="工程师" className={cn(inputCls, 'mt-1 w-full')} />
            </label>
            <label className="col-span-2 block">
              <span className="ui-label text-slate-500">邮箱(登录账号)</span>
              <input value={m.email} onChange={(e) => setM({ ...m, email: e.target.value })} placeholder="name@corp.local" className={cn(inputCls, 'mt-1 w-full')} />
            </label>
            <label className="block">
              <span className="ui-label text-slate-500">团队</span>
              {isGl ? (
                <select value={m.teamId} onChange={(e) => setM({ ...m, teamId: e.target.value })} className={cn(inputCls, 'mt-1 w-full')}>
                  <option value="">选择团队…</option>
                  {manageable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : (
                <div className="mt-1 rounded-md border bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-600">{teamName(teamId)}(本组)</div>
              )}
            </label>
            <label className="block">
              <span className="ui-label text-slate-500">角色</span>
              {isGl ? (
                <select value={m.role} onChange={(e) => setM({ ...m, role: e.target.value as Role })} className={cn(inputCls, 'mt-1 w-full')}>
                  <option value="user">普通用户</option>
                  <option value="pl">PL</option>
                  <option value="gl">GL</option>
                </select>
              ) : (
                <div className="mt-1 rounded-md border bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-600">普通用户</div>
              )}
            </label>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            对方会收到一条带激活链接的通知(7 天内有效),点开后自行设置密码。
            {isGl && m.role === 'pl' && ' 如需让 TA 成为某个团队的负责人,请在「团队」里指定。'}
          </p>
        </Modal>
      )}
      {link && (
        <Modal title={`已添加 ${link.name}`} onClose={() => setLink(null)} confirm={{ label: '完成', tone: 'dark', onClick: () => setLink(null) }}>
          <p className="text-[13px] text-slate-600">激活链接已经通过通知发给对方。如果对方没收到,可以把下面的链接直接转给 TA(7 天内有效,只显示这一次):</p>
          <code className="mt-2 block break-all rounded-md border bg-slate-50 px-3 py-2 font-mono-x text-xs">{link.url}</code>
          <button type="button" onClick={() => navigator.clipboard?.writeText(link.url)} className="mt-2 text-xs text-teal-700 hover:underline">复制链接</button>
        </Modal>
      )}
    </>
  )
}

// —— 团队:GL 新建 / 改名 / 删除,指定或更换 PL;PL 只读 ——
function TeamsPanel() {
  const { me, teams, users, patents, createTeam, renameTeam, deleteTeam, config, setConfig, userById } = useStore()
  const isGl = me.role === 'gl'
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [plFor, setPlFor] = useState<string | null>(null)
  const active = users.filter((u) => !u.deactivated)

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">团队</h3>
        {isGl && !creating && (
          <button type="button" onClick={() => { setCreating(true); setNewName('') }} className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
            <Plus className="size-3.5" />
            新建团队
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((t) => {
          const members = active.filter((u) => u.teamId === t.id)
          const teamPatents = patents.filter((p) => p.teamId === t.id).length
          const pl = t.plId ? userById(t.plId) : null
          return (
            <div key={t.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                {editing === t.id ? (
                  <input
                    autoFocus value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { if (editName.trim() && editName.trim() !== t.name) renameTeam(t.id, editName.trim()); setEditing(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null) }}
                    className={cn(inputCls, 'min-w-0 flex-1 py-1')}
                  />
                ) : (
                  <button
                    type="button" disabled={!isGl}
                    onClick={() => { setEditing(t.id); setEditName(t.name) }}
                    title={isGl ? '点击改名' : undefined}
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold enabled:hover:text-teal-700"
                  >
                    {t.name}
                  </button>
                )}
                <span className="text-[11px] text-muted-foreground">{members.length} 人</span>
              </div>
              <div className="mt-2.5 flex items-center gap-2 text-[13px]">
                <span className="text-xs text-slate-400">PL</span>
                {pl ? (
                  <span className="font-medium">{pl.name}</span>
                ) : (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">空缺</span>
                )}
                {isGl && (
                  <button type="button" onClick={() => setPlFor(t.id)} className="ml-auto text-xs text-teal-700 hover:underline">
                    {pl ? '更换' : '指定'}
                  </button>
                )}
              </div>
              {isGl && members.length === 0 && teamPatents === 0 && (
                <button type="button" onClick={() => deleteTeam(t.id)} className="mt-2 text-[11px] text-slate-400 hover:text-red-600">删除空团队</button>
              )}
            </div>
          )
        })}
        {creating && (
          <div className="rounded-lg border-2 border-dashed border-teal-300 bg-teal-50/30 p-4">
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="团队名称" className={cn(inputCls, 'w-full')} />
            <p className="mt-2 text-[11px] text-muted-foreground">创建后可随时指定 PL。</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button" disabled={!newName.trim()}
                onClick={async () => { if (await createTeam(newName.trim(), null, true)) setCreating(false) }}
                className="rounded-md bg-[#12141f] px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                创建
              </button>
              <button type="button" onClick={() => setCreating(false)} className="text-xs text-slate-500">取消</button>
            </div>
          </div>
        )}
      </div>

      {isGl && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3">
          <MiniSwitch
            label="开放自助注册"
            hint="新人可在登录页注册并选择团队,经审批后才能登录"
            on={config.members.selfRegistration}
            onChange={(v) => setConfig({ ...config, members: { ...config.members, selfRegistration: v } })}
          />
          <MiniSwitch
            label="PL 可添加本组成员、审批本组注册"
            hint="关闭后仅 GL 与系统管理员可以"
            on={config.members.plCanManage}
            onChange={(v) => setConfig({ ...config, members: { ...config.members, plCanManage: v } })}
          />
        </div>
      )}

      {plFor && <ChangePlDialog teamId={plFor} onClose={() => setPlFor(null)} />}
    </section>
  )
}

function MiniSwitch({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5" title={hint}>
      <button
        type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-teal-600' : 'bg-slate-300')}
      >
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}

// —— 更换 PL:把影响说清楚再确认 ——
function ChangePlDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { teams, activeUsers, userById, setTeamPl } = useStore()
  const team = teams.find((t) => t.id === teamId)!
  const [to, setTo] = useState<string>('')
  const [keepOld, setKeepOld] = useState(false)
  const old = team.plId ? userById(team.plId) : null
  const cand = to ? userById(to) : null
  const leadsOther = cand ? teams.find((t) => t.plId === cand.id && t.id !== teamId) : undefined
  const oldLeadsOther = old ? teams.some((t) => t.plId === old.id && t.id !== teamId) : false
  const same = activeUsers.filter((u) => u.teamId === teamId && u.id !== team.plId)
  const others = activeUsers.filter((u) => u.teamId !== teamId && u.id !== team.plId)

  return (
    <Modal
      title={`${old ? '更换' : '指定'}「${team.name}」的 PL`}
      onClose={onClose}
      confirm={{
        label: to === '__none' ? '撤销 PL' : '确认', tone: 'dark',
        disabled: !to || !!leadsOther,
        onClick: async () => { if (await setTeamPl(teamId, to === '__none' ? null : to, !keepOld)) onClose() },
      }}
    >
      <select value={to} onChange={(e) => setTo(e.target.value)} className={cn(inputCls, 'w-full py-2')} aria-label="新 PL">
        <option value="">选择新 PL…</option>
        {same.length > 0 && (
          <optgroup label="本组成员">
            {same.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.title || ROLE_LABEL[u.role]}</option>)}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="其他团队(将调入本组)">
            {others.map((u) => <option key={u.id} value={u.id}>{u.name} · {teamName(u.teamId)}</option>)}
          </optgroup>
        )}
        {old && <option value="__none">— 暂不设 PL(撤销 {old.name})—</option>}
      </select>

      {(cand || to === '__none') && (
        <ul className="mt-3 space-y-1.5 rounded-md border bg-slate-50/70 px-3.5 py-3 text-[13px] text-slate-600">
          {cand && leadsOther && (
            <li className="text-red-600">{cand.name} 目前是「{leadsOther.name}」的 PL,请先为该团队指定新 PL。</li>
          )}
          {cand && !leadsOther && cand.teamId !== teamId && (
            <li>{cand.name} 将从「{teamName(cand.teamId)}」调入「{team.name}」;其名下专利仍留在原团队,可由 PL / GL 另行迁移。</li>
          )}
          {cand && !leadsOther && cand.role === 'user' && <li>{cand.name} 的角色将升为 PL(需重新登录后生效)。</li>}
          {cand && cand.role === 'gl' && <li>{cand.name} 是 GL,保持 GL 角色并兼任本组负责人。</li>}
          {old && (
            <li>
              {oldLeadsOther
                ? `${old.name} 仍负责其他团队,保留 PL 角色。`
                : keepOld ? `${old.name} 保留 PL 角色。` : `${old.name} 将降为普通用户(仍在本组)。`}
            </li>
          )}
        </ul>
      )}
      {old && !oldLeadsOther && to && (
        <label className="mt-3 flex items-center gap-2 text-[13px] text-slate-600">
          <input type="checkbox" checked={keepOld} onChange={(e) => setKeepOld(e.target.checked)} className="accent-teal-700" />
          保留 {old.name} 的 PL 角色
        </label>
      )}
    </Modal>
  )
}

// —— 回调地址:先测试、再保存;测试结果就地展示 ——
function WebhookField() {
  const { config, setConfig, testWebhook, me } = useStore()
  const isGl = me.role === 'gl'
  const [url, setUrl] = useState(config.webhookUrl)
  const [testing, setTesting] = useState(false)
  const [res, setRes] = useState<Awaited<ReturnType<typeof testWebhook>> | null>(null)
  const dirty = url.trim() !== config.webhookUrl
  return (
    <div className="border-t pt-4">
      <div className="text-sm font-medium">Webhook 回调地址</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        通知事件以 POST + 签名头发送到该地址,由邮件 / IM 适配器转发。修改后建议先测试连通性再保存。
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={url} disabled={!isGl}
          onChange={(e) => { setUrl(e.target.value); setRes(null) }}
          placeholder="https://im-bot.corp.local/hook/patentflow"
          className={cn(inputCls, 'min-w-0 flex-1 font-mono-x text-xs')}
        />
        {isGl && (
          <>
            <button
              type="button" disabled={!url.trim() || testing}
              onClick={async () => {
                setTesting(true)
                try { setRes(await testWebhook(url.trim())) } catch (e) { setRes({ ok: false, status: null, latencyMs: 0, error: String(e), url, signed: false }) }
                setTesting(false)
              }}
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
            >
              {testing ? '测试中…' : '测试连通性'}
            </button>
            <button
              type="button" disabled={!dirty}
              onClick={() => setConfig({ ...config, webhookUrl: url.trim() })}
              className="rounded-md bg-[#12141f] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              保存
            </button>
          </>
        )}
      </div>
      {res && (
        <div className={cn('mt-2 rounded-md border px-3 py-2 text-xs', res.ok ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-red-200 bg-red-50 text-red-700')}>
          {res.ok
            ? `连通正常:HTTP ${res.status},耗时 ${res.latencyMs} ms${res.signed ? ',已带签名头' : ',未配置签名密钥(webhook_secret)'}。`
            : `连接失败:${res.error ?? '未知错误'}${res.latencyMs ? `(${res.latencyMs} ms)` : ''}。请检查地址、网络与对方服务。`}
          {res.ok && dirty && ' 别忘了点「保存」。'}
        </div>
      )}
      {!url.trim() && isGl && <p className="mt-1.5 text-[11px] text-slate-400">未配置时通知只在站内通知中心可见。</p>}
    </div>
  )
}
