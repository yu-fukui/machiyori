import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { go, useApp } from '../lib/app'
import type { Order } from '../lib/types'
import { jpDate, jpDateTime, statusLabel, viaLabel, yen } from '../lib/format'

export default function HistoryPage() {
  const { stores, suppliers } = useApp()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [store, setStore] = useState('')
  const [sup, setSup] = useState('')
  const [status, setStatus] = useState('')
  const [month, setMonth] = useState('')

  useEffect(() => {
    let qb = supabase.from('orders').select('*, orderer:profiles!orders_created_by_fkey(name, email)')
      .not('saved_at', 'is', null)   // 作っただけの発注書は出さない
      .order('created_at', { ascending: false }).limit(300)
    if (store) qb = qb.eq('store_id', store)
    if (sup) qb = qb.eq('supplier_id', sup)
    if (status) qb = qb.eq('status', status)
    if (month) {
      const [y, m] = month.split('-').map(Number)
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
      qb = qb.gte('order_date', `${month}-01`).lt('order_date', next)
    }
    setOrders(null)
    qb.then(({ data }) => setOrders((data ?? []) as Order[]))
  }, [store, sup, status, month])

  const storeName = (id: string) => stores.find(s => s.id === id)?.name ?? ''
  const total = (orders ?? []).filter(o => o.status !== 'cancelled').reduce((a, o) => a + o.total, 0)

  return (
    <section className="panel">
      <div className="panel-head"><h2>発注履歴</h2>
        {orders && <span className="muted small">{orders.length}件　取消を除く合計 {yen(total)}</span>}</div>
      <div className="toolbar">
        <select aria-label="店舗" value={store} onChange={e => setStore(e.target.value)}>
          <option value="">すべての店舗</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select aria-label="取引先" value={sup} onChange={e => setSup(e.target.value)}>
          <option value="">すべての取引先</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select aria-label="状態" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">すべての状態</option><option value="draft">下書き</option><option value="sent">送信済み</option><option value="cancelled">取消</option>
        </select>
        <input type="month" aria-label="発注月" value={month} onChange={e => setMonth(e.target.value)} />
      </div>
      <div className="tbl-wrap">
        <table className="list">
          <thead><tr><th>発注番号</th><th>発注日</th><th>店舗</th><th>発注者</th><th>取引先</th><th className="num">合計(税込)</th><th>状態</th><th>送信</th></tr></thead>
          <tbody>
            {orders?.map(o => (
              <tr key={o.id} className="clickable" onClick={() => go('sheets/' + o.id)}>
                <td><a href={'#/sheets/' + o.id}>{o.order_no}</a></td>
                <td>{jpDate(o.order_date)}</td>
                <td>{storeName(o.store_id) || o.store_snapshot.name}</td>
                <td>{o.orderer?.name || o.orderer?.email || '—'}</td>
                <td>{o.supplier_snapshot.name}</td>
                <td className="num">{yen(o.total)}</td>
                <td><span className={`chip status-${o.status}`}>{statusLabel[o.status]}</span></td>
                <td className="sub">{o.sent_via ? `${viaLabel[o.sent_via]} ${jpDateTime(o.sent_at)}` : ''}</td>
              </tr>
            ))}
            {orders?.length === 0 && <tr><td colSpan={8} className="muted">該当する発注はありません。</td></tr>}
            {!orders && <tr><td colSpan={8} className="muted">読み込み中…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
