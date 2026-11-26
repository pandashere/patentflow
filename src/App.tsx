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

function Shell() {
  const { loggedIn, prefs } = useStore()
  // 个人偏好(U6):默认着陆页
  const [page, setPage] = useState<Page>(() => ({ name: prefs.homePage }) as Page)

  if (!loggedIn) return <Login />

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
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
