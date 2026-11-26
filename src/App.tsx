import { useState } from 'react'
import { StoreProvider, useStore } from '@/lib/store'
import { AppShell, type Page } from '@/components/AppShell'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import PatentList from '@/pages/PatentList'
import PatentDetail from '@/pages/PatentDetail'
import Kpi from '@/pages/Kpi'
import Admin from '@/pages/Admin'
import Profile from '@/pages/Profile'
import SysAdmin from '@/pages/SysAdmin'

const isResetLinkAtLoad = /\/reset\/?$/.test(window.location.pathname) && new URLSearchParams(window.location.search).has('token')

function Shell() {
  // 重置 / 激活链接优先进入设置新密码;设置完成或关闭对话框后退出该模式,正常进入系统
  const [resetMode, setResetMode] = useState(isResetLinkAtLoad)
  const { loggedIn, prefs, ready, me } = useStore()
  // 个人偏好(U6):默认着陆页;切换账号时回到该账号的着陆页
  const [page, setPage] = useState<Page>({ name: 'dashboard' })
  const [landedFor, setLandedFor] = useState('')
  if (loggedIn && landedFor !== me.id) {
    setLandedFor(me.id)
    setPage({ name: prefs.homePage } as Page)
  }

  if (!ready) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">加载中…</div>
  // 重置 / 激活链接优先:即使浏览器里已有登录会话,也进入设置新密码
  if (!loggedIn || resetMode) return <Login onResetDone={() => setResetMode(false)} />

  return (
    <AppShell page={page} navigate={setPage}>
      {page.name === 'dashboard' && <Dashboard navigate={setPage} />}
      {page.name === 'patents' && <PatentList key={page.stage ?? 'all'} navigate={setPage} initialStage={page.stage} />}
      {page.name === 'patent' && <PatentDetail id={page.id} navigate={setPage} />}
      {page.name === 'kpi' && <Kpi />}
      {page.name === 'admin' && <Admin />}
      {page.name === 'profile' && <Profile />}
    </AppShell>
  )
}

export default function App() {
  // 系统管理员后台独立于业务系统(不加载业务数据)
  if (window.location.pathname.replace(/\/+$/, '').endsWith('/sysadmin')) return <SysAdmin />
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
