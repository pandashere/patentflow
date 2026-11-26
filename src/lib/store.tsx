import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  API_TOKENS, CONFIG, CYCLES, DEFAULT_PREFS, KPI_RULES, NOTIFICATIONS, PATENTS, TRANSITIONS, USERS, VERSIONS, isConfigAdmin, teamById,
} from './data'
import {
  STAGES, stageIndex, stageLabel, type ApiToken, type KpiRule, type Notification, type NotifyEvent,
  type Cycle, type Patent, type PasswordResetToken, type ReviewScore, type Role, type StageExtension, type StageKey,
  type StageNotifyConfig, type StageTransition, type StageVersion, type SystemConfig, type User, type UserPrefs,
} from './types'

// demo 可切换的四种身份(含"以 reviewer 身份被邀请"的视角)
export interface Persona {
  key: string
  userId: string
  asReviewer?: boolean
  label: string
  desc: string
}

export const PERSONAS: Persona[] = [
  { key: 'user', userId: 'u-chenxi', label: '普通用户', desc: '陈曦 · 平台技术组工程师' },
  { key: 'pl', userId: 'u-linzf', label: 'PL', desc: '林致远 · 平台技术组负责人' },
  { key: 'gl', userId: 'u-guyq', label: 'GL', desc: '顾云旗 · 研发部负责人' },
  { key: 'reviewer', userId: 'u-suman', asReviewer: true, label: 'Reviewer', desc: '苏漫 · 被邀请审查中' },
]

interface Store {
  me: User
  persona: Persona
  setPersona: (key: string) => void
  users: User[]
  userById: (id: string) => User
  patents: Patent[]
  versions: StageVersion[]
  transitions: StageTransition[]
  kpiRules: KpiRule[]
  notifications: Notification[]
  config: SystemConfig
  tokens: ApiToken[]
  prefs: UserPrefs
  cycles: Cycle[]
  snapshots: KpiSnapshot[]
  activeCycle: () => Cycle | undefined
  cycleOfPatent: (p: Patent) => Cycle | undefined
  stageOverdueDays: (p: Patent) => number // 0 = 未逾期
  closingRisk: (p: Patent) => 'comfortable' | 'tight' | 'doomed' | null
  loggedIn: boolean
  setLoggedIn: (v: boolean) => void
  login: (email: string, password: string) => 'ok' | 'wrong' | 'unknown'
  // 忘记密码:经通知接口投递一次性带 token 的重置链接;email 不存在也返回相同话术(防枚举)
  requestPasswordReset: (email: string) => string | null // demo 直接返回链接;生产由 webhook/邮件适配器投递
  resetPassword: (token: string, newPassword: string) => 'ok' | 'invalid' | 'expired' | 'weak'
  changePassword: (oldPwd: string, newPwd: string) => 'ok' | 'wrong'

  visiblePatents: () => Patent[]
  canEditPatent: (p: Patent) => boolean // 含共同发明人:可编辑阶段内容
  canOperatePatent: (p: Patent) => boolean // 推进/回退/归档/转让:负责人/本组 PL/GL
  isReviewerOf: (p: Patent) => boolean
  reviewPassCount: (p: Patent) => number
  reviewGateOpen: (p: Patent) => boolean

  saveStageData: (patentId: string, stage: StageKey, data: unknown, note: string) => void
  advance: (patentId: string, reason: string) => void
  rollback: (patentId: string, to: StageKey, reason: string) => void
  inviteReviewer: (patentId: string, userId: string) => void
  submitReview: (patentId: string, score: ReviewScore) => 'ok' | 'below-min'
  saveNotifyConfig: (patentId: string, cfgs: StageNotifyConfig[]) => void
  createPatent: (title: string, visibility: Patent['visibility']) => string
  setVisibility: (patentId: string, v: Patent['visibility']) => void
  archive: (patentId: string, kind: 'completed' | 'abandoned', reason: string) => void
  unarchive: (patentId: string, reason: string) => void
  transferOwnership: (patentId: string, newOwnerId: string) => void
  setCollaborators: (patentId: string, ids: string[]) => void
  saveKpiRule: (rule: KpiRule) => void
  toggleKpiRule: (id: string) => void
  setConfig: (c: SystemConfig) => void
  addMember: (m: { name: string; email: string; title: string; teamId: string; role: Role }) => void
  updateMember: (id: string, patch: Partial<Pick<User, 'role' | 'teamId' | 'name' | 'email'>>) => void
  updateProfile: (patch: Partial<Pick<User, 'name' | 'email'>>) => void
  savePrefs: (patch: Partial<UserPrefs>) => void
  saveCycle: (c: Cycle) => void
  closeCycle: (id: string) => void
  requestExtension: (patentId: string, newDue: string, reason: string) => 'applied' | 'pending' | 'invalid' | 'beyond-cycle'
  reviewExtension: (patentId: string, extId: string, approve: boolean) => void
  nudge: (patentId: string) => void
  toggleCrossCycle: (patentId: string) => void
  createToken: (name: string, days: number) => string
  revokeToken: (id: string) => void
  adminRevokeToken: (id: string) => void
  markAllRead: () => void
  pushNotification: (n: Omit<Notification, 'id' | 'at' | 'read'>) => void
}

const Ctx = createContext<Store | null>(null)

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('store missing')
  return s
}

const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ')
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (from: string, days: number) => {
  const d = new Date(`${from}T00:00:00`)
  d.setDate(d.getDate() + days)
  // 本地时区格式化,避免 toISOString 的 UTC 偏移导致日期差一天
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
let seq = 100

// —— 加权均分:GL 配置的维度权重;「通过」低于加权下限则不计入门禁 ——
export function weightedScore(s: Pick<ReviewScore, 'difficulty' | 'nonObviousness' | 'novelty'>, config: SystemConfig) {
  const totalW = config.reviewDims.reduce((a, d) => a + d.weight, 0) || 1
  return config.reviewDims.reduce((a, d) => a + s[d.key] * d.weight, 0) / totalW
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [personaKey, setPersonaKey] = useState('user')
  const [users, setUsers] = useState<User[]>(USERS)
  const [patents, setPatents] = useState<Patent[]>(PATENTS)
  const [versions, setVersions] = useState<StageVersion[]>(VERSIONS)
  const [transitions, setTransitions] = useState<StageTransition[]>(TRANSITIONS)
  const [kpiRules, setKpiRules] = useState<KpiRule[]>(KPI_RULES)
  const [notifications, setNotifications] = useState<Notification[]>(NOTIFICATIONS)
  const [config, setConfig] = useState<SystemConfig>(CONFIG)
  const [tokens, setTokens] = useState<ApiToken[]>(API_TOKENS)
  const [prefsMap, setPrefsMap] = useState<Record<string, UserPrefs>>({})
  const [cycles, setCycles] = useState<Cycle[]>(CYCLES)
  const [snapshots, setSnapshots] = useState<KpiSnapshot[]>([])
  const [resetTokens, setResetTokens] = useState<PasswordResetToken[]>([])
  const [loggedIn, setLoggedIn] = useState(false)

  const persona = PERSONAS.find((p) => p.key === personaKey)!
  const me = users.find((u) => u.id === persona.userId)!
  const userById = (id: string) => users.find((u) => u.id === id) ?? users[0]
  const prefs = prefsMap[me.id] ?? DEFAULT_PREFS

  // —— 周期与逾期(纯派生,不落库状态) ——
  // 专利按创建日归入当时进行中的周期;多个进行时取最早创建的
  const cycleOfPatent = (p: Patent) => {
    const hit = cycles
      .filter((c) => p.createdAt >= c.start && p.createdAt <= c.end)
      .sort((a, b) => a.start.localeCompare(b.start))
    return hit[0]
  }
  const activeCycle = () => cycles.find((c) => c.status === 'active')

  const stageOverdueDays = (p: Patent) => {
    if (p.archived) return 0
    const due = p.dueDates[p.stage]
    if (!due) return 0
    return Math.max(0, Math.floor((Date.parse(today()) - Date.parse(due)) / 86400000))
  }

  // 收口风险:周期剩余天数 vs 当前及之后各阶段默认预算之和
  const closingRisk = (p: Patent): 'comfortable' | 'tight' | 'doomed' | null => {
    const c = cycleOfPatent(p)
    if (!c || c.status !== 'active' || p.archived || p.crossCycle) return null
    const remaining = Math.floor((Date.parse(c.end) - Date.parse(today())) / 86400000)
    if (remaining < 0) return 'doomed'
    const budget = STAGES.slice(stageIndex(p.stage)).reduce((a, s) => a + config.stageDefaults[s.key], 0)
    if (remaining >= budget + 7) return 'comfortable'
    if (remaining >= budget) return 'tight'
    return 'doomed'
  }

  const isReviewerOf = (p: Patent) =>
    p.stageData.patentability.reviewers.some((r) => r.userId === me.id)

  const canSeePatent = (p: Patent) => {
    if (p.ownerId === me.id) return true
    if (p.collaborators.includes(me.id)) return true // 共同发明人可见
    if (isReviewerOf(p)) return true // reviewer 例外通道
    if (p.visibility === 'public') return true
    if (p.visibility === 'team') {
      // 决策:private 连 GL 也不可见;team = 同组成员 + 本组 PL + GL
      if (me.role === 'gl') return true
      if (me.teamId === p.teamId) return true
    }
    return false
  }

  const canEditPatent = (p: Patent) =>
    p.ownerId === me.id || p.collaborators.includes(me.id)
    || (me.role === 'pl' && me.teamId === p.teamId) || me.role === 'gl'

  const canOperatePatent = (p: Patent) =>
    p.ownerId === me.id || (me.role === 'pl' && me.teamId === p.teamId) || me.role === 'gl'

  // 「通过」需同时满足加权均分下限(G1)
  const qualifiedPass = (s: ReviewScore | null) =>
    s?.verdict === 'pass' && weightedScore(s, config) >= config.reviewMinWeighted

  const reviewPassCount = (p: Patent) =>
    p.stageData.patentability.reviewers.filter((r) => qualifiedPass(r.score)).length

  // 决策:GL 配置至少 n 名 reviewer 通过(加权达标),且无未结打回
  const reviewGateOpen = (p: Patent) =>
    reviewPassCount(p) >= config.reviewPassCount

  const pushNotification = (n: Omit<Notification, 'id' | 'at' | 'read'>) =>
    setNotifications((ns) => [{ ...n, id: `n${++seq}`, at: now(), read: false }, ...ns])

  const addTransition = (t: Omit<StageTransition, 'id' | 'at' | 'operatorId'>) =>
    setTransitions((ts) => [
      ...ts,
      { ...t, id: `tr${++seq}`, operatorId: me.id, at: now() },
    ])

  const store: Store = {
    me, persona,
    setPersona: setPersonaKey,
    users, userById, tokens, prefs,
    cycles, snapshots, activeCycle, cycleOfPatent, stageOverdueDays, closingRisk,
    patents, versions, transitions, kpiRules, notifications, config,
    loggedIn, setLoggedIn,

    // 登录:已设密码的账号必须校验;未设密码的种子账号任意输入可进(演示)
    login: (email, password) => {
      const u = users.find((x) => x.email === email.trim())
      if (!u) return 'unknown'
      if (u.password && u.password !== password) return 'wrong'
      setLoggedIn(true)
      return 'ok'
    },

    // 忘记密码:生成一次性 token(30 分钟),经通知接口投递带 token 的链接
    requestPasswordReset: (email) => {
      const u = users.find((x) => x.email === email.trim())
      if (!u) return null // 不泄露账号是否存在
      const token = `prt_${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`
      setResetTokens((ts) => [
        ...ts,
        {
          token, userId: u.id, createdAt: now(),
          expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), used: false,
        },
      ])
      return `${window.location.origin}/reset?token=${token}`
    },

    resetPassword: (token, newPassword) => {
      const t = resetTokens.find((x) => x.token === token)
      if (!t || t.used) return 'invalid'
      if (Date.parse(t.expiresAt) < Date.now()) return 'expired'
      if (newPassword.length < 8) return 'weak'
      setResetTokens((ts) => ts.map((x) => (x.token === token ? { ...x, used: true } : x)))
      setUsers((us) => us.map((u) => (u.id === t.userId ? { ...u, password: newPassword } : u)))
      return 'ok'
    },

    changePassword: (oldPwd, newPwd) => {
      if (me.password && me.password !== oldPwd) return 'wrong'
      setUsers((us) => us.map((u) => (u.id === me.id ? { ...u, password: newPwd } : u)))
      return 'ok'
    },
    visiblePatents: () => patents.filter(canSeePatent),
    canEditPatent, canOperatePatent, isReviewerOf, reviewPassCount, reviewGateOpen,

    saveStageData: (patentId, stage, data, note) => {
      setPatents((ps) =>
        ps.map((p) =>
          p.id === patentId ? { ...p, stageData: { ...p.stageData, [stage]: data } } : p,
        ),
      )
      setVersions((vs) => {
        const count = vs.filter((v) => v.patentId === patentId && v.stage === stage).length
        return [...vs, { version: count + 1, patentId, stage, note, authorId: me.id, at: now(), snapshot: data }]
      })
    },

    advance: (patentId, reason) => {
      const p = patents.find((x) => x.id === patentId)!
      const next = STAGES[stageIndex(p.stage) + 1]
      if (!next) return
      setPatents((ps) => ps.map((x) => {
        if (x.id !== patentId) return x
        // 阶段默认周期(G2):推进时自动算出新阶段 due date(已有设定则不覆盖);
        // 自定周期必须落在专利周期内:非跨周期项目按周期结束日截断
        const dueDates = { ...x.dueDates }
        if (!dueDates[next.key]) {
          let due = addDays(today(), config.stageDefaults[next.key])
          const c = cycleOfPatent(x)
          if (c && !x.crossCycle && due > c.end) due = c.end
          dueDates[next.key] = due
        }
        return { ...x, stage: next.key, dueDates }
      }))
      addTransition({ patentId, from: p.stage, to: next.key, reason, kind: 'advance' })
      pushNotification({ event: 'transition', text: `《${p.title}》已推进至「${next.label}」`, patentId })
    },

    rollback: (patentId, to, reason) => {
      const p = patents.find((x) => x.id === patentId)!
      setPatents((ps) => ps.map((x) => (x.id === patentId ? { ...x, stage: to } : x)))
      addTransition({ patentId, from: p.stage, to, reason, kind: 'rollback' })
      pushNotification({
        event: 'transition',
        text: `《${p.title}》已回退至「${STAGES[stageIndex(to)].label}」`,
        patentId,
      })
    },

    inviteReviewer: (patentId, userId) => {
      const p = patents.find((x) => x.id === patentId)!
      const u = users.find((x) => x.id === userId)!
      setPatents((ps) =>
        ps.map((x) => {
          if (x.id !== patentId) return x
          const rev = x.stageData.patentability
          return {
            ...x,
            stageData: {
              ...x.stageData,
              patentability: {
                ...rev,
                reviewers: [...rev.reviewers, { userId, invitedBy: me.id, invitedAt: now(), score: null }],
              },
            },
          }
        }),
      )
      pushNotification({ event: 'review', text: `${u.name} 被邀请审查《${p.title}》`, patentId })
    },

    submitReview: (patentId, score) => {
      // 加权均分低于 GL 设定下限时,「通过」不计入门禁 → 直接拦截并提示改判
      if (score.verdict === 'pass' && weightedScore(score, config) < config.reviewMinWeighted) {
        return 'below-min'
      }
      const p = patents.find((x) => x.id === patentId)!
      setPatents((ps) =>
        ps.map((x) => {
          if (x.id !== patentId) return x
          const rev = x.stageData.patentability
          const next = {
            ...x,
            stageData: {
              ...x.stageData,
              patentability: {
                ...rev,
                reviewers: rev.reviewers.map((r) =>
                  r.userId === me.id ? { ...r, score: { ...score, submittedAt: now() } } : r,
                ),
              },
            },
          }
          // 任一 reviewer 打回 → 自动回退草案
          if (score.verdict === 'reject') next.stage = 'draft'
          return next
        }),
      )
      pushNotification({
        event: 'review',
        text: `${me.name} 已提交对《${p.title}》的审查意见:${score.verdict === 'pass' ? '通过' : '打回'}`,
        patentId,
      })
      if (score.verdict === 'reject') {
        addTransition({
          patentId, from: 'patentability', to: 'draft',
          reason: `审查打回:${score.comment || '未填写意见'}`, kind: 'reject',
        })
      }
      return 'ok'
    },

    saveNotifyConfig: (patentId, cfgs) =>
      setPatents((ps) => ps.map((p) => (p.id === patentId ? { ...p, notify: cfgs } : p))),

    createPatent: (title, visibility) => {
      const id = `p${++seq}`
      const emptyScore = { difficulty: 0, nonObviousness: 0, novelty: 0, comment: '', verdict: 'pending' as const }
      const year = today().slice(0, 4)
      const p: Patent = {
        id,
        code: `${config.numberPrefix}-${year}-0${17 + patents.length}`,
        title,
        ownerId: me.id,
        collaborators: [],
        crossCycle: false,
        extensions: [],
        teamId: me.teamId,
        visibility,
        stage: 'draft',
        createdAt: today(),
        // 阶段默认周期(G2):草案截止日自动算出,并按所属周期边界截断
        dueDates: (() => {
          let due = addDays(today(), config.stageDefaults.draft)
          const c = cycles
            .filter((cy) => today() >= cy.start && today() <= cy.end)
            .sort((a, b) => a.start.localeCompare(b.start))[0]
          if (c && due > c.end) due = c.end
          return { draft: due }
        })(),
        stageData: {
          draft: { background: '', classification: '', idea: '' },
          patentability: { summary: '', selfAssessment: emptyScore, reviewers: [] },
          implementation: { markdown: '' },
          search: { markdown: '' },
          doi: { title: '', authors: '', venue: '', abstractDraft: '' },
        },
        notify: [],
        archived: null,
      }
      setPatents((ps) => [p, ...ps])
      addTransition({ patentId: id, from: null, to: 'draft', reason: '创建专利', kind: 'advance' })
      return id
    },

    // 可见性约束:仅 draft 阶段可以改为私有(私有专利只能停留在草案)
    setVisibility: (patentId, v) => {
      const p = patents.find((x) => x.id === patentId)!
      if (v === 'private' && p.stage !== 'draft') return
      setPatents((ps) => ps.map((x) => (x.id === patentId ? { ...x, visibility: v } : x)))
      pushNotification({
        event: 'transition',
        text: `《${p.title}》可见性调整为「${v === 'private' ? '私有' : v === 'team' ? '团队可见' : '公开'}」`,
        patentId,
      })
    },

    archive: (patentId, kind, reason) => {
      const p = patents.find((x) => x.id === patentId)!
      setPatents((ps) =>
        ps.map((x) =>
          x.id === patentId
            ? { ...x, archived: { kind, at: now(), by: me.id, reason } }
            : x,
        ),
      )
      addTransition({
        patentId, from: p.stage, to: p.stage, kind: 'rollback',
        reason: `${kind === 'completed' ? '完成归档' : '放弃归档'}:${reason}`,
      })
      pushNotification({
        event: 'transition',
        text: `《${p.title}》已${kind === 'completed' ? '完成归档' : '放弃归档'}`,
        patentId,
      })
    },

    unarchive: (patentId, reason) => {
      const p = patents.find((x) => x.id === patentId)!
      setPatents((ps) => ps.map((x) => (x.id === patentId ? { ...x, archived: null } : x)))
      addTransition({ patentId, from: p.stage, to: p.stage, kind: 'advance', reason: `恢复归档:${reason}` })
      pushNotification({ event: 'transition', text: `《${p.title}》已恢复到「${stageLabel(p.stage)}」`, patentId })
    },

    saveKpiRule: (rule) =>
      setKpiRules((rs) =>
        rs.some((r) => r.id === rule.id)
          ? rs.map((r) => (r.id === rule.id ? { ...rule, updatedAt: now() } : r))
          : [...rs, { ...rule, updatedAt: now() }],
      ),

    toggleKpiRule: (id) =>
      setKpiRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !r.enabled, updatedAt: now() } : r))),

    transferOwnership: (patentId, newOwnerId) => {
      const p = patents.find((x) => x.id === patentId)!
      const from = userById(p.ownerId).name
      const to = userById(newOwnerId).name
      setPatents((ps) =>
        ps.map((x) =>
          x.id === patentId
            ? {
                ...x,
                ownerId: newOwnerId,
                // 原负责人保留为共同发明人,避免历史作者失去访问权
                collaborators: [...new Set([...x.collaborators, p.ownerId])].filter((c) => c !== newOwnerId),
              }
            : x,
        ),
      )
      pushNotification({ event: 'transition', text: `《${p.title}》负责人由 ${from} 变更为 ${to}`, patentId })
    },

    setCollaborators: (patentId, ids) =>
      setPatents((ps) => ps.map((x) => (x.id === patentId ? { ...x, collaborators: ids } : x))),

    addMember: (m) =>
      setUsers((us) => [
        ...us,
        { id: `u-${++seq}`, ...m, ssoBound: false },
      ]),

    updateMember: (id, patch) =>
      setUsers((us) => us.map((u) => {
        // 配置文件管理员保护:不允许通过 UI/API 降级(对应后端的硬校验)
        if (u.id === id && isConfigAdmin(u.email) && patch.role && patch.role !== 'gl') return u
        return u.id === id ? { ...u, ...patch } : u
      })),

    updateProfile: (patch) =>
      setUsers((us) => us.map((u) => (u.id === me.id ? { ...u, ...patch } : u))),

    savePrefs: (patch) =>
      setPrefsMap((m) => ({ ...m, [me.id]: { ...(m[me.id] ?? DEFAULT_PREFS), ...patch } })),

    createToken: (name, days) => {
      const token = `pfk_${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`
      setTokens((ts) => [
        ...ts,
        { id: `tk${++seq}`, userId: me.id, name, token, createdAt: now(), expiresAt: addDays(today(), days), revoked: false },
      ])
      return token
    },

    revokeToken: (id) =>
      setTokens((ts) => ts.map((t) => (t.id === id && t.userId === me.id ? { ...t, revoked: true } : t))),

    adminRevokeToken: (id) => {
      if (me.role !== 'gl') return
      setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, revoked: true } : t)))
    },

    // —— 专利周期 ——
    saveCycle: (c) =>
      setCycles((cs) =>
        cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? c : x)) : [...cs, c],
      ),

    // 收口:周期关闭,绑定该周期的启用规则冻结为快照,之后不再变动
    closeCycle: (id) => {
      const c = cycles.find((x) => x.id === id)
      if (!c || c.status !== 'active') return
      const closed: Cycle = { ...c, status: 'closed', closedAt: now() }
      setCycles((cs) => cs.map((x) => (x.id === id ? closed : x)))
      setSnapshots((ss) => [
        ...ss,
        ...kpiRules
          .filter((r) => r.cycleId === id && r.enabled)
          .map((r) => {
            const report = computeKpi(r, patents, transitions, cycles, config)
            return {
              id: `ks${++seq}`, cycleId: id, ruleId: r.id, frozenAt: now(),
              overall: report.overall, items: report.items,
            }
          }),
      ])
      pushNotification({ event: 'transition', text: `专利周期「${c.name}」已收口,KPI 快照已冻结`, patentId: '' })
    },

    // —— 延期申请:≤阈值自动生效,>阈值挂起待 PL/GL 审批;不可超出所属周期(跨周期项目除外) ——
    requestExtension: (patentId, newDue, reason) => {
      const p = patents.find((x) => x.id === patentId)!
      const oldDue = p.dueDates[p.stage]
      if (!oldDue || newDue <= oldDue) return 'invalid'
      const c = cycleOfPatent(p)
      if (c && !p.crossCycle && newDue > c.end) return 'beyond-cycle'
      const days = Math.round((Date.parse(newDue) - Date.parse(oldDue)) / 86400000)
      const auto = days <= config.overdue.extensionApprovalThreshold
      const ext: StageExtension = {
        id: `ex${++seq}`, stage: p.stage, oldDue, newDue, reason,
        by: me.id, at: now(), status: auto ? 'applied' : 'pending',
      }
      setPatents((ps) =>
        ps.map((x) =>
          x.id === patentId
            ? {
                ...x,
                extensions: [...x.extensions, ext],
                dueDates: auto ? { ...x.dueDates, [p.stage]: newDue } : x.dueDates,
              }
            : x,
        ),
      )
      pushNotification({
        event: 'due',
        text: auto
          ? `《${p.title}》${stageLabel(p.stage)}阶段延期 ${days} 天(自动生效)`
          : `${me.name} 申请《${p.title}》${stageLabel(p.stage)}阶段延期 ${days} 天,待 PL/GL 批准`,
        patentId,
      })
      return auto ? 'applied' : 'pending'
    },

    reviewExtension: (patentId, extId, approve) => {
      const p = patents.find((x) => x.id === patentId)!
      const ext = p.extensions.find((e) => e.id === extId)
      if (!ext || ext.status !== 'pending') return
      setPatents((ps) =>
        ps.map((x) => {
          if (x.id !== patentId) return x
          return {
            ...x,
            extensions: x.extensions.map((e) =>
              e.id === extId ? { ...e, status: approve ? ('applied' as const) : ('rejected' as const), approvedBy: me.id } : e,
            ),
            dueDates: approve ? { ...x.dueDates, [ext.stage]: ext.newDue } : x.dueDates,
          }
        }),
      )
      pushNotification({
        event: 'due',
        text: `《${p.title}》${stageLabel(ext.stage)}阶段延期申请已${approve ? '批准' : '驳回'}(${me.name})`,
        patentId,
      })
    },

    // 催办:手动提醒负责人(非自动升级)
    nudge: (patentId) => {
      const p = patents.find((x) => x.id === patentId)!
      pushNotification({
        event: 'due',
        text: `${me.name} 催办:《${p.title}》${stageLabel(p.stage)}阶段已逾期 ${stageOverdueDays(p)} 天,请尽快处理`,
        patentId,
      })
    },

    toggleCrossCycle: (patentId) =>
      setPatents((ps) => ps.map((x) => (x.id === patentId ? { ...x, crossCycle: !x.crossCycle } : x))),

    setConfig,
    markAllRead: () => setNotifications((ns) => ns.map((n) => ({ ...n, read: true }))),
    pushNotification,
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

// —— KPI 计算 ——
// 事件口径:统计「周期窗口内发生的阶段到达事件」,与专利创建时间无关 ——
// 跨周期/结转专利无需特殊处理:进展落在哪个周期就计入哪个周期,各记各的、无双计。
// 分母 = 周期内活跃专利(createdAt ≤ cycle.end 且未在 cycle.start 前归档;含归档,
// 因为周期内的归档前进展仍是产出;跨周期标记专利按配置决定是否计入)。
// rule.scorerHook 非空时,真实后端会改为调用用户注册的自由计算回调
// (单项目 compute_item(patent, targets, transitions) / 整体 compute_kpi(items))。
export interface KpiItemResult {
  patentId: string
  title: string
  ownerId: string
  currentStage: StageKey
  achievedTargets: boolean[]
  score: number // 0-1
}

export interface KpiReport {
  rule: KpiRule
  items: KpiItemResult[]
  overall: number
}

export interface KpiSnapshot {
  id: string
  cycleId: string
  ruleId: string
  frozenAt: string
  overall: number
  items: KpiItemResult[]
}

export function computeKpi(
  rule: KpiRule,
  patents: Patent[],
  transitions: StageTransition[],
  cycles: Cycle[],
  config: SystemConfig,
): KpiReport {
  const cycle = cycles.find((c) => c.id === rule.cycleId)
  const inScope = patents.filter((p) => {
    if (!cycle) return false
    if (p.createdAt > cycle.end) return false // 周期后才创建
    if (p.archived?.kind === 'abandoned') return false // 放弃归档不拖累分母
    if (p.archived && p.archived.at.slice(0, 10) < cycle.start) return false // 周期开始前已完成归档
    if (p.crossCycle && !config.overdue.includeCrossCycleInKpi) return false
    if (rule.scope.type === 'team' && p.teamId !== rule.scope.teamId) return false
    return true
  })
  const items: KpiItemResult[] = inScope.map((p) => {
    const myTransitions = transitions.filter((t) => t.patentId === p.id)
    const achieved = rule.targets.map((t) => {
      if (!cycle) return false
      const deadline = t.deadline < cycle.end ? t.deadline : cycle.end
      // 目标事件:周期窗口内「到达过」目标阶段(含之后回退的情况)
      return myTransitions.some(
        (tr) =>
          stageIndex(tr.to) >= stageIndex(t.stage)
          && tr.at.slice(0, 10) >= cycle.start
          && tr.at.slice(0, 10) <= deadline,
      )
    })
    const score = achieved.filter(Boolean).length / rule.targets.length
    return { patentId: p.id, title: p.title, ownerId: p.ownerId, currentStage: p.stage, achievedTargets: achieved, score }
  })
  const overall = items.length ? items.reduce((a, b) => a + b.score, 0) / items.length : 0
  return { rule, items, overall }
}

export function teamName(id: string) {
  return teamById(id).name
}

// —— 阶段数量趋势:回放流转记录,统计每个月末各阶段的专利数 ——
export interface TrendPoint {
  month: string // YYYY-MM
  counts: Record<StageKey, number>
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

export function computeStageTrend(
  patents: Patent[],
  transitions: StageTransition[],
  months: string[],
): TrendPoint[] {
  return months.map((month) => {
    // 截止点:下个月 1 号(字典序比较即可)
    const [y, m] = month.split('-').map(Number)
    const cutoff = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    const counts: Record<StageKey, number> = {
      draft: 0, patentability: 0, implementation: 0, search: 0, doi: 0,
    }
    for (const p of patents) {
      if (p.archived) continue // 归档专利退出流水线统计
      if (p.createdAt >= cutoff) continue // 尚未创建
      // 回放:默认从草案开始,按时间应用流转
      let stage: StageKey = 'draft'
      const my = transitions
        .filter((t) => t.patentId === p.id && t.at.slice(0, 10) < cutoff)
        .sort((a, b) => a.at.localeCompare(b.at))
      for (const t of my) stage = t.to
      counts[stage] += 1
    }
    return { month, counts }
  })
}

export type { NotifyEvent }
