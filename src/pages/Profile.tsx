import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { NOTIFY_EVENT_LABEL, type NotifyEvent, type Visibility } from '@/lib/types'
import { SectionTitle } from '@/components/pf'
import { ArrowRightLeft, Bell, Check, Copy, Eye, EyeOff, KeyRound, Plus, Trash2, UserRound } from 'lucide-react'
import { StagePill, VisibilityTag } from '@/components/pf'
import { teamById } from '@/lib/data'
import type { ApiToken } from '@/lib/types'

const inputCls =
  'mt-1.5 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition-shadow focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20'

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
        on ? 'border-[#12141f] bg-[#12141f] font-medium text-white' : 'text-slate-500 hover:bg-slate-50',
      )}
    >
      {label}
    </button>
  )
}

export default function Profile() {
  const { me, prefs, savePrefs, updateProfile, tokens, createToken, revokeToken, changePassword } = useStore()
  const [name, setName] = useState(me.name)
  const [email, setEmail] = useState(me.email)
  const [saved, setSaved] = useState(false)

  // 修改密码(demo:本地校验,真实后端走 /auth/password)
  const [pwd, setPwd] = useState({ old: '', n1: '', n2: '' })
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Token 创建
  const [tkName, setTkName] = useState('')
  const [tkDays, setTkDays] = useState(90)
  const [tkScope, setTkScope] = useState<ApiToken['scope']>('read')
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showTokens, setShowTokens] = useState(false)

  const myTokens = tokens.filter((t) => t.userId === me.id)
  const [qStart, qEnd] = prefs.quietHours.split('-')

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <SectionTitle
        page
        en="PROFILE"
        zh="个人中心"
        right={
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
            {me.name} · {me.title}
          </span>
        }
      />

      {/* 资料与账号 */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <UserRound className="size-4 text-teal-700" />
          资料与账号
        </h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="ui-label text-slate-500">姓名</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="ui-label text-slate-500">邮箱(通知回调备用地址)</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!name.trim() || !email.trim()}
              onClick={() => { updateProfile({ name: name.trim(), email: email.trim() }); setSaved(true); setTimeout(() => setSaved(false), 2000) }}
              className="rounded-md bg-[#12141f] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              保存资料
            </button>
            {saved && <span className="flex items-center gap-1 text-xs text-teal-700"><Check className="size-3.5" />已保存</span>}
          </div>

          <div className="border-t pt-4">
            <div className="ui-label text-slate-500">修改密码</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <input type="password" placeholder="当前密码" value={pwd.old}
                onChange={(e) => setPwd({ ...pwd, old: e.target.value })} className={inputCls} aria-label="当前密码" />
              <input type="password" placeholder="新密码(≥8 位)" value={pwd.n1}
                onChange={(e) => setPwd({ ...pwd, n1: e.target.value })} className={inputCls} aria-label="新密码" />
              <input type="password" placeholder="确认新密码" value={pwd.n2}
                onChange={(e) => setPwd({ ...pwd, n2: e.target.value })} className={inputCls} aria-label="确认新密码" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={!pwd.old || !pwd.n1 || !pwd.n2}
                onClick={async () => {
                  if (pwd.n1.length < 8) { setPwdMsg({ ok: false, text: '新密码至少 8 位' }); return }
                  if (pwd.n1 !== pwd.n2) { setPwdMsg({ ok: false, text: '两次输入的新密码不一致' }); return }
                  const err = await changePassword(pwd.old, pwd.n1)
                  if (err) setPwdMsg({ ok: false, text: err })
                  else { setPwdMsg({ ok: true, text: '密码已更新,其他设备上的登录已失效' }); setPwd({ old: '', n1: '', n2: '' }) }
                }}
                className="rounded-md border px-4 py-2 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                更新密码
              </button>
              {pwdMsg && (
                <span className={cn('text-xs', pwdMsg.ok ? 'text-teal-700' : 'text-red-600')}>{pwdMsg.text}</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* API Token */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-teal-700" />
          我的 API Token
        </h3>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            用于脚本读取/更新数据的 <code className="font-mono-x">Authorization: Bearer</code> 凭证;可随时吊销,GL 也可全局吊销。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={tkName}
              onChange={(e) => setTkName(e.target.value)}
              placeholder="用途备注,如:周报导出脚本"
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-[13px] outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
            <select
              value={tkDays}
              onChange={(e) => setTkDays(Number(e.target.value))}
              className="rounded-md border bg-white px-2.5 py-2 text-[13px] outline-none focus:border-teal-600"
              aria-label="有效期"
            >
              <option value={30}>30 天有效</option>
              <option value={90}>90 天有效</option>
              <option value={365}>1 年有效</option>
            </select>
            <select
              value={tkScope}
              onChange={(e) => setTkScope(e.target.value as ApiToken['scope'])}
              className="rounded-md border bg-white px-2.5 py-2 text-[13px] outline-none focus:border-teal-600"
              aria-label="权限范围"
            >
              <option value="read">只读(GET)</option>
              <option value="read-write">读写</option>
            </select>
            <button
              type="button"
              disabled={!tkName.trim()}
              onClick={async () => { setFreshToken(await createToken(tkName.trim(), tkDays, tkScope)); setTkName(''); setCopied(false) }}
              className="flex items-center gap-1.5 rounded-md bg-teal-700 px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="size-3.5" />
              创建 Token
            </button>
          </div>

          {freshToken && (
            <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
              <div className="text-xs font-medium text-teal-800">请立即保存 —— Token 只完整显示这一次:</div>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2.5 py-1.5 font-mono-x text-xs">{freshToken}</code>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(freshToken); setCopied(true) }}
                  className="flex shrink-0 items-center gap-1 rounded-md border bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50"
                >
                  {copied ? <Check className="size-3.5 text-teal-700" /> : <Copy className="size-3.5" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 divide-y rounded-md border">
            <div className="flex items-center justify-between bg-slate-50/70 px-3 py-2">
              <span className="ui-label text-slate-500">已有 Token · {myTokens.filter((t) => !t.revoked).length} 个有效</span>
              <button
                type="button"
                onClick={() => setShowTokens((v) => !v)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-foreground"
              >
                {showTokens ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showTokens ? '隐藏' : '显示'}完整串
              </button>
            </div>
            {myTokens.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">还没有创建过 Token</p>
            )}
            {myTokens.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{t.name}</span>
                    <span className={cn('rounded px-1.5 py-px text-[10px]', t.scope === 'read' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700')}>
                      {t.scope === 'read' ? '只读' : '读写'}
                    </span>
                    {t.revoked && <span className="rounded bg-red-50 px-1.5 py-px text-[10px] text-red-600">已吊销</span>}
                  </div>
                  <div className="mt-0.5 font-mono-x text-[11px] text-slate-400">
                    {showTokens && !t.revoked ? t.token : `${t.token.slice(0, 8)}…`} · 创建于 {t.createdAt.slice(0, 10)} · {t.expiresAt} 到期
                  </div>
                </div>
                {!t.revoked && (
                  <button
                    type="button"
                    onClick={() => revokeToken(t.id)}
                    className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="size-3" />
                    吊销
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <BatchTransfer />

      {/* 通知偏好 */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Bell className="size-4 text-teal-700" />
          通知偏好
        </h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div>
            <div className="ui-label text-slate-500">订阅事件(关闭后不再进入通知流)</div>
            <div className="mt-2 flex gap-2">
              {(Object.keys(NOTIFY_EVENT_LABEL) as NotifyEvent[]).map((ev) => (
                <Toggle
                  key={ev}
                  on={prefs.notifyEvents[ev] !== false}
                  onClick={() => savePrefs({ notifyEvents: { ...prefs.notifyEvents, [ev]: !(prefs.notifyEvents[ev] !== false) } })}
                  label={NOTIFY_EVENT_LABEL[ev]}
                />
              ))}
            </div>
          </div>
          <div className="border-t pt-4">
            <div className="ui-label text-slate-500">截止提醒提前量(系统默认档位之上的个人选择)</div>
            <div className="mt-2 flex gap-2">
              {[{ d: 3, label: '前 3 天' }, { d: 1, label: '前 1 天' }, { d: 0, label: '当天' }].map((o) => (
                <Toggle
                  key={o.d}
                  on={prefs.dueReminderDays.includes(o.d)}
                  onClick={() =>
                    savePrefs({
                      dueReminderDays: prefs.dueReminderDays.includes(o.d)
                        ? prefs.dueReminderDays.filter((d) => d !== o.d)
                        : [...prefs.dueReminderDays, o.d].sort((a, b) => b - a),
                    })
                  }
                  label={o.label}
                />
              ))}
            </div>
          </div>
          <div className="border-t pt-4">
            <div className="ui-label text-slate-500">免打扰时段(该时段内只进站内通知中心,不推送到邮件 / IM;账号安全事件除外)</div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="time" value={qStart ?? '22:00'}
                onChange={(e) => savePrefs({ quietHours: `${e.target.value}-${qEnd ?? '08:00'}` })}
                className="rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:border-teal-600"
                aria-label="免打扰开始"
              />
              <span className="text-slate-400">至次日</span>
              <input
                type="time" value={qEnd ?? '08:00'}
                onChange={(e) => savePrefs({ quietHours: `${qStart ?? '22:00'}-${e.target.value}` })}
                className="rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:border-teal-600"
                aria-label="免打扰结束"
              />
            </div>
          </div>
          <NotifySelfTest />
        </div>
      </section>

      {/* 新建默认值 */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">新建默认值</h3>
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div>
            <div className="ui-label text-slate-500">新建专利的默认可见性</div>
            <div className="mt-2 flex gap-2">
              {([['private', '私有'], ['team', '团队可见'], ['public', '公开']] as [Visibility, string][]).map(([v, label]) => (
                <Toggle key={v} on={prefs.defaultVisibility === v} onClick={() => savePrefs({ defaultVisibility: v })} label={label} />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">私有专利只能停留在草案阶段;多数人习惯先私有、完善后再转团队可见。</p>
          </div>
          <div className="border-t pt-4">
            <div className="ui-label text-slate-500">登录后默认着陆页</div>
            <div className="mt-2 flex gap-2">
              <Toggle on={prefs.homePage === 'dashboard'} onClick={() => savePrefs({ homePage: 'dashboard' })} label="仪表盘" />
              <Toggle on={prefs.homePage === 'patents'} onClick={() => savePrefs({ homePage: 'patents' })} label="专利库" />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// —— 批量转交:把我名下的专利一次性交给他人(调岗、离职前自助交接) ——
function BatchTransfer() {
  const { me, patents, activeUsers, batchTransfer, userById } = useStore()
  const mine = patents.filter((p) => p.ownerId === me.id)
  const [picked, setPicked] = useState<string[]>([])
  const [to, setTo] = useState('')
  const [keep, setKeep] = useState(true)
  const [done, setDone] = useState('')
  const toggle = (id: string) => setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]))

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ArrowRightLeft className="size-4 text-teal-700" />
        专利转交
      </h3>
      <div className="rounded-lg border bg-card p-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          调岗或离职前,把名下专利交给接手的人。接收人成为负责人;团队归属不变;私有专利转交后仍为私有。
        </p>
        {mine.length === 0 ? (
          <p className="mt-4 text-center text-xs text-muted-foreground">你名下没有专利</p>
        ) : (
          <>
            <div className="mt-3 divide-y rounded-md border">
              {mine.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                  <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="accent-teal-700" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{p.title}</span>
                  <VisibilityTag v={p.visibility} />
                  <StagePill stage={p.stage} />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border bg-white px-2.5 py-2 text-[13px] outline-none focus:border-teal-600"
                aria-label="接收人"
              >
                <option value="">选择接收人…</option>
                {activeUsers.filter((u) => u.id !== me.id).map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {teamById(u.teamId).name}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="accent-teal-700" />
                我保留为共同发明人
              </label>
              <button
                type="button"
                disabled={!to || picked.length === 0}
                onClick={() => {
                  batchTransfer(picked.map((id) => ({ patentId: id, toUserId: to })), keep)
                  setDone(`已将 ${picked.length} 件专利转交给 ${userById(to).name}`)
                  setPicked([])
                }}
                className="ml-auto rounded-md bg-[#12141f] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                转交 {picked.length || ''} 件
              </button>
            </div>
            {done && <p className="mt-2 text-xs text-teal-700">{done}</p>}
          </>
        )}
      </div>
    </section>
  )
}

// —— 通知自检:给自己发一条测试通知,并说明站内 / 回调各自是否送达 ——
function NotifySelfTest() {
  const { notifyMeTest } = useStore()
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<Awaited<ReturnType<typeof notifyMeTest>>>(null)
  const EV: Record<string, string> = { review: '审查动态', due: '截止提醒', transition: '阶段流转' }
  return (
    <div className="border-t pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">通知自检</div>
          <div className="mt-0.5 text-xs text-muted-foreground">给自己发一条测试通知,确认站内通知与外部推送(邮件 / IM 回调)是否畅通</div>
        </div>
        <button
          type="button" disabled={busy}
          onClick={async () => { setBusy(true); setR(await notifyMeTest()); setBusy(false) }}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
        >
          {busy ? '发送中…' : '发送测试通知'}
        </button>
      </div>
      {r && (
        <ul className="mt-3 space-y-1.5 rounded-md border bg-slate-50/70 px-3.5 py-3 text-[13px]">
          <li className="text-teal-700">✓ 站内通知已送达 —— 右上角铃铛里可以看到</li>
          {!r.webhookConfigured ? (
            <li className="text-slate-500">· 系统尚未配置外部回调,通知只在站内可见(如需邮件 / IM 推送请联系 GL)</li>
          ) : r.webhook?.ok ? (
            <li className="text-teal-700">✓ 外部回调连通正常(HTTP {r.webhook.status},{r.webhook.latencyMs} ms)</li>
          ) : (
            <li className="text-red-600">✗ 外部回调失败:{r.webhook?.error ?? '未知错误'} —— 请联系 GL 检查回调地址</li>
          )}
          {r.quietNow && <li className="text-amber-700">· 现在处于你的免打扰时段({r.quietHours}),平时的通知此刻不会推送到外部</li>}
          {r.mutedEvents.length > 0 && (
            <li className="text-amber-700">· 你已关闭:{r.mutedEvents.map((e) => EV[e] ?? e).join('、')},这些事件不会通知你</li>
          )}
        </ul>
      )}
    </div>
  )
}
