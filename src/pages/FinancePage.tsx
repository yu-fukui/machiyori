import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { errorText, todayJst, yen } from '../lib/format'
import { writeCsv } from '../lib/csv'
import Icon from '../components/Icon'

interface Category { id: string; name: string; sort: number; active: boolean }
interface Sale { store_id: string; month: string; amount: number; note: string }
interface Purchase { store_id: string; month: string; amount: number }
interface Expense { store_id: string; month: string; category_id: string; amount: number }
interface Month {
  m: number            // 1〜12
  key: string          // YYYY-MM-01
  sales: number | null // 入れていなければ null
  purchases: number    // 発注書の合計 ＋ 手入力の仕入れ
  ordered: number      // うち発注書の合計
  manual: number       // うち手入力の仕入れ
  expenses: number
  byCat: Record<string, number>
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—')
const toNum = (s: string) => {
  const t = s.replace(/[,¥円\s]/g, '')
  return t === '' ? null : Number(t)
}

/** 月ごとの売上（手入力）・仕入れ（発注書の合計 ＋ 手入力）・経費（手入力）を集計する */
export default function FinancePage() {
  const { stores, profile, toast } = useApp()
  const [year, setYear] = useState(() => Number(todayJst().slice(0, 4)))
  const [store, setStore] = useState('')
  const [cats, setCats] = useState<Category[]>([])
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [orders, setOrders] = useState<{ store_id: string; order_date: string; total: number }[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState('')
  const activeStores = stores.filter(s => s.active)

  const load = useCallback(async () => {
    const from = `${year}-01-01`, to = `${year + 1}-01-01`
    let qs = supabase.from('monthly_sales').select('*').gte('month', from).lt('month', to)
    let qp = supabase.from('monthly_purchases').select('store_id, month, amount').gte('month', from).lt('month', to)
    let qe = supabase.from('monthly_expenses').select('store_id, month, category_id, amount').gte('month', from).lt('month', to)
    let qo = supabase.from('orders').select('store_id, order_date, total')
      .not('saved_at', 'is', null).neq('status', 'cancelled').gte('order_date', from).lt('order_date', to)
    if (store) { qs = qs.eq('store_id', store); qp = qp.eq('store_id', store); qe = qe.eq('store_id', store); qo = qo.eq('store_id', store) }
    setSales(null)
    const [c, s, e, o, p] = await Promise.all([supabase.from('expense_categories').select('*').order('sort').order('name'), qs, qe, qo, qp])
    const err = c.error || s.error || e.error || o.error || p.error
    if (err) setError(errorText(err))
    setCats((c.data ?? []) as Category[])
    setSales((s.data ?? []) as Sale[])
    setExpenses((e.data ?? []) as Expense[])
    setPurchases((p.data ?? []) as Purchase[])
    setOrders((o.data ?? []) as { store_id: string; order_date: string; total: number }[])
  }, [year, store])
  useEffect(() => { load() }, [load])

  const months = useMemo<Month[]>(() => MONTHS.map(m => {
    const key = `${year}-${String(m).padStart(2, '0')}-01`
    const ss = (sales ?? []).filter(x => x.month === key)
    const ee = expenses.filter(x => x.month === key)
    const byCat: Record<string, number> = {}
    for (const x of ee) byCat[x.category_id] = (byCat[x.category_id] ?? 0) + x.amount
    const ordered = orders.filter(o => o.order_date.slice(0, 7) === key.slice(0, 7)).reduce((a, o) => a + o.total, 0)
    const manual = purchases.filter(x => x.month === key).reduce((a, x) => a + x.amount, 0)
    return {
      m, key,
      sales: ss.length ? ss.reduce((a, x) => a + x.amount, 0) : null,
      purchases: ordered + manual, ordered, manual,
      expenses: ee.reduce((a, x) => a + x.amount, 0),
      byCat,
    }
  }), [year, sales, expenses, orders, purchases])

  const total = months.reduce((a, x) => ({
    sales: a.sales + (x.sales ?? 0), purchases: a.purchases + x.purchases, expenses: a.expenses + x.expenses,
  }), { sales: 0, purchases: 0, expenses: 0 })
  const gross = total.sales - total.purchases
  const profit = gross - total.expenses
  const usedCats = cats.filter(c => c.active || expenses.some(e => e.category_id === c.id))

  function exportCsv() {
    const headers = ['月', '売上（税込）', '仕入れ（税込）', 'うち発注書', 'うち手入力', '粗利', '粗利率', ...usedCats.map(c => c.name), '経費合計', '利益', '利益率']
    writeCsv(months.map(x => {
      const s = x.sales ?? 0, g = s - x.purchases
      return {
        月: `${year}年${x.m}月`, '売上（税込）': x.sales ?? '', '仕入れ（税込）': x.purchases, うち発注書: x.ordered, うち手入力: x.manual, 粗利: g, 粗利率: pct(g, s),
        ...Object.fromEntries(usedCats.map(c => [c.name, x.byCat[c.id] ?? ''])), 経費合計: x.expenses, 利益: g - x.expenses, 利益率: pct(g - x.expenses, s),
      }
    }), headers, `売上・経費_${year}${store ? '_' + (stores.find(s => s.id === store)?.name ?? '') : ''}.csv`)
    toast('CSV を書き出しました')
  }

  return (
    <div>
      <div className="page-title">
        <h1>売上・経費</h1>
        <p>月ごとの売上・仕入れ・経費を入れると、粗利と利益を出します。仕入れは、発注書の合計に、手で入れた金額を足したものです。金額はすべて税込です。</p>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="年">
          <button className="btn small quiet" onClick={() => setYear(y => y - 1)} aria-label="前の年">‹</button>
          <strong className="year">{year}年</strong>
          <button className="btn small quiet" onClick={() => setYear(y => y + 1)} aria-label="次の年">›</button>
        </div>
        <select aria-label="店舗" value={store} onChange={e => { setStore(e.target.value); setEditing(null) }}>
          <option value="">すべての店舗</option>{activeStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="grow" />
        <button className="btn" onClick={exportCsv}><Icon name="download" />CSV 書き出し</button>
      </div>
      {error && <p className="msg">{error}</p>}

      <div className="kpis">
        <div className="kpi"><span>売上（{year}年）</span><b>{yen(total.sales)}</b><small>{months.filter(x => x.sales != null).length}か月分を入力ずみ</small></div>
        <div className="kpi"><span>仕入れ</span><b>{yen(total.purchases)}</b><small>売上の {pct(total.purchases, total.sales)}</small></div>
        <div className="kpi"><span>粗利（売上 − 仕入れ）</span><b>{yen(gross)}</b><small>粗利率 {pct(gross, total.sales)}</small></div>
        <div className="kpi"><span>経費</span><b>{yen(total.expenses)}</b><small>売上の {pct(total.expenses, total.sales)}</small></div>
        <div className={profit < 0 ? 'kpi bad' : 'kpi good'}><span>利益（粗利 − 経費）</span><b>{yen(profit)}</b><small>利益率 {pct(profit, total.sales)}</small></div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>月ごとの売上と利益</h2>
          <div className="legend small"><span><i className="key s1" />売上</span><span><i className="key s2" />利益</span></div></div>
        <BarChart months={months} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>月ごとの集計</h2><span className="muted small">月の「入力」で、売上・仕入れ・経費を入れます</span></div>
        <div className="tbl-wrap">
          <table className="list">
            <thead><tr><th>月</th><th className="num">売上</th><th className="num">仕入れ</th><th className="num">粗利</th><th className="num">粗利率</th><th className="num">経費</th><th className="num">利益</th><th className="num">利益率</th><th /></tr></thead>
            <tbody>
              {months.map(x => {
                const s = x.sales ?? 0, g = s - x.purchases, p = g - x.expenses
                return (
                  <tr key={x.m} className={editing === x.m ? 'picked' : undefined}>
                    <td><b>{x.m}月</b></td>
                    <td className="num">{x.sales == null ? <span className="muted">未入力</span> : yen(x.sales)}</td>
                    <td className="num">{yen(x.purchases)}</td>
                    <td className="num">{yen(g)}</td>
                    <td className="num sub">{pct(g, s)}</td>
                    <td className="num">{yen(x.expenses)}</td>
                    <td className={p < 0 ? 'num neg' : 'num'}><b>{yen(p)}</b></td>
                    <td className={p < 0 ? 'num sub neg' : 'num sub'}>{pct(p, s)}</td>
                    <td className="actions"><button className="btn small" onClick={() => setEditing(editing === x.m ? null : x.m)}>{editing === x.m ? '閉じる' : '入力'}</button></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr><th>合計</th><th className="num">{yen(total.sales)}</th><th className="num">{yen(total.purchases)}</th><th className="num">{yen(gross)}</th>
              <th className="num">{pct(gross, total.sales)}</th><th className="num">{yen(total.expenses)}</th><th className="num">{yen(profit)}</th><th className="num">{pct(profit, total.sales)}</th><th /></tr></tfoot>
          </table>
        </div>
        {editing != null && (
          <MonthEditor key={`${year}-${editing}-${store}`} year={year} month={editing} storeId={store || (activeStores.length === 1 ? activeStores[0].id : '')}
            stores={activeStores} cats={cats.filter(c => c.active)} sales={sales ?? []} expenses={expenses} purchases={purchases}
            orderTotals={orderTotals(orders, `${year}-${String(editing).padStart(2, '0')}`)}
            userId={profile.id} onSaved={async () => { await load(); toast(`${editing}月の売上・仕入れ・経費を保存しました`) }} onClose={() => setEditing(null)} />
        )}
      </section>

      <CategoryEditor cats={cats} onChanged={load} />
    </div>
  )
}

/** 月ごとの売上と利益の棒グラフ（利益がマイナスの月は線より下） */
function BarChart({ months }: { months: Month[] }) {
  const W = 760, H = 240, L = 64, R = 8, T = 12, B = 28
  const vals = months.flatMap(x => { const s = x.sales ?? 0; return [s, s - x.purchases - x.expenses] })
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals)
  const step = niceStep((max - min) / 4)
  const top = Math.ceil(max / step) * step, bottom = Math.floor(min / step) * step
  const y = (v: number) => T + ((top - v) / (top - bottom || 1)) * (H - T - B)
  const slot = (W - L - R) / 12, bw = Math.min(18, slot / 3)
  const ticks: number[] = []
  for (let v = bottom; v <= top + 1e-6; v += step) ticks.push(v)
  const bar = (v: number, x: number, cls: string, label: string) => {
    const y0 = y(0), y1 = y(v), h = Math.max(Math.abs(y1 - y0), v === 0 ? 0 : 1)
    return <g className={`bar ${cls}`}><rect x={x} y={Math.min(y0, y1)} width={bw} height={h} rx={3} /><title>{label}</title>
      <rect className="hit" x={x - 3} y={T} width={bw + 6} height={H - T - B} /></g>
  }
  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="月ごとの売上と利益の棒グラフ。数字は下の表にあります">
        {ticks.map(v => <g key={v}><line className={v === 0 ? 'axis' : 'grid'} x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text className="tick" x={L - 8} y={y(v) + 4} textAnchor="end">{short(v)}</text></g>)}
        {months.map((x, i) => {
          const cx = L + slot * i + slot / 2, s = x.sales ?? 0, p = s - x.purchases - x.expenses
          return <g key={x.m}>
            {bar(s, cx - bw - 1, 's1', `${x.m}月 売上 ${yen(s)}`)}
            {bar(p, cx + 1, 's2', `${x.m}月 利益 ${yen(p)}`)}
            <text className="tick" x={cx} y={H - 8} textAnchor="middle">{x.m}月</text>
          </g>
        })}
      </svg>
    </div>
  )
}
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}
function short(v: number) {
  const a = Math.abs(v)
  return a >= 1e8 ? `${v / 1e8}億` : a >= 1e4 ? `${Math.round(v / 1e3) / 10}万` : `${v}`
}

/** 1か月分の売上と経費を入れる */
function MonthEditor({ year, month, storeId, stores, cats, sales, expenses, purchases, orderTotals, userId, onSaved, onClose }: {
  year: number; month: number; storeId: string; stores: { id: string; name: string }[]; cats: Category[]
  sales: Sale[]; expenses: Expense[]; purchases: Purchase[]; orderTotals: Record<string, number>; userId: string
  onSaved: () => Promise<void>; onClose: () => void
}) {
  const key = `${year}-${String(month).padStart(2, '0')}-01`
  const [sid, setSid] = useState(storeId)
  const cur = (id: string) => ({
    sale: sales.find(s => s.store_id === id && s.month === key),
    buy: purchases.find(p => p.store_id === id && p.month === key),
    exp: Object.fromEntries(expenses.filter(e => e.store_id === id && e.month === key).map(e => [e.category_id, e.amount])),
  })
  const init = (id: string) => {
    const c = cur(id)
    return { sale: c.sale ? String(c.sale.amount) : '', buy: c.buy ? String(c.buy.amount) : '', note: c.sale?.note ?? '', exp: Object.fromEntries(cats.map(k => [k.id, c.exp[k.id] != null ? String(c.exp[k.id]) : ''])) }
  }
  const [form, setForm] = useState(() => init(storeId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const saleN = toNum(form.sale)
  const buyN = toNum(form.buy)
  const ordered = orderTotals[sid] ?? 0
  const buyTotal = ordered + (buyN ?? 0)
  const expN = cats.reduce((a, c) => a + (toNum(form.exp[c.id] ?? '') ?? 0), 0)

  async function save() {
    if (!sid) { setError('店舗を選んでください'); return }
    const bad = [form.sale, form.buy, ...Object.values(form.exp)].some(v => { const n = toNum(v); return n != null && (!Number.isFinite(n) || n < 0) })
    if (bad) { setError('金額は 0 以上の数字で入れてください'); return }
    setBusy(true); setError('')
    try {
      const now = new Date().toISOString()
      if (saleN == null) {
        const r = await supabase.from('monthly_sales').delete().eq('store_id', sid).eq('month', key); if (r.error) throw r.error
      } else {
        const r = await supabase.from('monthly_sales').upsert({ store_id: sid, month: key, amount: Math.round(saleN), note: form.note, updated_by: userId, updated_at: now }, { onConflict: 'store_id,month' })
        if (r.error) throw r.error
      }
      if (buyN == null) {
        const r = await supabase.from('monthly_purchases').delete().eq('store_id', sid).eq('month', key); if (r.error) throw r.error
      } else {
        const r = await supabase.from('monthly_purchases').upsert({ store_id: sid, month: key, amount: Math.round(buyN), updated_by: userId, updated_at: now }, { onConflict: 'store_id,month' })
        if (r.error) throw r.error
      }
      const put = cats.filter(c => toNum(form.exp[c.id] ?? '') != null)
        .map(c => ({ store_id: sid, month: key, category_id: c.id, amount: Math.round(toNum(form.exp[c.id])!), updated_by: userId, updated_at: now }))
      const del = cats.filter(c => toNum(form.exp[c.id] ?? '') == null).map(c => c.id)
      if (put.length) { const r = await supabase.from('monthly_expenses').upsert(put, { onConflict: 'store_id,month,category_id' }); if (r.error) throw r.error }
      if (del.length) { const r = await supabase.from('monthly_expenses').delete().eq('store_id', sid).eq('month', key).in('category_id', del); if (r.error) throw r.error }
      await onSaved()
      onClose()
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="edit-form month-editor">
      <h3>{year}年{month}月の売上・仕入れ・経費</h3>
      {stores.length > 1 && (
        <div className="field"><label htmlFor="fin-store">店舗</label>
          <select id="fin-store" value={sid} onChange={e => { setSid(e.target.value); setForm(init(e.target.value)) }}>
            <option value="">選んでください</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
      )}
      <div className="form-grid">
        <div className="field"><label htmlFor="fin-sale">売上（税込・円）</label>
          <input id="fin-sale" inputMode="numeric" placeholder="例 1,250,000" value={form.sale} onChange={e => setForm(f => ({ ...f, sale: e.target.value }))} /></div>
        <div className="field"><label htmlFor="fin-buy">仕入れ（税込・円）</label>
          <input id="fin-buy" inputMode="numeric" placeholder="例 800,000" value={form.buy} onChange={e => setForm(f => ({ ...f, buy: e.target.value }))} />
          <small className="muted">発注書の分（{yen(ordered)}）は自動で足します。それ以外の仕入れを入れてください</small></div>
        <div className="field"><label htmlFor="fin-note">メモ</label>
          <input id="fin-note" placeholder="例 イベントあり" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
      </div>
      <p className="sub">経費（税込・円）。かからなかった項目は空のままでかまいません。</p>
      <div className="form-grid">
        {cats.map(c => (
          <div className="field" key={c.id}><label htmlFor={`fin-${c.id}`}>{c.name}</label>
            <input id={`fin-${c.id}`} inputMode="numeric" value={form.exp[c.id] ?? ''} onChange={e => setForm(f => ({ ...f, exp: { ...f.exp, [c.id]: e.target.value } }))} /></div>
        ))}
      </div>
      <div className="month-sum">
        <span>売上 <b>{yen(saleN ?? 0)}</b></span><span>− 仕入れ <b>{yen(buyTotal)}</b></span><span>− 経費 <b>{yen(expN)}</b></span>
        <span>＝ 利益 <b className={(saleN ?? 0) - buyTotal - expN < 0 ? 'neg' : ''}>{yen((saleN ?? 0) - buyTotal - expN)}</b></span>
      </div>
      {error && <p className="msg">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存する'}</button>
        <button className="btn" disabled={busy} onClick={onClose}>やめる</button>
      </div>
    </div>
  )
}

/** 店舗ごとの、その月の発注書の合計 */
function orderTotals(orders: { store_id: string; order_date: string; total: number }[], ym: string) {
  const t: Record<string, number> = {}
  for (const o of orders) if (o.order_date.slice(0, 7) === ym) t[o.store_id] = (t[o.store_id] ?? 0) + o.total
  return t
}

/** 経費の項目を足す・使わなくする */
function CategoryEditor({ cats, onChanged }: { cats: Category[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  async function add() {
    const n = name.trim()
    if (!n) return
    setError('')
    const { error } = await supabase.from('expense_categories').insert({ name: n, sort: Math.max(0, ...cats.map(c => c.sort)) + 10 })
    if (error) { setError(error.code === '23505' ? 'その項目はもうあります' : errorText(error)); return }
    setName(''); await onChanged()
  }
  async function toggle(c: Category) {
    const { error } = await supabase.from('expense_categories').update({ active: !c.active }).eq('id', c.id)
    if (error) { setError(errorText(error)); return }
    await onChanged()
  }
  return (
    <details className="panel cat-editor">
      <summary><b>経費の項目</b> <span className="muted small">（{cats.filter(c => c.active).length}項目。足したり、使わなくしたりできます）</span></summary>
      <div className="chips">
        {cats.map(c => <button key={c.id} className={c.active ? 'chip on' : 'chip'} onClick={() => toggle(c)}
          title={c.active ? '押すと使わなくします（入れた金額は残ります）' : '押すと使うようにします'}>{c.name}{c.active ? '' : '（使わない）'}</button>)}
      </div>
      <div className="row">
        <input aria-label="新しい経費の項目" placeholder="例 リース料" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <button className="btn" onClick={add} disabled={!name.trim()}><Icon name="plus" />項目を足す</button>
      </div>
      {error && <p className="msg">{error}</p>}
    </details>
  )
}
