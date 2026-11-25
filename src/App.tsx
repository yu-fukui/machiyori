import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { AppContext, type AppData, useRoute } from './lib/app'
import type { Profile, Settings, Store, Supplier } from './lib/types'
import LoginPage from './pages/LoginPage'
import OrderPage from './pages/OrderPage'
import SheetsPage from './pages/SheetsPage'
import HistoryPage from './pages/HistoryPage'
import MonthlyPage from './pages/MonthlyPage'
import ItemsPage from './pages/ItemsPage'
import SuppliersPage from './pages/SuppliersPage'
import StoresPage from './pages/StoresPage'
import StaffPage from './pages/StaffPage'
import SettingsPage from './pages/SettingsPage'
import FinancePage from './pages/FinancePage'
import Icon, { type IconName } from './components/Icon'

const NAV: { path: string; label: string; icon: IconName; admin?: boolean }[] = [
  { path: 'order', label: '発注', icon: 'order' },
  { path: 'history', label: '履歴', icon: 'history' },
  { path: 'monthly', label: '月の一覧', icon: 'monthly' },
  { path: 'finance', label: '売上・経費', icon: 'finance', admin: true },
  { path: 'items', label: '商品', icon: 'items' },
  { path: 'suppliers', label: '取引先', icon: 'suppliers' },
  { path: 'stores', label: '店舗', icon: 'stores', admin: true },
  { path: 'staff', label: 'スタッフ', icon: 'staff', admin: true },
  { path: 'settings', label: '設定', icon: 'settings', admin: true },
]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [settings, setSettings] = useState<Settings>({
    fax_gateway: '', tax_round: 'floor', reply_to: '', drive_folder_id: '',
    company_name: '', company_zip: '', company_address: '', company_tel: '', company_fax: '', company_person: '', payment_terms: '',
  })
  const [toastMsg, setToastMsg] = useState('')
  const route = useRoute()

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const reload = useCallback(async () => {
    const uid = session?.user.id
    if (!uid) return
    const p = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(p.data as Profile | null)
    if (!p.data || p.data.role === 'pending') return
    const [st, su, se] = await Promise.all([
      supabase.from('stores').select('*').order('sort').order('code'),
      supabase.from('suppliers').select('*').order('code'),
      supabase.from('settings').select('*').eq('id', 1).single(),
    ])
    setStores((st.data ?? []) as Store[])
    // 取引先はコード順（1, 2, …, 10, 11, …, 101。数字として並べる）
    setSuppliers(((su.data ?? []) as Supplier[]).sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'ja', { numeric: true })))
    if (se.data) setSettings(se.data as Settings)
  }, [session?.user.id])

  useEffect(() => { reload() }, [reload])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(m => (m === msg ? '' : m)), 4000)
  }, [])

  if (!configured) {
    return <main className="center"><div className="panel narrow">
      <h1>設定が必要です</h1>
      <p><code>.env.local</code>（Vercel では環境変数）に <code>VITE_SUPABASE_URL</code> と <code>VITE_SUPABASE_ANON_KEY</code> を入れてください。くわしくは README を見てください。</p>
    </div></main>
  }
  if (session === undefined) return <main className="center muted">読み込み中…</main>
  if (!session) return <LoginPage />
  if (!profile) return <main className="center muted">読み込み中…</main>
  if (profile.role === 'pending') {
    return <main className="center"><div className="panel narrow">
      <h1>このアカウントはいま使えません</h1>
      <p>管理者に「スタッフ」画面で権限を「スタッフ」にしてもらうと使えるようになります。</p>
      <div className="row">
        <button className="btn" onClick={reload}>もう一度確かめる</button>
        <button className="btn" onClick={() => supabase.auth.signOut()}>ログアウト</button>
      </div>
    </div></main>
  }

  const isAdmin = profile.role === 'admin'
  const data: AppData = { profile, stores, suppliers, settings, isAdmin, reload, toast }
  const page = route[0] || 'order'
  const allowed = NAV.find(n => n.path === page)?.admin ? isAdmin : true

  return (
    <AppContext.Provider value={data}>
      <header className="top no-print">
        <a className="brand" href="#/order"><span className="brand-mark" aria-hidden="true">ま</span>まちより 発注</a>
        <nav aria-label="メニュー">
          {NAV.filter(n => !n.admin || isAdmin).map(n => (
            <a key={n.path} href={'#/' + n.path} aria-current={page === n.path || (page === 'sheets' && n.path === 'history') ? 'page' : undefined}>
              <Icon name={n.icon} />{n.label}</a>
          ))}
        </nav>
        <span className="who"><span className="avatar" aria-hidden="true">{(profile.name || profile.email || '?').slice(0, 1)}</span>
          <span className="who-name">{profile.name || profile.email}</span></span>
        <button className="btn small quiet" onClick={() => supabase.auth.signOut()}><Icon name="logout" />ログアウト</button>
      </header>
      <main className="page">
        {!allowed ? <p className="muted">この画面は管理者だけが使えます。</p>
          : page === 'order' ? <OrderPage />
          : page === 'sheets' ? <SheetsPage ids={(route[1] ?? '').split(',').filter(Boolean)} />
          : page === 'history' ? <HistoryPage />
          : page === 'monthly' ? <MonthlyPage />
          : page === 'finance' ? <FinancePage />
          : page === 'items' ? <ItemsPage />
          : page === 'suppliers' ? <SuppliersPage />
          : page === 'stores' ? <StoresPage />
          : page === 'staff' ? <StaffPage />
          : page === 'settings' ? <SettingsPage />
          : <p className="muted">ページが見つかりません。</p>}
      </main>
      {toastMsg && <div className="toast no-print" role="status">{toastMsg}</div>}
    </AppContext.Provider>
  )
}
