import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { InvoiceCheck, Order } from '../lib/types'
import { dealLabel, errorText, jpDate, todayJst, yen } from '../lib/format'
import { writeCsv } from '../lib/csv'

const HEADERS = ['取引先コード', '取引先名', '区分', '発注書の枚数', '発注合計（税抜）', '消費税', '発注合計（税込）', '請求額（税込）', '差額', 'チェック', 'メモ']

interface Row {
  supplierId: string
  name: string
  code: string
  deal: string
  orders: Order[]
  subtotal: number
  tax: number
  total: number
}

/** 月締めの請求書チェック：取引先ごとに、その月の発注の合計と請求額を並べる */
export default function MonthlyPage() {
  const { stores, suppliers, profile, toast } = useApp()
  const [month, setMonth] = useState(() => todayJst().slice(0, 7))
  const [store, setStore] = useState('')
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [checks, setChecks] = useState<Record<string, InvoiceCheck>>({})
  const [edit, setEdit] = useState<Record<string, { amount: string; note: string }>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')
  const first = `${month}-01`

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    let qb = supabase.from('orders').select('*')
      .not('saved_at', 'is', null).neq('status', 'cancelled')
      .gte('order_date', first).lt('order_date', next).order('order_date')
    if (store) qb = qb.eq('store_id', store)
    setOrders(null)
    Promise.all([qb, supabase.from('invoice_checks').select('*').eq('month', first)]).then(([o, c]) => {
      setOrders((o.data ?? []) as Order[])
      setChecks(Object.fromEntries(((c.data ?? []) as InvoiceCheck[]).map(x => [x.supplier_id, x])))
      setEdit({})
    })
  }, [month, store, first])

  const rows = useMemo<Row[]>(() => {
    const g = new Map<string, Row>()
    for (const o of orders ?? []) {
      const s = suppliers.find(x => x.id === o.supplier_id)
      const r = g.get(o.supplier_id) ?? {
        supplierId: o.supplier_id, name: s?.name ?? o.supplier_snapshot.name, code: s?.code ?? '',
        deal: s ? dealLabel[s.deal_type] : '', orders: [], subtotal: 0, tax: 0, total: 0,
      }
      r.orders.push(o); r.subtotal += o.subtotal; r.tax += o.tax; r.total += o.total
      g.set(o.supplier_id, r)
    }
    return [...g.values()].sort((a, b) => a.code.localeCompare(b.code, 'ja', { numeric: true }) || a.name.localeCompare(b.name, 'ja'))
  }, [orders, suppliers])

  const amountOf = (id: string) => {
    const e = edit[id]
    if (e) return e.amount === '' ? null : Number(e.amount.replace(/[,¥円\s]/g, ''))
    return checks[id]?.invoice_amount ?? null
  }

  async function save(id: string, patch: Partial<InvoiceCheck>) {
    setError('')
    const cur = checks[id]
    const row = {
      supplier_id: id, month: first,
      invoice_amount: 'invoice_amount' in patch ? patch.invoice_amount : cur?.invoice_amount ?? null,
      checked: patch.checked ?? cur?.checked ?? false,
      note: patch.note ?? cur?.note ?? '',
      updated_by: profile.id, updated_at: new Date().toISOString(),
    }
    if (row.invoice_amount != null && (!Number.isFinite(row.invoice_amount) || row.invoice_amount < 0)) { setError('請求額は数字で入れてください'); return }
    const { error } = await supabase.from('invoice_checks').upsert(row, { onConflict: 'supplier_id,month' })
    if (error) { setError(errorText(error)); return }
    setChecks(c => ({ ...c, [id]: row as InvoiceCheck }))
    setEdit(e => { const n = { ...e }; delete n[id]; return n })
  }

  function saveEdit(id: string) {
    const e = edit[id]
    if (!e) return
    void save(id, { invoice_amount: amountOf(id), note: e.note })
  }

  const totals = rows.reduce((a, r) => ({ subtotal: a.subtotal + r.subtotal, tax: a.tax + r.tax, total: a.total + r.total }), { subtotal: 0, tax: 0, total: 0 })
  const done = rows.filter(r => checks[r.supplierId]?.checked).length

  function exportCsv() {
    writeCsv(rows.map(r => {
      const amt = checks[r.supplierId]?.invoice_amount ?? null
      return {
        取引先コード: r.code, 取引先名: r.name, 区分: r.deal, 発注書の枚数: r.orders.length,
        '発注合計（税抜）': r.subtotal, 消費税: r.tax, '発注合計（税込）': r.total,
        '請求額（税込）': amt ?? '', 差額: amt == null ? '' : amt - r.total,
        チェック: checks[r.supplierId]?.checked ? '済' : '', メモ: checks[r.supplierId]?.note ?? '',
      }
    }), HEADERS, `月の一覧_${month}.csv`)
    toast('CSV を書き出しました')
  }

  return (
    <section className="panel monthly-page">
      <div className="panel-head"><h2>月の一覧（請求書チェック）</h2>
        {orders && <span className="muted small">{rows.length}社　チェック済み {done}社　発注合計（税込） {yen(totals.total)}</span>}</div>
      <div className="note no-print">その月に送った（または下書き保存した）発注書を、取引先ごとに合計します。届いた請求書の金額（税込）を入れると、差額が出ます。合っていたら「チェック」を入れてください。取消した発注書は入りません。</div>
      <div className="toolbar no-print">
        <input type="month" aria-label="月" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        <select aria-label="店舗" value={store} onChange={e => setStore(e.target.value)}>
          <option value="">すべての店舗</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>CSV 書き出し</button>
        <button className="btn" onClick={() => window.print()} disabled={!rows.length}>印刷</button>
      </div>
      <h3 className="print-only">{month.replace('-', '年')}月　発注の一覧{store && `（${stores.find(s => s.id === store)?.name}）`}</h3>
      {error && <p className="msg">{error}</p>}
      <div className="tbl-wrap">
        <table className="list monthly">
          <thead><tr><th>取引先</th><th className="num">枚数</th><th className="num">発注（税抜）</th><th className="num">消費税</th><th className="num">発注（税込）</th><th className="num">請求額（税込）</th><th className="num">差額</th><th>チェック</th><th>メモ</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const amt = amountOf(r.supplierId)
              const diff = amt == null || !Number.isFinite(amt) ? null : amt - r.total
              const c = checks[r.supplierId]
              const e = edit[r.supplierId]
              const setE = (k: 'amount' | 'note', v: string) => setEdit(x => ({ ...x, [r.supplierId]: {
                amount: x[r.supplierId]?.amount ?? (c?.invoice_amount?.toString() ?? ''), note: x[r.supplierId]?.note ?? (c?.note ?? ''), [k]: v } }))
              return (
                <Fragment key={r.supplierId}>
                  <tr className={c?.checked ? 'picked' : undefined}>
                    <td><button className="link" onClick={() => setOpen(open === r.supplierId ? null : r.supplierId)} aria-expanded={open === r.supplierId}>{open === r.supplierId ? '▾' : '▸'} {r.name}</button>
                      {r.deal && <span className="chip">{r.deal}</span>}</td>
                    <td className="num">{r.orders.length}</td>
                    <td className="num">{yen(r.subtotal)}</td>
                    <td className="num">{yen(r.tax)}</td>
                    <td className="num"><b>{yen(r.total)}</b></td>
                    <td className="num"><input className="amount" inputMode="numeric" aria-label={`${r.name}の請求額`} placeholder="請求額"
                      value={e ? e.amount : (c?.invoice_amount?.toString() ?? '')}
                      onChange={ev => setE('amount', ev.target.value)} onBlur={() => saveEdit(r.supplierId)} /></td>
                    <td className={diff ? 'num warn' : 'num'}>{diff == null ? '—' : diff === 0 ? '0（一致）' : (diff > 0 ? '+' : '') + diff.toLocaleString('ja-JP')}</td>
                    <td><label className="check"><input type="checkbox" checked={!!c?.checked} onChange={ev => save(r.supplierId, { checked: ev.target.checked })} />済</label></td>
                    <td><input aria-label={`${r.name}のメモ`} placeholder="例 3/5 分は納品なし"
                      value={e ? e.note : (c?.note ?? '')} onChange={ev => setE('note', ev.target.value)} onBlur={() => saveEdit(r.supplierId)} /></td>
                  </tr>
                  {open === r.supplierId && (
                    <tr className="sub-rows"><td colSpan={9}>
                      <table className="list inner"><tbody>
                        {r.orders.map(o => (
                          <tr key={o.id}><td><a href={'#/sheets/' + o.id}>{o.order_no}</a></td><td>{jpDate(o.order_date)}</td>
                            <td className="num">{yen(o.subtotal)}</td><td className="num">{yen(o.tax)}</td><td className="num">{yen(o.total)}</td></tr>
                        ))}
                      </tbody></table>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
            {orders && rows.length === 0 && <tr><td colSpan={9} className="muted">この月の発注はありません。</td></tr>}
            {!orders && <tr><td colSpan={9} className="muted">読み込み中…</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr><th>合計</th><th className="num">{rows.reduce((a, r) => a + r.orders.length, 0)}</th>
            <th className="num">{yen(totals.subtotal)}</th><th className="num">{yen(totals.tax)}</th><th className="num">{yen(totals.total)}</th><th colSpan={4} /></tr></tfoot>}
        </table>
      </div>
    </section>
  )
}
