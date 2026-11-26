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
  reviewRejected: (p: Patent) => boolean // 当前轮存在打回
  hasLeftDraft: (p: Patent) => boolean // 是否离开过草案(决定能否再设为私有)
  canDeletePatent: (p: Patent) => boolean
  activeUsers: User[]

  saveStageData: (patentId: string, stage: StageKey, data: unknown, note: string) => void
  advance: (patentId: string, reason: string) => void
  rollback: (patentId: string, to: StageKey, reason: string) => void
  inviteReviewer: (patentId: string, userId: string) => void
  withdrawReviewer: (patentId: string, userId: string) => void
  declineReview: (patentId: string, reason: string) => void
  startNewRound: (patentId: string) => void
  submitReview: (patentId: string, score: ReviewScore) => 'ok' | 'below-min'
  saveNotifyConfig: (patentId: string, cfgs: StageNotifyConfig[]) => void
  createPatent: (title: string, visibility: Patent['visibility']) => string
  setVisibility: (patentId: string, v: Patent['visibility']) => void
  archive: (patentId: string, kind: 'completed' | 'abandoned', reason: string) => void
  unarchive: (patentId: string, reason: string) => void
  transferOwnership: (patentId: string, newOwnerId: string, keepAsCollaborator?: boolean) => void
  batchTransfer: (items: { patentId: string; toUserId: string }[], keepAsCollaborator?: boolean) => void
  deactivateMember: (userId: string, assignments: Record<string, string>) => 'ok' | 'unassigned'
  reactivateMember: (userId: string) => void
  migrateTeam: (patentId: string, teamId: string) => void
  deletePatent: (patentId: string) => boolean
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
  createToken: (name: string, days: number, scope: ApiToken['scope']) => string
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

// 日期一律按本地(服务器配置)时区:toISOString 是 UTC,在 UTC+8 的 0–8 点会差一天
const pad = (n: number) => String(n).padStart(2, '0')
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const now = () => {
  const d = new Date()
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const today = () => fmtDate(new Date())
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86400000)
export const addDays = (from: string, days: number) => {
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
    return Math.max(0, daysBetween(due, today()))
  }

  // 收口风险:周期剩余天数 vs 当前及之后各阶段默认预算之和
  const closingRisk = (p: Patent): 'comfortable' | 'tight' | 'doomed' | null => {
    const c = cycleOfPatent(p)
    if (!c || c.status !== 'active' || p.archived || p.crossCycle) return null
    const remaining = daysBetween(today(), c.end)
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

  // 门禁只统计当前轮次、未拒绝邀请的 reviewer
  const reviewPassCount = (p: Patent) =>
    p.stageData.patentability.reviewers.filter((r) => !r.declined && qualifiedPass(r.score)).length

  const reviewRejected = (p: Patent) =>
    p.stageData.patentability.reviewers.some((r) => !r.declined && r.score?.verdict === 'reject')

  // 决策:至少 n 名 reviewer 通过(加权达标),且本轮无打回(打回只阻断本轮,不自动回退)
  const reviewGateOpen = (p: Patent) =>
    !reviewRejected(p) && reviewPassCount(p) >= config.reviewPassCount

  const hasLeftDraft = (p: Patent) =>
    p.stage !== 'draft' || transitions.some((t) => t.patentId === p.id && t.from === 'draft' && t.to !== 'draft')

  // 删除:仅负责人、从未离开草案、从未邀请过 reviewer
  const canDeletePatent = (p: Patent) =>
    p.ownerId === me.id && !hasLeftDraft(p)
    && p.stageData.patentability.reviewers.length === 0
    && p.stageData.patentability.pastRounds.length === 0

  const activeUsers = users.filter((u) => !u.deactivated)

  // 进入新审查轮次:当前轮归档到 pastRounds,reviewer 名单继承并重置为待审查
  const nextRound = (x: Patent, outcome: 'passed' | 'rejected' | 'superseded'): Patent => {
    const rev = x.stageData.patentability
    const submitted = rev.reviewers.some((r) => r.score || r.declined)
    if (!submitted) return x
    return {
      ...x,
      stageData: {
        ...x.stageData,
        patentability: {
          ...rev,
          round: rev.round + 1,
          pastRounds: [...rev.pastRounds, { round: rev.round, reviewers: rev.reviewers, closedAt: now(), outcome }],
          reviewers: rev.reviewers
            .filter((r) => !r.declined && !users.find((u) => u.id === r.userId)?.deactivated)
            .map((r) => ({ ...r, invitedAt: now(), dueDate: addDays(today(), config.reviewerDueDays), score: null })),
        },
      },
    }
  }

  // 阶段变化时,待批的延期申请自动作废
  const voidPendingExts = (x: Patent): Patent => ({
    ...x,
    extensions: x.extensions.map((e) => (e.status === 'pending' ? { ...e, status: 'void' as const } : e)),
  })

  const doTransfer = (x: Patent, newOwnerId: string, keep: boolean): Patent => ({
    ...x,
    ownerId: newOwnerId,
    collaborators: [...new Set([...x.collaborators, ...(keep ? [x.ownerId] : [])])].filter((c) => c !== newOwnerId),
  })

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
      if (!u || u.deactivated) return 'unknown'
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
    reviewRejected, hasLeftDraft, canDeletePatent, activeUsers,

    saveStageData: (patentId, stage, data, note) => {
      setPatents((ps) =>
        ps.map((p) =>
          p.id === patentId
            ? { ...p, stageData: { ...p.stageData, [stage]: data }, needsRecheck: p.needsRecheck.filter((s) => s !== stage) }
            : p,
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
        // 阶段默认周期(G2):推进时自动算出新阶段 due date。
        // 已有设定且未过期、且不是回退后重新进入的阶段才保留;否则按默认周期重算(避免一进入即逾期)。
        // 自定周期必须落在专利周期内:非跨周期项目按周期结束日截断
        const dueDates = { ...x.dueDates }
        const reentered = x.needsRecheck.includes(next.key)
          || transitions.some((t) => t.patentId === x.id && t.kind === 'advance' && t.to === next.key)
        const existing = dueDates[next.key]
        if (!existing || existing < today() || reentered) {
          let due = addDays(today(), config.stageDefaults[next.key])
          const c = cycleOfPatent(x)
          if (c && !x.crossCycle && due > c.end) due = c.end
          dueDates[next.key] = due
        }
        let y: Patent = voidPendingExts({ ...x, stage: next.key, dueDates })
        // 重新进入审查阶段:若上一轮已有提交,自动开启新一轮
        if (next.key === 'patentability') y = nextRound(y, 'superseded')
        return y
      }))
      addTransition({ patentId, from: p.stage, to: next.key, reason, kind: 'advance' })
      pushNotification({ event: 'transition', text: `《${p.title}》已推进至「${next.label}」`, patentId })
    },

    rollback: (patentId, to, reason) => {
      const p = patents.find((x) => x.id === patentId)!
      // 多级回退:被跳过的后续阶段数据保留,标记「需复核」
      const skipped = STAGES.slice(stageIndex(to) + 1, stageIndex(p.stage) + 1).map((s) => s.key)
      setPatents((ps) => ps.map((x) =>
        x.id === patentId
          ? voidPendingExts({ ...x, stage: to, needsRecheck: [...new Set([...x.needsRecheck, ...skipped])] })
          : x))
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
                reviewers: [
                  ...rev.reviewers,
                  { userId, invitedBy: me.id, invitedAt: now(), dueDate: addDays(today(), config.reviewerDueDays), score: null },
                ],
              },
            },
          }
        }),
      )
      pushNotification({ event: 'review', text: `${u.name} 被邀请审查《${p.title}》`, patentId })
    },

    // 撤销邀请:仅限尚未提交意见的 reviewer
    withdrawReviewer: (patentId, userId) => {
      const p = patents.find((x) => x.id === patentId)!
      setPatents((ps) => ps.map((x) => {
        if (x.id !== patentId) return x
        const rev = x.stageData.patentability
        return {
          ...x,
          stageData: {
            ...x.stageData,
            patentability: { ...rev, reviewers: rev.reviewers.filter((r) => r.userId !== userId || !!r.score) },
          },
        }
      }))
      pushNotification({ event: 'review', text: `${userById(userId).name} 对《${p.title}》的审查邀请已撤销`, patentId })
    },

    // reviewer 拒绝邀请:保留记录,不计入门禁
    declineReview: (patentId, reason) => {
      const p = patents.find((x) => x.id === patentId)!
      setPatents((ps) => ps.map((x) => {
        if (x.id !== patentId) return x
        const rev = x.stageData.patentability
        return {
          ...x,
          stageData: {
            ...x.stageData,
            patentability: {
              ...rev,
              reviewers: rev.reviewers.map((r) => (r.userId === me.id ? { ...r, declined: { at: now(), reason } } : r)),
            },
          },
        }
      }))
      pushNotification({ event: 'review', text: `${me.name} 拒绝了《${p.title}》的审查邀请:${reason}`, patentId })
    },

    // 发明人发起新一轮审查(通常在本轮被打回、修改草案后)
    startNewRound: (patentId) => {
      const p = patents.find((x) => x.id === patentId)!
      const outcome = reviewRejected(p) ? 'rejected' : 'superseded'
      setPatents((ps) => ps.map((x) => (x.id === patentId ? nextRound(x, outcome) : x)))
      pushNotification({
        event: 'review',
        text: `《${p.title}》发起第 ${p.stageData.patentability.round + 1} 轮审查,请 reviewer 重新评审`,
        patentId,
      })
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
          // 决策:打回不自动回退,只阻断本轮门禁;由发明人修改后发起新一轮
          return next
        }),
      )
      pushNotification({
        event: 'review',
        text: `${me.name} 已提交对《${p.title}》的审查意见:${score.verdict === 'pass' ? '通过' : '打回'}`,
        patentId,
      })
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
          patentability: { summary: '', selfAssessment: emptyScore, round: 1, reviewers: [], pastRounds: [] },
          implementation: { markdown: '' },
          search: { markdown: '' },
          doi: { title: '', authors: '', venue: '', abstractDraft: '' },
        },
        notify: [],
        needsRecheck: [],
        archived: null,
      }
      setPatents((ps) => [p, ...ps])
      addTransition({ patentId: id, from: null, to: 'draft', reason: '创建专利', kind: 'advance' })
      return id
    },

    // 可见性约束:仅 draft 阶段可以改为私有(私有专利只能停留在草案)
    setVisibility: (patentId, v) => {
      const p = patents.find((x) => x.id === patentId)!
      // 离开过草案(含被回退回草案)的专利不可再设为私有:其流转、审查、KPI 记录已对他人可见
      if (v === 'private' && hasLeftDraft(p)) return
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
        patentId, from: p.stage, to: p.stage, kind: 'archive',
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
      addTransition({ patentId, from: p.stage, to: p.stage, kind: 'unarchive', reason: `恢复归档:${reason}` })
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

    // 专利转交:接收人成为负责人;原负责人默认转为共同发明人(可选择不保留)。
    // 私有专利转交后仍为私有,仅新负责人(及保留的原负责人)可见;团队归属不变(换组决策:专利留在原组)
    transferOwnership: (patentId, newOwnerId, keepAsCollaborator = true) => {
      const p = patents.find((x) => x.id === patentId)!
      const from = userById(p.ownerId).name
      const to = userById(newOwnerId).name
      setPatents((ps) => ps.map((x) => (x.id === patentId ? doTransfer(x, newOwnerId, keepAsCollaborator) : x)))
      pushNotification({ event: 'transition', text: `《${p.title}》已由 ${from} 转交给 ${to}`, patentId })
    },

    batchTransfer: (items, keepAsCollaborator = true) => {
      const map = new Map(items.map((i) => [i.patentId, i.toUserId]))
      setPatents((ps) => ps.map((x) => (map.has(x.id) ? doTransfer(x, map.get(x.id)!, keepAsCollaborator) : x)))
      items.forEach((i) => {
        const p = patents.find((x) => x.id === i.patentId)!
        pushNotification({ event: 'transition', text: `《${p.title}》已转交给 ${userById(i.toUserId).name}(批量转交)`, patentId: p.id })
      })
    },

    // 停用(离职交接):非私有专利必须全部指定接收人;私有草案指定了就转交,未指定则转为团队可见并交给本组 PL。
    // 同时吊销 Token、撤销其未提交的 reviewer 邀请。
    deactivateMember: (userId, assignments) => {
      const u = users.find((x) => x.id === userId)!
      const owned = patents.filter((p) => p.ownerId === userId)
      if (owned.some((p) => p.visibility !== 'private' && !assignments[p.id])) return 'unassigned'
      const pl = teamById(u.teamId).plId
      setPatents((ps) => ps.map((x) => {
        let y = x
        if (x.ownerId === userId) {
          const to = assignments[x.id]
          y = to
            ? doTransfer(x, to, false)
            : { ...doTransfer(x, pl === userId ? me.id : pl, false), visibility: 'team' }
        }
        const rev = y.stageData.patentability
        if (rev.reviewers.some((r) => r.userId === userId && !r.score)) {
          y = {
            ...y,
            stageData: { ...y.stageData, patentability: { ...rev, reviewers: rev.reviewers.filter((r) => r.userId !== userId || !!r.score) } },
          }
        }
        return y
      }))
      setTokens((ts) => ts.map((t) => (t.userId === userId ? { ...t, revoked: true } : t)))
      setUsers((us) => us.map((x) => (x.id === userId ? { ...x, deactivated: { at: now(), by: me.id } } : x)))
      pushNotification({ event: 'transition', text: `${u.name} 已停用,名下 ${owned.length} 件专利完成交接`, patentId: '' })
      return 'ok'
    },

    reactivateMember: (userId) =>
      setUsers((us) => us.map((x) => (x.id === userId ? { ...x, deactivated: undefined } : x))),

    // 迁移团队(换组决策:专利默认留在原组,由原组 PL 或 GL 手动迁移)
    migrateTeam: (patentId, teamId) => {
      const p = patents.find((x) => x.id === patentId)!
      setPatents((ps) => ps.map((x) => (x.id === patentId ? { ...x, teamId } : x)))
      pushNotification({ event: 'transition', text: `《${p.title}》已迁移至「${teamById(teamId).name}」`, patentId })
    },

    deletePatent: (patentId) => {
      const p = patents.find((x) => x.id === patentId)
      if (!p || !canDeletePatent(p)) return false
      setPatents((ps) => ps.filter((x) => x.id !== patentId))
      setVersions((vs) => vs.filter((v) => v.patentId !== patentId))
      setTransitions((ts) => ts.filter((t) => t.patentId !== patentId))
      return true
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

    createToken: (name, days, scope) => {
      const token = `pfk_${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`
      setTokens((ts) => [
        ...ts,
        { id: `tk${++seq}`, userId: me.id, name, token, createdAt: now(), expiresAt: addDays(today(), days), revoked: false, scope },
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
      const days = daysBetween(oldDue, newDue)
      // 阈值按同一阶段累计已生效延期天数判断,防止拆成多次小额延期绕过审批
      const used = p.extensions
        .filter((e) => e.stage === p.stage && e.status === 'applied')
        .reduce((a, e) => a + daysBetween(e.oldDue, e.newDue), 0)
      const auto = used + days <= config.overdue.extensionApprovalThreshold
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
              e.id === extId
                ? {
                    ...e,
                    status: approve ? ('applied' as const) : ('rejected' as const),
                    approvedBy: me.id,
                    selfApproved: e.by === me.id || p.ownerId === me.id, // PL 自批:允许,留痕
                  }
                : e,
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
// 事件口径:目标阶段的「首次到达」必须是 advance 类流转,且落在周期窗口内、截止日之前。
//   · 只认 advance:回退、归档、恢复归档都不算「到达」(恢复归档不会在新周期被重复计数)
//   · 只认首次:某阶段在 A 周期首次到达,B 周期回退后再推进不再计入,跨周期无双计
// 分母 = 周期内活跃的非私有专利(私有对 GL/PL 完全透明,不进入任何统计):
//   · createdAt ≤ cycle.end
//   · 完成归档保留;放弃归档仅当归档日 ≤ 周期结束前 N 天(config.overdue.abandonExcludeDays)才退出分母
//   · 跨周期标记专利按配置决定是否计入
// 计分:ratio = 单件得分 = 达成目标数/目标总数,整体取均值;
//       tiered = 「全部目标均达成」的件数落入阈值档位,取对应分值,否则 elseScore
// rule.scorerHook 非空时,真实后端改为调用自由计算回调 compute_item / compute_kpi。
export interface KpiItemResult {
  patentId: string
  title: string
  ownerId: string
  collaborators: string[]
  currentStage: StageKey
  achievedTargets: boolean[]
  score: number // 0-1
}

export interface KpiReport {
  rule: KpiRule
  items: KpiItemResult[]
  overall: number
  fullyAchieved: number // 全部目标均达成的件数(tiered 计分依据)
}

export interface KpiSnapshot {
  id: string
  cycleId: string
  ruleId: string
  frozenAt: string
  overall: number
  items: KpiItemResult[]
}

export function kpiInScope(p: Patent, rule: KpiRule, cycle: Cycle | undefined, config: SystemConfig) {
  if (!cycle) return false
  if (p.visibility === 'private') return false
  if (p.createdAt > cycle.end) return false
  if (p.archived?.kind === 'abandoned') {
    const cutoff = addDays(cycle.end, -config.overdue.abandonExcludeDays)
    if (p.archived.at.slice(0, 10) <= cutoff) return false
  }
  if (p.archived && p.archived.at.slice(0, 10) < cycle.start) return false
  if (p.crossCycle && !config.overdue.includeCrossCycleInKpi) return false
  if (rule.scope.type === 'team' && p.teamId !== rule.scope.teamId) return false
  return true
}

// 某专利首次 advance 到达(≥)目标阶段的日期
export function firstReach(patentId: string, stage: StageKey, transitions: StageTransition[]) {
  const hit = transitions
    .filter((t) => t.patentId === patentId && t.kind === 'advance' && stageIndex(t.to) >= stageIndex(stage))
    .sort((a, b) => a.at.localeCompare(b.at))[0]
  return hit?.at.slice(0, 10)
}

export function computeKpi(
  rule: KpiRule,
  patents: Patent[],
  transitions: StageTransition[],
  cycles: Cycle[],
  config: SystemConfig,
): KpiReport {
  const cycle = cycles.find((c) => c.id === rule.cycleId)
  const inScope = patents.filter((p) => kpiInScope(p, rule, cycle, config))
  const items: KpiItemResult[] = inScope.map((p) => {
    const achieved = rule.targets.map((t) => {
      if (!cycle) return false
      const deadline = t.deadline < cycle.end ? t.deadline : cycle.end
      const at = firstReach(p.id, t.stage, transitions)
      return !!at && at >= cycle.start && at <= deadline
    })
    const score = achieved.filter(Boolean).length / rule.targets.length
    return {
      patentId: p.id, title: p.title, ownerId: p.ownerId, collaborators: p.collaborators,
      currentStage: p.stage, achievedTargets: achieved, score,
    }
  })
  const fullyAchieved = items.filter((i) => i.score === 1).length
  let overall: number
  if (rule.scoring.mode === 'tiered') {
    const tier = [...rule.scoring.tiers].sort((a, b) => b.minCount - a.minCount).find((t) => fullyAchieved >= t.minCount)
    overall = tier ? tier.score : rule.scoring.elseScore
  } else {
    overall = items.length ? items.reduce((a, b) => a + b.score, 0) / items.length : 0
  }
  return { rule, items, overall, fullyAchieved }
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
      if (p.visibility === 'private') continue // 私有完全透明
      if (p.createdAt >= cutoff) continue // 尚未创建
      // 回放:默认从草案开始,按时间应用流转
      let stage: StageKey = 'draft'
      const my = transitions
        .filter((t) => t.patentId === p.id && t.at.slice(0, 10) < cutoff && t.kind !== 'archive' && t.kind !== 'unarchive')
        .sort((a, b) => a.at.localeCompare(b.at))
      for (const t of my) stage = t.to
      counts[stage] += 1
    }
    return { month, counts }
  })
}

export type { NotifyEvent }
