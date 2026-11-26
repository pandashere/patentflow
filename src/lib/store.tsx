import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { setReferenceData, teamById } from './data'
import {
  ROLE_LABEL, STAGES, stageIndex,
  type ApiToken, type Cycle, type KpiRule, type Notification, type Patent, type ReviewScore, type Role,
  type StageKey, type StageNotifyConfig, type StageTransition, type StageVersion, type SystemConfig, type Team,
  type User, type UserPrefs,
} from './types'

// —— 日期:一律按本地(服务器配置)时区 ——
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
  return fmtDate(d)
}

// 演示模式下的快速身份切换(以演示账号真实登录)
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
const DEMO_PASSWORD = 'demo1234'

// —— KPI 报表(后端计算;非 GL 对不可见专利标题脱敏) ——
export interface KpiItemResult {
  patentId: string
  title: string
  ownerId: string
  collaborators: string[]
  currentStage: StageKey
  achievedTargets: boolean[]
  score: number
}

export interface KpiReport {
  rule: KpiRule
  items: KpiItemResult[]
  overall: number
  fullyAchieved: number
  frozenAt?: string
}

interface Bootstrap {
  me: User
  users: User[]
  teams: Team[]
  config: SystemConfig
  patents: Patent[]
  versions: StageVersion[]
  transitions: StageTransition[]
  kpiRules: KpiRule[]
  kpiReports: Record<string, Omit<KpiReport, 'rule'>>
  pendingRegistrations: User[]
  cycles: Cycle[]
  notifications: Notification[]
  tokens: ApiToken[]
  prefs: UserPrefs
  demo: boolean
}

// 回调探测结果
export interface ProbeResult {
  ok: boolean
  status: number | null
  latencyMs: number
  error: string | null
}

export interface NotifyPreview {
  recipients: { id: string; name: string; delivered: boolean; reason: string }[]
  webhookConfigured: boolean
  webhook: ProbeResult | null
}

interface Providers {
  selfRegistration?: boolean
  local: boolean
  demo: boolean
  sso: { name: string; issuer: string; enabled: boolean; connected: boolean }[]
}

// 保存冲突:他人已更新该阶段 → 由用户选择以谁为准
export interface StageConflict {
  patentId: string
  stage: StageKey
  mine: Record<string, unknown>
  theirs: Record<string, unknown>
  currentVersion: number
  note: string
}

// 成功返回状态;失败返回后端给出的原因(直接展示在延期框内)
type ExtResult = 'applied' | 'pending' | { error: string }

interface Store {
  ready: boolean
  loggedIn: boolean
  providers: Providers
  error: string | null
  clearError: () => void
  notice: string | null // 操作成功的轻提示
  clearNotice: () => void
  conflict: StageConflict | null
  resolveConflict: (keep: 'mine' | 'theirs') => Promise<void>

  me: User
  persona: Persona
  setPersona: (key: string) => Promise<void>
  users: User[]
  teams: Team[]
  userById: (id: string) => User
  patents: Patent[]
  versions: StageVersion[]
  transitions: StageTransition[]
  kpiRules: KpiRule[]
  kpiReport: (rule: KpiRule) => KpiReport
  notifications: Notification[]
  config: SystemConfig
  tokens: ApiToken[]
  prefs: UserPrefs
  cycles: Cycle[]
  activeCycle: () => Cycle | undefined
  cycleOfPatent: (p: Patent) => Cycle | undefined
  stageOverdueDays: (p: Patent) => number
  closingRisk: (p: Patent) => 'comfortable' | 'tight' | 'doomed' | null

  login: (email: string, password: string) => Promise<string | null> // 返回错误信息或 null
  logout: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<{ message: string; demoLink?: string }>
  resetPassword: (token: string, pwd: string) => Promise<'ok' | 'invalid' | 'expired' | 'weak'>
  changePassword: (oldPwd: string, newPwd: string) => Promise<string | null>

  visiblePatents: () => Patent[]
  canEditPatent: (p: Patent) => boolean
  canOperatePatent: (p: Patent) => boolean
  isReviewerOf: (p: Patent) => boolean
  reviewPassCount: (p: Patent) => number
  reviewGateOpen: (p: Patent) => boolean
  reviewRejected: (p: Patent) => boolean
  hasLeftDraft: (p: Patent) => boolean
  canDeletePatent: (p: Patent) => boolean
  activeUsers: User[]

  // baseVersion:表单打开时的版本(乐观锁基准);不传则以当前最新版本为基准(用于恢复旧版本等显式覆盖)
  saveStageData: (patentId: string, stage: StageKey, data: unknown, note: string, baseVersion?: number) => Promise<void>
  latestVersion: (patentId: string, stage: StageKey) => number
  formEpoch: number // 保存成功 / 冲突处理后递增,阶段表单据此重新载入
  advance: (patentId: string, reason: string) => Promise<void>
  rollback: (patentId: string, to: StageKey, reason: string) => Promise<void>
  inviteReviewer: (patentId: string, userId: string) => Promise<void>
  withdrawReviewer: (patentId: string, userId: string) => Promise<void>
  declineReview: (patentId: string, reason: string) => Promise<void>
  startNewRound: (patentId: string) => Promise<void>
  submitReview: (patentId: string, score: ReviewScore) => Promise<'ok' | 'below-min' | 'error'>
  saveNotifyConfig: (patentId: string, cfgs: StageNotifyConfig[]) => Promise<void>
  createPatent: (title: string, visibility: Patent['visibility']) => Promise<string | null>
  setVisibility: (patentId: string, v: Patent['visibility']) => Promise<void>
  archive: (patentId: string, kind: 'completed' | 'abandoned', reason: string) => Promise<void>
  unarchive: (patentId: string, reason: string) => Promise<void>
  transferOwnership: (patentId: string, newOwnerId: string, keepAsCollaborator?: boolean) => Promise<void>
  batchTransfer: (items: { patentId: string; toUserId: string }[], keepAsCollaborator?: boolean) => Promise<boolean>
  deactivateMember: (userId: string, assignments: Record<string, string>) => Promise<'ok' | 'unassigned' | 'error'>
  reactivateMember: (userId: string) => Promise<void>
  migrateTeam: (patentId: string, teamId: string) => Promise<void>
  deletePatent: (patentId: string) => Promise<boolean>
  setCollaborators: (patentId: string, ids: string[]) => Promise<void>
  saveKpiRule: (rule: KpiRule) => Promise<void>
  toggleKpiRule: (id: string) => Promise<void>
  setConfig: (c: SystemConfig) => Promise<void>
  addMember: (m: { name: string; email: string; title: string; teamId: string; role: Role }) => Promise<string | null>
  canManageTeam: (teamId: string) => boolean
  pendingRegistrations: User[]
  approveRegistration: (uid: string, patch?: { teamId?: string; role?: Role }) => Promise<void>
  rejectRegistration: (uid: string, reason: string) => Promise<void>
  createTeam: (name: string, plId: string | null, demoteOld: boolean) => Promise<boolean>
  renameTeam: (id: string, name: string) => Promise<void>
  deleteTeam: (id: string) => Promise<void>
  setTeamPl: (id: string, userId: string | null, demoteOld: boolean) => Promise<boolean>
  testWebhook: (url: string) => Promise<ProbeResult & { url: string; signed: boolean }>
  notifyMeTest: () => Promise<{ webhookConfigured: boolean; webhook: ProbeResult | null; quietNow: boolean; quietHours: string; mutedEvents: string[] } | null>
  previewNotify: (patentId: string, event: string, cfg: StageNotifyConfig[]) => Promise<NotifyPreview | null>
  updateMember: (id: string, patch: Partial<Pick<User, 'role' | 'teamId' | 'name' | 'email'>>) => Promise<void>
  updateProfile: (patch: Partial<Pick<User, 'name' | 'email'>>) => Promise<boolean>
  savePrefs: (patch: Partial<UserPrefs>) => Promise<void>
  saveCycle: (c: Cycle) => Promise<void>
  closeCycle: (id: string) => Promise<void>
  requestExtension: (patentId: string, newDue: string, reason: string) => Promise<ExtResult>
  reviewExtension: (patentId: string, extId: string, approve: boolean) => Promise<void>
  nudge: (patentId: string) => Promise<void>
  toggleCrossCycle: (patentId: string) => Promise<void>
  createToken: (name: string, days: number, scope: ApiToken['scope']) => Promise<string | null>
  revokeToken: (id: string) => Promise<void>
  adminRevokeToken: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const Ctx = createContext<Store | null>(null)

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('store missing')
  return s
}

// —— 加权均分:GL 配置的维度权重;「通过」低于加权下限则不计入门禁 ——
export function weightedScore(s: Pick<ReviewScore, 'difficulty' | 'nonObviousness' | 'novelty'>, config: SystemConfig) {
  const totalW = config.reviewDims.reduce((a, d) => a + d.weight, 0) || 1
  return config.reviewDims.reduce((a, d) => a + s[d.key] * d.weight, 0) / totalW
}

const EMPTY_CONFIG: SystemConfig = {
  reviewPassCount: 2, reviewMinWeighted: 3, reviewerDueDays: 7, reviewDims: [], classSuggestions: [],
  stageDefaults: { draft: 14, patentability: 7, implementation: 30, search: 21, doi: 30 }, numberPrefix: 'PF',
  webhookUrl: '', ssoProviders: [],
  notifyDefaults: {
    review: { owner: true, pl: true, gl: false }, due: { owner: true, pl: true, gl: false },
    transition: { owner: true, pl: true, gl: true },
  },
  overdue: {
    extensionApprovalThreshold: 14, freezeAdvanceOnOverdue: false, autoNudge: 'off', includeCrossCycleInKpi: true,
    abandonExcludeDays: 30,
  },
  members: { selfRegistration: true, plCanManage: true },
}
const GUEST: User = { id: '', name: '', role: 'user', teamId: '', email: '', title: '', ssoBound: false }
const DEFAULT_PREFS: UserPrefs = {
  notifyEvents: { review: true, due: true, transition: true }, dueReminderDays: [3, 1, 0],
  quietHours: '22:00-08:00', defaultVisibility: 'team', homePage: 'dashboard',
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [ready, setReady] = useState(false)
  const [providers, setProviders] = useState<Providers>({ local: true, demo: false, sso: [] })
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<StageConflict | null>(null)
  const [formEpoch, setFormEpoch] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const b = await api.get<Bootstrap>('/bootstrap')
      setReferenceData(b.teams)
      setBoot(b)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setBoot(null)
      else throw e
    }
  }, [])

  useEffect(() => {
    // 首次加载:取登录方式与会话数据(异步回调中 setState,非同步级联)
    api.get<Providers>('/auth/providers').then(setProviders).catch(() => {})
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload().catch((e) => setError(String(e))).finally(() => setReady(true))
  }, [reload])

  // 统一执行写操作:成功后刷新数据,失败弹出错误
  const act = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const r = await fn()
      await reload()
      return r
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setBoot(null); return undefined }
      setError(e instanceof Error ? e.message : String(e))
      await reload().catch(() => {})
      return undefined
    }
  }

  const b = boot
  const me = b?.me ?? GUEST
  const users = b?.users ?? []
  const patents = b?.patents ?? []
  const transitions = b?.transitions ?? []
  const config = b?.config ?? { ...EMPTY_CONFIG, ssoProviders: providers.sso }
  const cycles = b?.cycles ?? []
  const userById = (id: string) =>
    users.find((u) => u.id === id) ?? { ...GUEST, id, name: id === 'system' ? '系统' : '(未知成员)' }
  const persona: Persona = PERSONAS.find((p) => p.userId === me.id) ?? {
    key: me.role, userId: me.id, label: ROLE_LABEL[me.role], desc: `${me.name} · ${me.title}`,
  }

  // —— 周期与逾期(纯派生) ——
  // 与后端一致:以创建时记录的 cycleId 为准;旧数据按创建日落入的最早开始周期
  const cycleOfPatent = (p: Patent) =>
    p.cycleId
      ? cycles.find((c) => c.id === p.cycleId)
      : cycles.filter((c) => p.createdAt >= c.start && p.createdAt <= c.end).sort((a, c) => a.start.localeCompare(c.start))[0]
  const activeCycle = () => cycles.find((c) => c.status === 'active')
  const stageOverdueDays = (p: Patent) => {
    if (p.archived) return 0
    const due = p.dueDates[p.stage]
    return due ? Math.max(0, daysBetween(due, today())) : 0
  }
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

  // —— 权限(体验层;后端为唯一权威) ——
  const isReviewerOf = (p: Patent) => p.stageData.patentability.reviewers.some((r) => r.userId === me.id)
  const isManager = (p: Patent) => me.role === 'gl' || (me.role === 'pl' && me.teamId === p.teamId)
  const canEditPatent = (p: Patent) =>
    p.ownerId === me.id || p.collaborators.includes(me.id) || (p.visibility !== 'private' && isManager(p))
  const canOperatePatent = (p: Patent) => p.ownerId === me.id || (p.visibility !== 'private' && isManager(p))

  const qualifiedPass = (s: ReviewScore | null) =>
    s?.verdict === 'pass' && weightedScore(s, config) >= config.reviewMinWeighted
  // 与后端一致:门禁只统计未拒绝、且不是当前负责人的 reviewer
  const gateReviewers = (p: Patent) =>
    p.stageData.patentability.reviewers.filter((r) => !r.declined && r.userId !== p.ownerId)
  const reviewPassCount = (p: Patent) => gateReviewers(p).filter((r) => qualifiedPass(r.score)).length
  const reviewRejected = (p: Patent) => gateReviewers(p).some((r) => r.score?.verdict === 'reject')
  const reviewGateOpen = (p: Patent) => !reviewRejected(p) && reviewPassCount(p) >= config.reviewPassCount
  const hasLeftDraft = (p: Patent) =>
    p.stage !== 'draft' || transitions.some((t) => t.patentId === p.id && t.from === 'draft' && t.to !== 'draft')
  const canDeletePatent = (p: Patent) =>
    p.ownerId === me.id && !hasLeftDraft(p)
    && p.stageData.patentability.reviewers.length === 0 && p.stageData.patentability.pastRounds.length === 0

  const kpiReport = (rule: KpiRule): KpiReport => {
    const r = b?.kpiReports[rule.id]
    return r ? { ...r, rule } : { rule, items: [], overall: 0, fullyAchieved: 0 }
  }

  const P = (id: string) => `/patents/${id}`
  const latestVersion = (pid: string, stage: StageKey) =>
    Math.max(0, ...(b?.versions ?? []).filter((v) => v.patentId === pid && v.stage === stage).map((v) => v.version))

  const doLogin = async (email: string, password: string) => {
    try {
      await api.post('/auth/login', { email, password })
      await reload()
      return null
    } catch (e) {
      return e instanceof ApiError ? e.message : String(e)
    }
  }

  const saveStage = async (pid: string, stage: StageKey, data: unknown, note: string, baseVersion: number) => {
    try {
      await api.patch(`${P(pid)}/stages/${stage}`, { data, note, baseVersion })
      setConflict(null)
      await reload()
      setFormEpoch((n) => n + 1)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.extra.reason === 'stale_version') {
        setConflict({
          patentId: pid, stage, note, mine: data as Record<string, unknown>,
          theirs: e.extra.current as Record<string, unknown>, currentVersion: e.extra.currentVersion as number,
        })
        await reload()
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const store: Store = {
    ready, loggedIn: !!b, providers, error, clearError: () => setError(null),
    notice, clearNotice: () => setNotice(null),
    conflict,
    resolveConflict: async (keep) => {
      if (!conflict) return
      if (keep === 'theirs') { setConflict(null); setFormEpoch((n) => n + 1); return }
      await saveStage(conflict.patentId, conflict.stage, conflict.mine, conflict.note, conflict.currentVersion)
    },

    me, persona, users, teams: (b?.teams ?? []).filter((t) => !t.archived), userById, patents, transitions, cycles, config,
    versions: b?.versions ?? [], kpiRules: b?.kpiRules ?? [], kpiReport,
    notifications: b?.notifications ?? [], tokens: b?.tokens ?? [], prefs: b?.prefs ?? DEFAULT_PREFS,
    activeCycle, cycleOfPatent, stageOverdueDays, closingRisk,

    setPersona: async (key) => {
      const p = PERSONAS.find((x) => x.key === key)
      const u = p && users.find((x) => x.id === p.userId)
      if (!u) return
      await api.post('/auth/logout').catch(() => {})
      const err = await doLogin(u.email, DEMO_PASSWORD)
      if (err) setError(`切换身份失败:${err}`)
    },
    login: doLogin,
    // 服务端确认注销后才回到登录页;失败时保留登录态并提示(避免共用电脑上留下有效会话)
    logout: async () => {
      try {
        await api.post('/auth/logout')
        setBoot(null)
      } catch (e) {
        setError(`退出失败:${e instanceof Error ? e.message : String(e)},请检查网络后重试`)
      }
    },
    requestPasswordReset: (email) => api.post('/auth/password/forgot', { email }),
    resetPassword: async (token, pwd) => {
      if (pwd.length < 8) return 'weak'
      try {
        await api.post('/auth/password/reset', { token, password: pwd })
        return 'ok'
      } catch (e) {
        return e instanceof ApiError && e.code === 'reset_expired' ? 'expired' : 'invalid'
      }
    },
    changePassword: async (oldPwd, newPwd) => {
      try {
        await api.post('/me/password', { old: oldPwd, new: newPwd })
        return null
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },

    visiblePatents: () => patents,
    canEditPatent, canOperatePatent, isReviewerOf, reviewPassCount, reviewGateOpen, reviewRejected,
    hasLeftDraft, canDeletePatent, activeUsers: users.filter((u) => !u.deactivated),

    saveStageData: (pid, stage, data, note, baseVersion) =>
      saveStage(pid, stage, data, note, baseVersion ?? latestVersion(pid, stage)),
    latestVersion, formEpoch,
    // 携带打开确认框时的 rev:他人已先推进/回退则返回 409,避免一次确认连跳两个阶段
    advance: async (pid, reason) => {
      const rev = patents.find((p) => p.id === pid)?.rev
      await act(() => api.post(`${P(pid)}/advance`, { reason, rev }))
    },
    rollback: async (pid, to, reason) => {
      const rev = patents.find((p) => p.id === pid)?.rev
      await act(() => api.post(`${P(pid)}/rollback`, { to, reason, rev }))
    },
    inviteReviewer: async (pid, userId) => { await act(() => api.post(`${P(pid)}/reviewers`, { userId })) },
    withdrawReviewer: async (pid, uid) => { await act(() => api.del(`${P(pid)}/reviewers/${uid}`)) },
    declineReview: async (pid, reason) => { await act(() => api.post(`${P(pid)}/reviewers/me/decline`, { reason })) },
    startNewRound: async (pid) => { await act(() => api.post(`${P(pid)}/reviews/rounds`)) },
    submitReview: async (pid, score) => {
      try {
        await api.post(`${P(pid)}/reviews`, score)
        await reload()
        return 'ok'
      } catch (e) {
        if (e instanceof ApiError && e.code === 'below_min') return 'below-min'
        setError(e instanceof Error ? e.message : String(e))
        return 'error'
      }
    },
    saveNotifyConfig: async (pid, cfgs) => { await act(() => api.put(`${P(pid)}/notification-settings`, cfgs)) },
    createPatent: async (title, visibility) =>
      (await act(() => api.post<Patent>('/patents', { title, visibility })))?.id ?? null,
    setVisibility: async (pid, v) => { await act(() => api.patch(`${P(pid)}/visibility`, { visibility: v })) },
    archive: async (pid, kind, reason) => { await act(() => api.post(`${P(pid)}/archive`, { kind, reason })) },
    unarchive: async (pid, reason) => { await act(() => api.post(`${P(pid)}/unarchive`, { reason })) },
    transferOwnership: async (pid, to, keep = true) => {
      await act(() => api.post(`${P(pid)}/transfer`, { to, keepAsCollaborator: keep }))
    },
    batchTransfer: async (items, keep = true) =>
      (await act(() => api.post('/patents-transfer-batch', { items, keepAsCollaborator: keep }))) !== undefined,
    deactivateMember: async (uid, assignments) => {
      try {
        await api.post(`/users/${uid}/deactivate`, { assignments })
        await reload()
        return 'ok'
      } catch (e) {
        if (e instanceof ApiError && e.code === 'unassigned') return 'unassigned'
        setError(e instanceof Error ? e.message : String(e))
        return 'error'
      }
    },
    reactivateMember: async (uid) => { await act(() => api.post(`/users/${uid}/reactivate`)) },
    migrateTeam: async (pid, teamId) => { await act(() => api.post(`${P(pid)}/team`, { teamId })) },
    deletePatent: async (pid) => (await act(() => api.del(P(pid)))) !== undefined,
    setCollaborators: async (pid, ids) => {
      const rev = patents.find((p) => p.id === pid)?.rev
      await act(() => api.put(`${P(pid)}/collaborators`, { userIds: ids, rev }))
    },
    saveKpiRule: async (rule) => { await act(() => api.post('/kpi/rules', rule)) },
    toggleKpiRule: async (id) => { await act(() => api.post(`/kpi/rules/${id}/toggle`)) },
    setConfig: async (c) => {
      // 只提交改动过的字段(两级),由后端与当前配置合并,避免整份旧配置覆盖他人刚保存的设置
      const prev = config as unknown as Record<string, unknown>
      const next = c as unknown as Record<string, unknown>
      // 递归比较:对象只保留变化的叶子字段,数组整体替换
      const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
      const diff = (a: Record<string, unknown>, v: Record<string, unknown>) => {
        const out: Record<string, unknown> = {}
        for (const k of Object.keys(v)) {
          if (JSON.stringify(a[k]) === JSON.stringify(v[k])) continue
          out[k] = isObj(a[k]) && isObj(v[k]) ? diff(a[k] as Record<string, unknown>, v[k] as Record<string, unknown>) : v[k]
        }
        return out
      }
      const patch = diff(prev, next)
      if (b) setBoot({ ...b, config: c }) // 乐观更新,输入不卡顿
      if (Object.keys(patch).length) await act(() => api.put('/config', patch))
    },
    addMember: async (m) =>
      (await act(() => api.post<{ activationLink: string }>('/users', m)))?.activationLink ?? null,
    canManageTeam: (teamId) =>
      me.role === 'gl' || (me.role === 'pl' && me.teamId === teamId && config.members.plCanManage),
    pendingRegistrations: b?.pendingRegistrations ?? [],
    approveRegistration: async (uid, patch = {}) => { await act(() => api.post(`/registrations/${uid}/approve`, patch)) },
    rejectRegistration: async (uid, reason) => { await act(() => api.post(`/registrations/${uid}/reject`, { reason })) },
    createTeam: async (name, plId, demoteOld) =>
      (await act(() => api.post('/teams', { name, plId, demoteOld }))) !== undefined,
    renameTeam: async (id, name) => { await act(() => api.patch(`/teams/${id}`, { name })) },
    deleteTeam: async (id) => { await act(() => api.del(`/teams/${id}`)) },
    setTeamPl: async (id, userId, demoteOld) =>
      (await act(() => api.put(`/teams/${id}/pl`, { userId, demoteOld }))) !== undefined,
    testWebhook: (url) => api.post('/notify/test-webhook', { url }),
    notifyMeTest: async () => (await act(() => api.post<Awaited<ReturnType<Store['notifyMeTest']>>>('/me/notify-test'))) ?? null,
    previewNotify: async (pid, event, cfg) => {
      try {
        return await api.post<NotifyPreview>(`${P(pid)}/notification-settings/preview`, { event, config: cfg })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return null
      }
    },
    updateMember: async (id, patch) => { await act(() => api.patch(`/users/${id}`, patch)) },
    updateProfile: async (patch) => (await act(() => api.put('/me', patch))) !== undefined,
    savePrefs: async (patch) => { await act(() => api.put('/me/prefs', patch)) },
    saveCycle: async (c) => { await act(() => api.post('/cycles', c)) },
    closeCycle: async (id) => { await act(() => api.post(`/cycles/${id}/close`)) },
    requestExtension: async (pid, newDue, reason) => {
      try {
        const stage = patents.find((p) => p.id === pid)?.stage
        const r = await api.post<{ status: 'applied' | 'pending' }>(`${P(pid)}/extensions`, { newDue, reason, stage })
        await reload()
        return r.status
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
    reviewExtension: async (pid, eid, approve) => {
      await act(() => api.post(`${P(pid)}/extensions/${eid}/${approve ? 'approve' : 'reject'}`))
    },
    nudge: async (pid) => {
      if ((await act(() => api.post(`${P(pid)}/nudge`))) !== undefined) setNotice('已催办,负责人与共同发明人会收到通知')
    },
    toggleCrossCycle: async (pid) => { await act(() => api.post(`${P(pid)}/cross-cycle`)) },
    createToken: async (name, days, scope) =>
      (await act(() => api.post<{ token: string }>('/tokens', { name, days, scope })))?.token ?? null,
    revokeToken: async (id) => { await act(() => api.del(`/tokens/${id}`)) },
    adminRevokeToken: async (id) => { await act(() => api.del(`/tokens/${id}`)) },
    markAllRead: async () => { await act(() => api.post('/notifications/read-all')) },
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

// 某专利首次 advance 到达(≥)目标阶段的日期(与后端 KPI 引擎同口径)
export function firstReach(patentId: string, stage: StageKey, transitions: StageTransition[]) {
  const hit = transitions
    .filter((t) => t.patentId === patentId && t.kind === 'advance' && stageIndex(t.to) >= stageIndex(stage))
    .sort((a, b) => a.at.localeCompare(b.at))[0]
  return hit?.at.slice(0, 10)
}

export function teamName(id: string) {
  return teamById(id).name
}

// —— 阶段数量趋势:回放流转记录,统计每个月末各阶段的专利数 ——
export interface TrendPoint {
  month: string
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

export function computeStageTrend(patents: Patent[], transitions: StageTransition[], months: string[]): TrendPoint[] {
  return months.map((month) => {
    const [y, m] = month.split('-').map(Number)
    const cutoff = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    const counts: Record<StageKey, number> = { draft: 0, patentability: 0, implementation: 0, search: 0, doi: 0 }
    for (const p of patents) {
      if (p.archived) continue // 归档专利退出流水线统计
      if (p.visibility === 'private') continue // 私有完全透明
      if (p.createdAt >= cutoff) continue
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

export type { NotifyEvent } from './types'
