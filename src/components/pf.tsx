import { cn } from '@/lib/utils'
import { STAGES, stageIndex, type Patent, type StageKey, type Visibility } from '@/lib/types'
import { Check, Lock, RotateCcw, Users, Globe, Clock, Archive } from 'lucide-react'

// —— 阶段语义色(由主色板派生) ——
export const STAGE_COLOR: Record<StageKey, string> = {
  draft: '#64748b',
  patentability: '#0d9488',
  implementation: '#1d4ed8',
  search: '#b45309',
  doi: '#6d28d9',
}

export function StagePill({ stage, className }: { stage: StageKey; className?: string }) {
  const s = STAGES[stageIndex(stage)]
  const c = STAGE_COLOR[stage]
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', className)}
      style={{ color: c, backgroundColor: `${c}14`, border: `1px solid ${c}33` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: c }} />
      {s.label}
    </span>
  )
}

export function ArchivedBadge({ kind }: { kind: 'completed' | 'abandoned' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        kind === 'completed'
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-slate-300 bg-slate-100 text-slate-500',
      )}
    >
      <Archive className="size-3" />
      {kind === 'completed' ? '已归档 · 完成' : '已归档 · 放弃'}
    </span>
  )
}

export function VisibilityTag({ v }: { v: Visibility }) {
  const map = {
    private: { icon: Lock, label: '私有', cls: 'text-slate-500 border-slate-300' },
    team: { icon: Users, label: '团队', cls: 'text-sky-700 border-sky-300' },
    public: { icon: Globe, label: '公开', cls: 'text-emerald-700 border-emerald-300' },
  } as const
  const { icon: Icon, label, cls } = map[v]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px]', cls)}>
      <Icon className="size-3" />
      {label}
    </span>
  )
}

// —— due date 徽标:>7d 灰,≤7d 琥珀,逾期红且脉冲 ——
export function DueChip({ date }: { date?: string }) {
  if (!date) return <span className="text-xs text-muted-foreground">未设截止</span>
  const today = new Date('2026-11-26')
  const d = new Date(date)
  const days = Math.ceil((d.getTime() - today.getTime()) / 86400000)
  const state = days < 0 ? 'over' : days <= 7 ? 'soon' : 'ok'
  const styles = {
    over: 'text-red-700 bg-red-50 border-red-200',
    soon: 'text-amber-700 bg-amber-50 border-amber-200',
    ok: 'text-slate-600 bg-slate-50 border-slate-200',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded border px-1.5 py-px font-mono-x text-[11px]', styles[state])}>
      <span
        className={cn('size-1.5 rounded-full', state === 'over' && 'pulse-dot')}
        style={{ backgroundColor: state === 'over' ? '#dc2626' : state === 'soon' ? '#d97706' : '#94a3b8' }}
      />
      {date}
      <span className="font-sans">{days < 0 ? `逾期 ${-days} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`}</span>
    </span>
  )
}

// —— 五阶段步进器 ——
export function StageStepper({ patent, onSelect }: { patent: Patent; onSelect?: (k: StageKey) => void }) {
  const cur = stageIndex(patent.stage)
  return (
    <div className="flex items-start">
      {STAGES.map((s, i) => {
        const done = i < cur
        const active = i === cur
        const color = STAGE_COLOR[s.key]
        return (
          <div key={s.key} className="flex flex-1 items-start last:flex-none">
            <button
              type="button"
              onClick={() => onSelect?.(s.key)}
              className="group flex w-full min-w-0 flex-col items-center gap-1.5 focus-visible:outline-none"
            >
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-all duration-200',
                  'group-focus-visible:ring-2 group-focus-visible:ring-teal-700/40',
                )}
                style={{
                  borderColor: done || active ? color : '#cbd5e1',
                  backgroundColor: done ? color : active ? '#fff' : '#fff',
                  color: done ? '#fff' : active ? color : '#94a3b8',
                  boxShadow: active ? `0 0 0 4px ${color}22` : undefined,
                }}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span
                className={cn('max-w-full truncate text-center text-xs leading-tight', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}
              >
                {s.label}
              </span>
              <span className="font-mono-x text-[9px] tracking-widest" style={{ color: done || active ? color : '#b6bfcc' }}>
                {s.en}
              </span>
              {i >= cur && patent.dueDates[s.key] && (
                <span className="mt-0.5 scale-90">
                  <DueChip date={patent.dueDates[s.key]} />
                </span>
              )}
            </button>
            {i < STAGES.length - 1 && (
              <div className="mx-1 mt-4 h-0.5 min-w-4 flex-1 rounded" style={{ backgroundColor: i < cur ? STAGE_COLOR[STAGES[i + 1].key] : '#e2e8f0' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// —— 三维度雷达图(技术难度 / 非显而易见性 / 创新性) ——
export function RadarChart({
  values, size = 168, color = '#0d9488', label,
}: {
  values: [number, number, number]
  size?: number
  color?: string
  label?: string
}) {
  const dims = ['技术难度', '非显而易见性', '创新性']
  const cx = size / 2
  const cy = size / 2 + 4
  const R = size / 2 - 26
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const
  }
  const ring = (frac: number) =>
    [0, 1, 2].map((i) => pt(i, R * frac).join(',')).join(' ')
  const poly = [0, 1, 2].map((i) => pt(i, (R * Math.max(values[i], 0.2)) / 5).join(',')).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? '三维度评分雷达图'}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="#e2e8f0" strokeWidth="1" />
      ))}
      {[0, 1, 2].map((i) => {
        const [x, y] = pt(i, R)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth="1" />
      })}
      <polygon points={poly} fill={`${color}26`} stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {[0, 1, 2].map((i) => {
        const [x, y] = pt(i, (R * Math.max(values[i], 0.2)) / 5)
        return <circle key={i} cx={x} cy={y} r="2.5" fill={color} />
      })}
      {[0, 1, 2].map((i) => {
        const [x, y] = pt(i, R + 14)
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fill="#475569">
            {dims[i]}
          </text>
        )
      })}
      {[0, 1, 2].map((i) => {
        const [x, y] = pt(i, (R * Math.max(values[i], 0.2)) / 5)
        return (
          <text key={`v${i}`} x={x} y={y - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill={color} fontFamily="JetBrains Mono, monospace">
            {values[i] || '–'}
          </text>
        )
      })}
    </svg>
  )
}

// —— 阶段回退按钮组 ——
export function RollbackHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <RotateCcw className="size-3" />
      回退将记录原因并保留全部版本
    </span>
  )
}

export function SectionTitle({ en, zh, right }: { en: string; zh: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <div className="ui-label text-teal-700">{en}</div>
        <h2 className="mt-0.5 text-lg font-bold tracking-tight">{zh}</h2>
      </div>
      {right}
    </div>
  )
}

// —— 阶段数量趋势折线图(GL/PL 统计视图) ——
export function StageTrendChart({
  points, height = 240,
}: {
  points: { month: string; counts: Record<StageKey, number> }[]
  height?: number
}) {
  const W = 820
  const H = height
  const padL = 34
  const padR = 56
  const padT = 18
  const padB = 30
  const iw = W - padL - padR
  const ih = H - padT - padB

  const maxV = Math.max(1, ...points.flatMap((p) => STAGES.map((s) => p.counts[s.key])))
  const yMax = Math.ceil(maxV * 1.15)
  const x = (i: number) => padL + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const y = (v: number) => padT + ih - (v / yMax) * ih

  const yTicks = Array.from({ length: yMax + 1 }, (_, i) => i).filter((v) => yMax <= 6 || v % Math.ceil(yMax / 6) === 0)

  return (
    <div>
      {/* 图例 */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {STAGES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: STAGE_COLOR[s.key] }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="各阶段专利数量趋势">
        {/* 网格与 y 轴 */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#e9edf2" strokeWidth="1" />
            <text x={padL - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#94a3b8" fontFamily="JetBrains Mono, monospace">
              {v}
            </text>
          </g>
        ))}
        {/* x 轴月份 */}
        {points.map((p, i) => (
          <text
            key={p.month}
            x={x(i)}
            y={H - 10}
            textAnchor="middle"
            fontSize="10"
            fill="#94a3b8"
            fontFamily="JetBrains Mono, monospace"
          >
            {p.month.slice(2)}
          </text>
        ))}
        {/* 折线 */}
        {STAGES.map((s) => {
          const d = points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.counts[s.key]).toFixed(1)}`)
            .join(' ')
          const last = points[points.length - 1]
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={STAGE_COLOR[s.key]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p.counts[s.key])} r="3" fill="#fff" stroke={STAGE_COLOR[s.key]} strokeWidth="1.5">
                  <title>{`${s.label} · ${p.month}:${p.counts[s.key]} 件`}</title>
                </circle>
              ))}
              {/* 末端数值标签 */}
              <text
                x={W - padR + 8}
                y={y(last.counts[s.key])}
                dominantBaseline="middle"
                fontSize="11"
                fontWeight="700"
                fill={STAGE_COLOR[s.key]}
                fontFamily="JetBrains Mono, monospace"
              >
                {last.counts[s.key]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export { Clock }
