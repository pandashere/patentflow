import { useState } from 'react'
import { StoreProvider, useStore } from '@/lib/store'
import { AppShell, type Page } from '@/components/AppShell'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import PatentList from '@/pages/PatentList'
import PatentDetail from '@/pages/PatentDetail'
import Kpi from '@/pages/Kpi'
import Admin from '@/pages/Admin'

function Shell() {
  const { loggedIn } = useStore()
  const [page, setPage] = useState<Page>({ name: 'dashboard' })

  if (!loggedIn) return <Login />

  return (
    <AppShell page={page} navigate={setPage}>
      {page.name === 'dashboard' && <Dashboard navigate={setPage} />}
      {page.name === 'patents' && <PatentList navigate={setPage} />}
      {page.name === 'patent' && <PatentDetail id={page.id} navigate={setPage} />}
      {page.name === 'kpi' && <Kpi />}
      {page.name === 'admin' && <Admin />}
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
