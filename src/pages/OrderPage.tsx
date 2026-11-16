import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { go, useApp } from '../lib/app'
import type { DeliveryPlace, DeliveryType, Item } from '../lib/types'
import { deliveryLabel, errorText, kindLabel, methodLabel, periodText, readLocal, todayJst, writeLocal, yen } from '../lib/format'
import { readCsv } from '../lib/csv'

const CART_KEY = 'machiyori.cart'
const STORE_KEY = 'machiyori.store'
const SORT_KEY = 'machiyori.sort'

/** Airレジの在庫 CSV の列の名前（どれか1つあればよい） */
const STOCK_ID_COLS = ['商品ID', '商品コード', '品番', 'バーコード', 'JANコード', 'JAN']
const STOCK_QTY_COLS = ['在庫数', '現在庫数', '現在在庫数', '在庫数量', '在庫']
interface StockData { storeId: string; at: string; file: string; by: string; qty: Record<string, number> }   // qty：商品の id → 在庫数

/** 在庫 CSV は週に1回読み込む。これより古いと「古い」として、発注の前に確かめてもらう */
const STOCK_STALE_DAYS = 7
/** Airレジの CSV のファイル名にある書き出しの日時（例 …_20261116135848.csv）。なければ null */
function exportedAt(file: string): Date | null {
  const m = file.match(/(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`)
  return Number.isNaN(d.getTime()) ? null : d
}
const stockDate = (d: Date) => d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
/** 在庫がどれだけ前のものか。データの日時は、ファイル名の書き出し日時（なければ読み込んだ日時） */
function stockAge(s: StockData) {
  const imported = new Date(s.at)
  const data = exportedAt(s.file) ?? imported
  const days = Math.floor((Date.now() - data.getTime()) / 86400000)
  return { data, imported, days, stale: days >= STOCK_STALE_DAYS }
}
/** データベースから、その店舗のいちばん新しい在庫を読む（読み込んだことがなければ null） */
async function fetchStock(storeId: string): Promise<StockData | null> {
  const { data: imp, error } = await supabase.from('stock_imports').select('file_name, imported_at, profiles(name)')
    .eq('store_id', storeId).order('imported_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!imp) return null
  const qty: Record<string, number> = {}
  // 一度に返る行の数に上限があるので、1000 行ずつ読む
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('stock_levels').select('item_id, qty')
      .eq('store_id', storeId).order('item_id').range(from, from + 999)
    if (error) throw error
    for (const r of data ?? []) qty[r.item_id as string] = r.qty as number
    if (!data || data.length < 1000) break
  }
  const by = (imp.profiles as unknown as { name: string } | null)?.name ?? ''
  return { storeId, at: imp.imported_at as string, file: imp.file_name as string, by, qty }
}
/** 発注書を作ったときの入力の控え。発注書の画面で「保存しない」を選んだら、これを発注画面に戻す */
export const LAST_KEY = 'machiyori.last'
/** 発注画面に戻す入力（発注書の画面が書き、発注画面が一度だけ読む） */
export const RESTORE_KEY = 'machiyori.restore'

export interface OrderForm {
  ids?: string[]
  storeId: string
  cart: Record<string, number>
  delivery: { type: DeliveryType; storeId: string; placeId: string }
  due: string
  time: string
  remarks: string
}

type SortKey = 'times' | 'short' | 'code' | 'name'
const SORT_LABEL: Record<SortKey, string> = { times: '発注の多い順', short: '在庫の足りない順', code: '品番（Airレジ）', name: '品名' }

function loadCart(): Record<string, number> {
  try { return JSON.parse(readLocal(CART_KEY) || '{}') } catch { return {} }
}
function takeRestore(): OrderForm | null {
  try {
    const v = readLocal(RESTORE_KEY)
    if (!v) return null
    localStorage.removeItem(RESTORE_KEY)
    return JSON.parse(v)
  } catch { return null }
}
function loadSort(): { key: SortKey; desc: boolean } {
  try { return { key: 'times', desc: true, ...JSON.parse(readLocal(SORT_KEY) || '{}') } } catch { return { key: 'times', desc: true } }
}

export default function OrderPage() {
  const { stores, suppliers, profile } = useApp()
  const [restored] = useState(takeRestore)   // 「保存しない」で戻ってきたときの入力
  const skipReset = useRef(!!restored)
  // 終わった外販は出さない
  const today = todayJst()
  const activeStores = stores.filter(s => s.active && !(s.kind === 'mobile' && s.end_date && s.end_date < today))
  const [items, setItems] = useState<Item[]>([])
  const [places, setPlaces] = useState<DeliveryPlace[]>([])
  const [stats, setStats] = useState<Record<string, { times: number; qty: number }>>({})
  const [favs, setFavs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [storeId, setStoreId] = useState(() => restored?.storeId || readLocal(STORE_KEY) || profile.default_store_id || '')
  const [q, setQ] = useState('')
  const [sup, setSup] = useState('')
  const [onlyCart, setOnlyCart] = useState(false)
  const [onlyFav, setOnlyFav] = useState(false)
  const [onlyShort, setOnlyShort] = useState(false)
  const [stock, setStock] = useState<StockData | null | undefined>(undefined)   // undefined は読み込み中、null はまだ一度も読み込んでいない
  const [staleOk, setStaleOk] = useState(false)   // 在庫が古い（ない）まま発注することを確かめたか
  // 在庫から自動で入れた数量（商品の id → 数）。切り替えで消すとき、手で直していないものだけ消す
  const [autoFilled, setAutoFilled] = useState<Record<string, number> | null>(null)
  const [stockMsg, setStockMsg] = useState('')
  const [sort, setSort] = useState(loadSort)
  const [cart, setCart] = useState<Record<string, number>>(() => restored?.cart ?? loadCart())
  const [delivery, setDelivery] = useState<{ type: DeliveryType; storeId: string; placeId: string }>(restored?.delivery ?? { type: 'store', storeId: '', placeId: '' })
  const [due, setDue] = useState(restored?.due ?? '')
  const [time, setTime] = useState(restored?.time ?? '')
  const [remarks, setRemarks] = useState(restored?.remarks ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('items').select('*').eq('active', true).order('code'),
      supabase.from('delivery_places').select('*').eq('active', true).order('sort').order('name'),
      supabase.from('item_favorites').select('item_id').eq('user_id', profile.id),
    ]).then(([it, pl, fv]) => {
      setItems((it.data ?? []) as Item[])
      setPlaces((pl.data ?? []) as DeliveryPlace[])
      setFavs(new Set((fv.data ?? []).map(f => f.item_id as string)))
      setLoading(false)
    })
  }, [profile.id])
  useEffect(() => { writeLocal(CART_KEY, JSON.stringify(cart)) }, [cart])
  useEffect(() => { writeLocal(SORT_KEY, JSON.stringify(sort)) }, [sort])
  useEffect(() => {
    if (!activeStores.some(s => s.id === storeId) && activeStores[0]) setStoreId(activeStores[0].id)
  }, [activeStores, storeId])
  // 在庫は店舗ごと。店舗を選び直したら、その店舗の在庫を読む
  useEffect(() => {
    try { localStorage.removeItem('machiyori.stock') } catch { /* 前の版がブラウザに残した在庫は使わない */ }
    setStock(undefined); setStockMsg(''); setStaleOk(false); setAutoFilled(null)
    if (!storeId) return
    let live = true
    fetchStock(storeId).then(d => { if (live) setStock(d) }).catch(e => { if (live) setStockMsg(errorText(e)) })
    return () => { live = false }
  }, [storeId])
  // 発注の多い順は、店舗ごとの発注の記録から数える
  useEffect(() => {
    if (!storeId) return
    supabase.rpc('item_order_stats', { p_store_id: storeId }).then(({ data }) => {
      setStats(Object.fromEntries(((data ?? []) as { item_id: string; times: number; qty: number }[]).map(r => [r.item_id, r])))
    })
  }, [storeId])

  const store = activeStores.find(s => s.id === storeId)
  const isOutside = store?.kind === 'mobile'
  const fixedStores = activeStores.filter(s => s.kind === 'fixed')
  // 実店舗は「店舗に納品」か「集荷」だけ。外販は全部から選べて、はじめは会場に納品
  const types: DeliveryType[] = isOutside ? ['venue', 'store', 'pickup', 'address'] : ['store', 'pickup']
  useEffect(() => {
    // 戻ってきた入力は、はじめの1回だけそのまま使う
    if (skipReset.current) { skipReset.current = false; return }
    // はじめは店舗に登録した納品のしかた（集荷か、店舗納品。外販の店舗納品は会場に納品）
    setDelivery(d => ({ ...d, type: store?.delivery_method === 'pickup' ? 'pickup' : isOutside ? 'venue' : 'store' }))
    // 外販を選んだら、納品希望日に期間の始めを入れる（入れてあれば変えない）
    if (isOutside && store?.start_date) setDue(v => v || store.start_date!)
  }, [storeId, isOutside]) // eslint-disable-line react-hooks/exhaustive-deps

  const supName = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers])
  const supById = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers])

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase()
    const list = items.filter(i =>
      !supById[i.supplier_id]?.no_order &&   // 発注しない取引先の商品は出さない
      (!sup || i.supplier_id === sup) &&
      (!onlyCart || cart[i.id] > 0) &&
      (!onlyFav || favs.has(i.id)) &&
      (!onlyShort || isShort(i)) &&
      (!k || `${i.code ?? ''} ${i.name} ${i.spec} ${supName[i.supplier_id] ?? ''}`.toLowerCase().includes(k)))
    const dir = sort.desc ? -1 : 1
    const byCode = (a: Item, b: Item) => (a.code ?? '').localeCompare(b.code ?? '', 'ja', { numeric: true })
    return list.sort((a, b) => {
      if (sort.key === 'times') {
        const sa = stats[a.id], sb = stats[b.id]
        const d = ((sa?.times ?? 0) - (sb?.times ?? 0)) || ((sa?.qty ?? 0) - (sb?.qty ?? 0))
        return d ? d * dir : byCode(a, b)
      }
      if (sort.key === 'short') {
        // 足りない数（設定在庫数 − 在庫数）で並べる。在庫か設定在庫数がない商品は、いつもいちばん後ろ
        const sa = shortBy(a), sb = shortBy(b)
        if (sa === null || sb === null) return sa === sb ? byCode(a, b) : sa === null ? 1 : -1
        return (sa - sb) * dir || byCode(a, b)
      }
      if (sort.key === 'name') return a.name.localeCompare(b.name, 'ja') * dir
      return byCode(a, b) * dir
    })
  }, [items, q, sup, onlyCart, onlyFav, onlyShort, stock, favs, cart, supName, sort, stats]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g: Record<string, { item: Item; qty: number }[]> = {}
    for (const i of items) if (cart[i.id] > 0) (g[i.supplier_id] ||= []).push({ item: i, qty: cart[i.id] })
    return Object.entries(g).sort((a, b) => (supName[a[0]] ?? '').localeCompare(supName[b[0]] ?? '', 'ja'))
  }, [items, cart, supName])

  // 足りない数（設定在庫数 − 在庫数）。在庫か設定在庫数がなければ null
  function shortBy(i: Item) {
    const n = stock?.qty[i.id]
    return i.target_stock == null || n === undefined ? null : i.target_stock - n
  }
  // 行の色：在庫が発注ラインを下回ったら赤、発注ラインの 120% を切ったら黄
  function stockLevel(i: Item): 'short' | 'near' | null {
    const n = stock?.qty[i.id]
    if (i.min_stock == null || n === undefined) return null
    if (n < i.min_stock) return 'short'
    if (n < i.min_stock * 1.2) return 'near'
    return null
  }
  // 在庫が発注ラインより少ない商品
  function isShort(i: Item) {
    const n = stock?.qty[i.id]
    return i.min_stock != null && n !== undefined && n < i.min_stock
  }

  // Airレジの在庫 CSV を読み、設定在庫数より少ない商品に「設定在庫数 − 在庫数」の数量を入れる
  async function readStock(file: File | undefined) {
    if (!file) return
    setStockMsg('')
    if (!storeId) { setStockMsg('先に店舗を選んでください。在庫は店舗ごとに保存します。'); return }
    try {
      const raw = await readCsv(file)
      const head = Object.keys(raw[0] ?? {})
      const idCols = STOCK_ID_COLS.filter(c => head.includes(c))
      const qtyCol = STOCK_QTY_COLS.find(c => head.includes(c))
      if (!idCols.length || !qtyCol) {
        setStockMsg(`在庫 CSV の列が見つかりません。「${STOCK_ID_COLS.join('・')}」のどれかと「${STOCK_QTY_COLS.join('・')}」のどれかの列が要ります。（この CSV の列：${head.join('、') || 'なし'}）`)
        return
      }
      // 先に品番（Airレジの商品ID）で結びつけ、見つからなければバーコードで探す
      const byCode = new Map<string, Item>()
      const byBarcode = new Map<string, Item>()
      for (const i of items) {
        if (i.code) byCode.set(i.code, i)
        if (i.barcode) byBarcode.set(i.barcode, i)
      }
      const qty: Record<string, number> = {}
      let miss = 0
      for (const r of raw) {
        // Airレジのバーコードは頭に # が付く
        const keys = idCols.map(c => (r[c] ?? '').replace(/^['#]/, '').trim()).filter(Boolean)
        const item = keys.map(k => byCode.get(k)).find(Boolean) ?? keys.map(k => byBarcode.get(k)).find(Boolean)
        const n = Number((r[qtyCol] ?? '').replace(/,/g, ''))
        if (!item || !Number.isFinite(n)) { miss++; continue }
        qty[item.id] = Math.round(n)
      }
      // データベースに保存する（この店舗の前の在庫は置き換わる）
      const { error } = await supabase.rpc('import_stock', {
        p_store_id: storeId, p_file: file.name, p_miss: miss,
        p_rows: Object.entries(qty).map(([item_id, n]) => ({ item_id, qty: n })),
      })
      if (error) throw error
      setStock({ storeId, at: new Date().toISOString(), file: file.name, by: profile.name, qty }); setStaleOk(false)
      const filled = fillFromStock(qty)   // 前に自動で入れた数量は、新しい在庫で入れ直す
      const short = items.filter(i => i.min_stock != null && qty[i.id] !== undefined && qty[i.id] < i.min_stock).length
      setStockMsg(`${Object.keys(qty).length}品の在庫を読み込んで保存しました${miss ? `（商品が見つからない行 ${miss}行）` : ''}。発注ラインを下回った商品は ${short}品です。設定在庫数より少ない ${filled}品に「設定在庫数 − 在庫」の数量を入れました。「数量を自動で入れる」で消すこともできます。`)
      setSort({ key: 'short', desc: true })
    } catch (e) { setStockMsg(errorText(e)) }
  }

  // 設定在庫数より在庫が少ない商品に「設定在庫数 − 在庫数」を入れる。数量が入っている商品はそのまま。入れた品数を返す
  function fillFromStock(qty: Record<string, number>) {
    const prev = autoFilled ?? {}
    const isAuto = (id: string) => prev[id] !== undefined && cart[id] === prev[id]   // 前に自動で入れて、手で直していない
    const add: Record<string, number> = {}
    for (const i of items) {
      const n = qty[i.id]
      if (i.target_stock == null || n === undefined || n >= i.target_stock || (cart[i.id] && !isAuto(i.id))) continue
      if (supById[i.supplier_id]?.no_order) continue   // 発注しない取引先（100番台の生産者さんなど）
      add[i.id] = i.target_stock - n
    }
    setCart(c => {
      const next = { ...c }
      for (const [id, q] of Object.entries(prev)) if (next[id] === q) delete next[id]
      return { ...next, ...add }
    })
    setAutoFilled(add)
    return Object.keys(add).length
  }
  // 自動で入れた数量を消す（手で直した数量は残す）
  function clearAutoFilled() {
    const auto = autoFilled ?? {}
    setCart(c => {
      const n = { ...c }
      for (const [id, q] of Object.entries(auto)) if (n[id] === q) delete n[id]
      return n
    })
    setAutoFilled(null)
  }
  function toggleAuto(on: boolean) {
    setStockMsg('')
    if (!on) { clearAutoFilled(); return }
    if (!stock) return
    const filled = fillFromStock(stock.qty)
    setStockMsg(filled ? `設定在庫数より少ない ${filled}品に「設定在庫数 − 在庫」の数量を入れました。数は直せます。` : '数量を入れる商品はありませんでした（設定在庫数が空か、在庫が足りているか、もう数量が入っています）。')
  }

  const setQty = (id: string, v: number) => setCart(c => {
    const n = { ...c }
    const qty = Math.max(0, Math.min(99999, Math.floor(v || 0)))
    if (qty) n[id] = qty; else delete n[id]
    return n
  })

  async function toggleFav(id: string) {
    const on = !favs.has(id)
    setFavs(f => { const n = new Set(f); if (on) n.add(id); else n.delete(id); return n })
    const { error } = on
      ? await supabase.from('item_favorites').insert({ user_id: profile.id, item_id: id })
      : await supabase.from('item_favorites').delete().eq('user_id', profile.id).eq('item_id', id)
    if (error) {
      setFavs(f => { const n = new Set(f); if (on) n.delete(id); else n.add(id); return n })
      setError(errorText(error))
    }
  }

  const deliveryReady = delivery.type === 'pickup' || delivery.type === 'venue'
    || (delivery.type === 'store' && (!isOutside || !!delivery.storeId))
    || (delivery.type === 'address' && !!delivery.placeId)

  async function create() {
    setBusy(true); setError('')
    const lines = groups.flatMap(([, ls]) => ls.map(l => ({ item_id: l.item.id, qty: l.qty })))
    const { data, error } = await supabase.rpc('create_orders', {
      p_store_id: storeId, p_due_date: due || null, p_remarks: remarks, p_lines: lines,
      p_delivery: { type: delivery.type, store_id: delivery.storeId || null, place_id: delivery.placeId || null, time },
    })
    setBusy(false)
    if (error) { setError(errorText(error)); return }
    const ids = data as string[]
    const form: OrderForm = { ids, storeId, cart, delivery, due, time, remarks }
    writeLocal(LAST_KEY, JSON.stringify(form))
    setCart({}); setDue(''); setTime(''); setRemarks('')
    go('sheets/' + ids.join(','))
  }

  // 在庫の新しさ。古い（ない）ときは発注書を作る前に確かめてもらう
  const age = stock ? stockAge(stock) : null
  const stockState: 'loading' | 'none' | 'stale' | 'ok' = stock === undefined ? 'loading' : !stock ? 'none' : age!.stale ? 'stale' : 'ok'
  const needStaleOk = stockState === 'none' || stockState === 'stale'
  const storeName = stores.find(s => s.id === storeId)?.name ?? ''
  const stockInput = (
    <label className="btn">在庫 CSV を読み込んで保存する（Airレジ）<input type="file" accept=".csv,text/csv" hidden onChange={e => { readStock(e.target.files?.[0]); e.target.value = '' }} /></label>
  )

  const sortButton = (
    <button className="btn" onClick={() => setSort(s => ({ ...s, desc: !s.desc }))} aria-label="並びを逆にする"
      title={sort.desc ? '多い順・後ろから（降順）' : '少ない順・前から（昇順）'}>
      {sort.desc ? '降順 ↓' : '昇順 ↑'}
    </button>
  )

  return (
    <div className="grid-order">
      {storeId && stockState !== 'loading' && (
        <section className={`stock-banner ${stockState}`} aria-live="polite">
          <div className="stock-banner-main">
            {stockState === 'ok' && <>
              <div className="stock-banner-label">在庫データ（{storeName}）</div>
              <div className="stock-banner-date">{stockDate(age!.data)} 時点{age!.days === 0 ? '（今日）' : `（${age!.days}日前）`}</div>
            </>}
            {stockState === 'stale' && <>
              <div className="stock-banner-label">⚠ 在庫データが古いです（{storeName}）</div>
              <div className="stock-banner-date">{stockDate(age!.data)} 時点（{age!.days}日前）</div>
              <div>このまま発注すると、いまの在庫と合わない数になるおそれがあります。発注の前に、Airレジから新しい在庫 CSV を書き出して読み込んでください。</div>
            </>}
            {stockState === 'none' && <>
              <div className="stock-banner-label">⚠ 在庫データがありません（{storeName}）</div>
              <div>この店舗の在庫 CSV はまだ読み込まれていません。発注の前に、Airレジから在庫 CSV を書き出して読み込んでください。</div>
            </>}
            {stock && <div className="small">ファイル：{stock.file}　読み込み：{stockDate(age!.imported)}{stock.by && `（${stock.by}）`}</div>}
          </div>
          <div>{stockInput}</div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>商品を選ぶ</h2>
          <span className="muted small">{loading ? '読み込み中…' : `${rows.length} / ${items.filter(i => !supById[i.supplier_id]?.no_order).length} 品`}</span>
        </div>
        <div className="toolbar">
          <input type="search" aria-label="品名・品番・取引先で探す" placeholder="品名・品番・取引先で探す" value={q} onChange={e => setQ(e.target.value)} className="grow" />
          <select aria-label="取引先" value={sup} onChange={e => setSup(e.target.value)}>
            <option value="">すべての取引先</option>
            {suppliers.filter(s => s.active && !s.no_order).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="toolbar">
          <label className="small muted" htmlFor="sort">並び</label>
          <select id="sort" value={sort.key} onChange={e => setSort(s => ({ ...s, key: e.target.value as SortKey }))}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
          {sortButton}
          <label className="check"><input type="checkbox" checked={onlyFav} onChange={e => setOnlyFav(e.target.checked)} />★ お気に入りだけ</label>
          <label className="check"><input type="checkbox" checked={onlyCart} onChange={e => setOnlyCart(e.target.checked)} />かごの商品だけ</label>
        </div>
        {stock && <div className="toolbar">
          <label className="switch"><input type="checkbox" role="switch" checked={!!autoFilled} onChange={e => toggleAuto(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />設定在庫数に足りない数を自動で入れる</label>
          <label className="check"><input type="checkbox" checked={onlyShort} onChange={e => setOnlyShort(e.target.checked)} />在庫が発注ラインより少ないものだけ</label>
          <span className="small"><span className="swatch stock-short" />発注ラインを下回った <span className="swatch stock-near" />発注ラインの120%未満</span>
        </div>}
        {stockMsg && <p className="note small">{stockMsg}</p>}
        <div className="tbl-wrap">
          <table className="list">
            <thead><tr><th aria-label="お気に入り" /><th>品番（Airレジ）</th><th>品名・規格</th><th>取引先</th><th className="num">仕入れ(税抜)</th><th className="num">在庫</th><th className="num">発注ライン</th><th className="num">設定在庫数</th><th className="num">数量</th></tr></thead>
            <tbody>
              {rows.map(i => (
                <tr key={i.id} className={[cart[i.id] ? 'picked' : '', stockLevel(i) ? `stock-${stockLevel(i)}` : ''].join(' ').trim() || undefined}>
                  <td><button className={favs.has(i.id) ? 'star on' : 'star'} aria-pressed={favs.has(i.id)}
                    aria-label={favs.has(i.id) ? `${i.name}をお気に入りから外す` : `${i.name}をお気に入りにする`}
                    onClick={() => toggleFav(i.id)}>{favs.has(i.id) ? '★' : '☆'}</button></td>
                  <td><span className="chip">{i.code}</span></td>
                  <td>{i.name}<div className="sub">{i.spec}{i.spec && ' ／ '}{i.unit}{i.tax_rate === 8 && ' ／ 軽減8%'}{i.sale_price != null && ` ／ 販売 ${yen(i.sale_price)}`}</div></td>
                  <td className="sub">{supName[i.supplier_id]}</td>
                  <td className="num">{yen(i.price)}</td>
                  <td className="num">{stock?.qty[i.id] ?? '—'}</td>
                  <td className="num sub">{i.min_stock ?? '—'}</td>
                  <td className="num sub">{i.target_stock ?? '—'}</td>
                  <td className="num">
                    <span className="qty">
                      <button className="btn small" aria-label={`${i.name}を減らす`} onClick={() => setQty(i.id, (cart[i.id] || 0) - 1)}>−</button>
                      <input type="number" min={0} inputMode="numeric" aria-label={`${i.name}の数量`} placeholder="0"
                        value={cart[i.id] || ''} onChange={e => setQty(i.id, +e.target.value)} />
                      <button className="btn small" aria-label={`${i.name}を増やす`} onClick={() => setQty(i.id, (cart[i.id] || 0) + 1)}>＋</button>
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={9} className="muted">
                {items.length === 0 ? '商品がまだありません。「商品」画面で登録するか、CSV で読み込んでください。'
                  : onlyFav && favs.size === 0 ? 'お気に入りはまだありません。商品の ☆ を押すと登録できます。' : '該当する商品がありません。'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="panel cart">
        <h2>発注かご</h2>
        <div className="field">
          <label htmlFor="store">発注する店舗</label>
          <select id="store" value={storeId} onChange={e => { setStoreId(e.target.value); writeLocal(STORE_KEY, e.target.value) }}>
            <optgroup label={kindLabel.fixed}>
              {fixedStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
            {activeStores.some(s => s.kind === 'mobile') && <optgroup label={kindLabel.mobile}>
              {activeStores.filter(s => s.kind === 'mobile').map(s => <option key={s.id} value={s.id}>{s.name}（{kindLabel.mobile}{periodText(s) && ` ${periodText(s)}`}）</option>)}
            </optgroup>}
          </select>
          {activeStores.length === 0 && <span className="warn small">店舗がまだありません。管理者が「店舗」画面で登録してください。</span>}
        </div>

        {groups.length === 0 && <p className="muted small">数量を入れると、取引先ごとにここへまとまります。取引先ごとに1枚ずつ発注書を作ります。</p>}
        {groups.map(([sid, ls]) => {
          const s = supById[sid]
          const sub = ls.reduce((a, l) => a + l.item.price * l.qty, 0)
          return (
            <div className="cart-group" key={sid}>
              <h3><span>{s?.name}</span>{s && <span className="chip">{methodLabel[s.send_method]}</span>}</h3>
              {ls.map(l => <div className="cart-line" key={l.item.id}><span>{l.item.name} × {l.qty}</span><span>{yen(l.item.price * l.qty)}</span></div>)}
              <div className="cart-line strong"><span>小計（税抜）</span><span>{yen(sub)}</span></div>
            </div>
          )
        })}

        <div className="cart-group">
          <fieldset className="field">
            <legend>納品のしかた</legend>
            <div className="seg">
              {types.map(t => (
                <label key={t} className={delivery.type === t ? 'on' : undefined}>
                  <input type="radio" name="dtype" value={t} checked={delivery.type === t} onChange={() => setDelivery(d => ({ ...d, type: t }))} />
                  {deliveryLabel[t]}
                </label>
              ))}
            </div>
          </fieldset>
          {delivery.type === 'store' && (isOutside
            ? <div className="field"><label htmlFor="dstore">納品する店舗</label>
                <select id="dstore" value={delivery.storeId} onChange={e => setDelivery(d => ({ ...d, storeId: e.target.value }))}>
                  <option value="">選んでください</option>
                  {fixedStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
            : <p className="muted small">{store?.name}に納品してもらいます。</p>)}
          {delivery.type === 'venue' && <p className="muted small">{store?.name}の会場{store?.address ? `（${store.address}）` : ''}に納品してもらいます。{!store?.address && <span className="warn">店舗の画面で会場の住所を入れてください。</span>}</p>}
          {delivery.type === 'pickup' && <p className="muted small">取引先へ引き取りに行きます。集荷の日時を入れてください。</p>}
          {delivery.type === 'address' && (
            <div className="field"><label htmlFor="dplace">納品先の住所</label>
              <select id="dplace" value={delivery.placeId} onChange={e => setDelivery(d => ({ ...d, placeId: e.target.value }))}>
                <option value="">選んでください</option>
                {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {places.length === 0 && <span className="warn small">住所がまだありません。管理者が「納品先」画面で登録してください。</span>}
              {places.find(p => p.id === delivery.placeId) && <span className="muted small">{places.find(p => p.id === delivery.placeId)!.address}</span>}
            </div>
          )}
          <div className="row2">
            <div className="field"><label htmlFor="due">{delivery.type === 'pickup' ? '集荷日' : '納品希望日'}</label>
              <input id="due" type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
            <div className="field"><label htmlFor="time">時間</label>
              <input id="time" list="time-list" placeholder="例 10:00、午前中" value={time} onChange={e => setTime(e.target.value)} />
              <datalist id="time-list"><option value="午前中" /><option value="午後" /><option value="9:00" /><option value="10:00" /><option value="13:00" /><option value="15:00" /></datalist></div>
          </div>
          <div className="field"><label htmlFor="remarks">備考（この発注の全部の発注書に入ります。発注書ごとにもあとで書けます）</label><textarea id="remarks" value={remarks} onChange={e => setRemarks(e.target.value)} /></div>
          {error && <p className="msg">{error}</p>}
          {groups.length > 0 && needStaleOk && (
            <div className="stock-confirm">
              <b>{stockState === 'none' ? '在庫データがありません。' : `在庫データが ${age!.days}日前のものです。`}</b>
              <span>先に新しい在庫 CSV を読み込むのがおすすめです。</span>
              <label className="check"><input type="checkbox" checked={staleOk} onChange={e => setStaleOk(e.target.checked)} />
                {stockState === 'none' ? '在庫を読み込まないまま発注書を作る' : '古い在庫のまま発注書を作る'}</label>
            </div>
          )}
          <button className="btn primary wide" disabled={busy || groups.length === 0 || !storeId || !deliveryReady || (needStaleOk && !staleOk)} onClick={create}>
            {busy ? '作成中…' : `発注書を作成（${groups.length}枚）`}
          </button>
          {groups.length > 0 && !deliveryReady && <p className="warn small">納品先を選んでください。</p>}
          {groups.length > 0 && <button className="btn wide" onClick={() => setCart({})}>かごを空にする</button>}
        </div>
      </aside>
    </div>
  )
}
