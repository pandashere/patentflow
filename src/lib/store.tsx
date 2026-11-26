import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  API_TOKENS, CONFIG, DEFAULT_PREFS, KPI_RULES, NOTIFICATIONS, PATENTS, TRANSITIONS, USERS, VERSIONS, teamById,
} from './data'
import {
  STAGES, stageIndex, stageLabel, type ApiToken, type KpiRule, type Notification, type NotifyEvent,
  type Patent, type ReviewScore, type Role, type StageKey, type StageNotifyConfig, type StageTransition,
  type StageVersion, type SystemConfig, type User, type UserPrefs,
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
  loggedIn: boolean
  setLoggedIn: (v: boolean) => void

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
  const [loggedIn, setLoggedIn] = useState(false)

  const persona = PERSONAS.find((p) => p.key === personaKey)!
  const me = users.find((u) => u.id === persona.userId)!
  const userById = (id: string) => users.find((u) => u.id === id) ?? users[0]
  const prefs = prefsMap[me.id] ?? DEFAULT_PREFS

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
    patents, versions, transitions, kpiRules, notifications, config,
    loggedIn, setLoggedIn,
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
        // 阶段默认周期(G2):推进时自动算出新阶段 due date(已有设定则不覆盖)
        const dueDates = { ...x.dueDates }
        if (!dueDates[next.key]) dueDates[next.key] = addDays(today(), config.stageDefaults[next.key])
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
        teamId: me.teamId,
        visibility,
        stage: 'draft',
        createdAt: today(),
        // 阶段默认周期(G2):草案截止日自动算出
        dueDates: { draft: addDays(today(), config.stageDefaults.draft) },
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
      setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...patch } : u))),

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

    setConfig,
    markAllRead: () => setNotifications((ns) => ns.map((n) => ({ ...n, read: true }))),
    pushNotification,
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

// —— KPI 计算 ——
// 默认评分器:按达成的 target 比例给分(决策 6)。
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

export function computeKpi(rule: KpiRule, patents: Patent[], transitions: StageTransition[]): KpiReport {
  const inScope = patents.filter((p) => {
    if (p.archived) return false // 归档专利不进入 KPI 基准
    if (rule.scope.type === 'team' && p.teamId !== rule.scope.teamId) return false
    return true
  })
  const items: KpiItemResult[] = inScope.map((p) => {
    const myTransitions = transitions.filter((t) => t.patentId === p.id)
    const achieved = rule.targets.map((t) => {
      // "到达过"目标阶段(含之后回退的情况),以流转记录为准
      const reached = myTransitions.some(
        (tr) => stageIndex(tr.to) >= stageIndex(t.stage) && tr.at.slice(0, 10) <= t.deadline,
      )
      // 兜底:创建时已在该阶段之后的老专利
      const bornAfter = stageIndex(p.stage) > stageIndex(t.stage) && p.createdAt <= t.deadline
      return reached || bornAfter
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
