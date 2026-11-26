import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PERSONAS, useStore } from '@/lib/store'
import { NOTIFY_EVENT_LABEL } from '@/lib/types'
import {
  Bell, ChevronsUpDown, FileText, Gauge, LogOut, ShieldCheck, SquarePen,
} from 'lucide-react'

export type Page =
  | { name: 'dashboard' }
  | { name: 'patents' }
  | { name: 'patent'; id: string }
  | { name: 'kpi' }
  | { name: 'admin' }

interface NavItem {
  key: Page['name']
  label: string
  en: string
  icon: typeof FileText
  roles?: string[] // 限定可见角色
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: '仪表盘', en: 'DASHBOARD', icon: Gauge },
  { key: 'patents', label: '专利库', en: 'PATENTS', icon: FileText },
  { key: 'kpi', label: 'KPI 管理', en: 'KPI', icon: ShieldCheck },
  { key: 'admin', label: '租户管理', en: 'TENANCY', icon: SquarePen, roles: ['gl', 'pl'] },
]

export function AppShell({
  page, navigate, children,
}: {
  page: Page
  navigate: (p: Page) => void
  children: ReactNode
}) {
  const { me, persona, setPersona, notifications, markAllRead, setLoggedIn } = useStore()
  const [notifOpen, setNotifOpen] = useState(false)
  const [personaOpen, setPersonaOpen] = useState(false)
  const unread = notifications.filter((n) => !n.read).length

  return (
    <div className="flex min-h-dvh bg-background">
      {/* —— 深色侧边栏 —— */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col bg-[#12141f] text-[#aab1c5]">
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
          <div className="flex size-8 items-center justify-center rounded-md bg-teal-600">
            <SquarePen className="size-4 text-white" strokeWidth={2.2} />
          </div>
          <div>
            <div className="font-mono-x text-[13px] font-bold tracking-widest text-white">PATENTFLOW</div>
            <div className="text-[10px] tracking-[0.2em] text-[#6b7386]">专利状态跟踪</div>
          </div>
        </div>
        <div className="mx-5 border-t border-white/10" />
        <nav className="mt-4 flex-1 space-y-1 px-3">
          {NAV.filter((n) => !n.roles || n.roles.includes(me.role)).map((n) => {
            const active = page.name === n.key || (n.key === 'patents' && page.name === 'patent')
            return (
              <button
                key={n.key}
                type="button"
                onClick={() => navigate({ name: n.key } as Page)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  active ? 'bg-teal-600/15 text-white' : 'hover:bg-white/5 hover:text-white',
                )}
              >
                <n.icon className={cn('size-4', active && 'text-teal-400')} />
                <span className="flex-1">{n.label}</span>
                <span className={cn('font-mono-x text-[9px] tracking-widest', active ? 'text-teal-400' : 'text-[#565f75]')}>
                  {n.en}
                </span>
              </button>
            )
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="font-mono-x text-[10px] tracking-widest text-[#565f75]">INTRANET · v0.1 DEMO</div>
          <div className="mt-1 text-xs text-[#7c86a0]">数据仅保存在演示环境中</div>
        </div>
      </aside>

      {/* —— 主区域 —— */}
      <div className="ml-56 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-white/85 px-6 backdrop-blur-sm">
          <div className="min-w-0 flex-1" />

          {/* 通知铃铛 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setNotifOpen((v) => !v); setPersonaOpen(false) }}
              className="relative flex size-9 items-center justify-center rounded-md border text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              aria-label="通知"
            >
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 font-mono-x text-[9px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-[380px] rounded-lg border bg-white shadow-lg">
                  <div className="flex items-center justify-between border-b px-4 py-2.5">
                    <span className="ui-label text-slate-500">通知中心 · 回调事件流</span>
                    <button type="button" onClick={markAllRead} className="text-xs text-teal-700 hover:underline">
                      全部已读
                    </button>
                  </div>
                  <div className="scrollbar-thin max-h-80 overflow-y-auto">
                    {notifications.map((n) => (
                      <div key={n.id} className={cn('border-b px-4 py-3 last:border-0', !n.read && 'bg-teal-50/50')}>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'rounded px-1.5 py-px font-mono-x text-[10px] font-semibold',
                            n.event === 'review' && 'bg-teal-100 text-teal-800',
                            n.event === 'due' && 'bg-amber-100 text-amber-800',
                            n.event === 'transition' && 'bg-slate-100 text-slate-600',
                          )}>
                            {NOTIFY_EVENT_LABEL[n.event]}
                          </span>
                          <span className="ml-auto font-mono-x text-[10px] text-slate-400">{n.at}</span>
                        </div>
                        <p className="mt-1.5 text-[13px] leading-snug text-slate-700">{n.text}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t px-4 py-2 text-[11px] text-slate-400">
                    生产环境将通过 Webhook 回调推送 · 当前为接口占位
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 身份切换器(demo 用) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setPersonaOpen((v) => !v); setNotifOpen(false) }}
              className="flex items-center gap-2.5 rounded-md border py-1.5 pl-2 pr-2.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <span className="flex size-6 items-center justify-center rounded bg-[#12141f] font-mono-x text-[10px] font-bold text-teal-400">
                {persona.label.slice(0, 1)}
              </span>
              <span className="text-left leading-tight">
                <span className="block text-[13px] font-medium">{me.name}</span>
                <span className="block font-mono-x text-[9px] uppercase tracking-widest text-teal-700">
                  {persona.label}视角
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 text-slate-400" />
            </button>
            {personaOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPersonaOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border bg-white p-1.5 shadow-lg">
                  <div className="px-2.5 pb-1.5 pt-2 ui-label text-slate-400">切换身份视角</div>
                  {PERSONAS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => { setPersona(p.key); setPersonaOpen(false) }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                        persona.key === p.key && 'bg-teal-50',
                      )}
                    >
                      <span className={cn(
                        'flex size-7 items-center justify-center rounded font-mono-x text-[10px] font-bold',
                        persona.key === p.key ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500',
                      )}>
                        {p.label.slice(0, 1)}
                      </span>
                      <span>
                        <span className="block text-[13px] font-medium">{p.label}</span>
                        <span className="block text-[11px] text-slate-500">{p.desc}</span>
                      </span>
                    </button>
                  ))}
                  <div className="mt-1 border-t px-2.5 py-2 text-[11px] leading-snug text-slate-400">
                    不同身份看到的菜单、数据范围与可用操作会实时变化
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setLoggedIn(false)}
            className="flex size-9 items-center justify-center rounded-md border text-slate-500 transition-colors hover:bg-slate-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut className="size-4" />
          </button>
        </header>

        <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  )
}
