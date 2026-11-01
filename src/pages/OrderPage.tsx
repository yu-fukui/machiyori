import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { go, useApp } from '../lib/app'
import type { DeliveryPlace, DeliveryType, Item } from '../lib/types'
import { deliveryLabel, errorText, kindLabel, methodLabel, periodText, readLocal, todayJst, writeLocal, yen } from '../lib/format'

const CART_KEY = 'machiyori.cart'
const STORE_KEY = 'machiyori.store'
const SORT_KEY = 'machiyori.sort'
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

type SortKey = 'times' | 'code' | 'name'
const SORT_LABEL: Record<SortKey, string> = { times: '発注の多い順', code: '品番', name: '品名' }

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
    setDelivery(d => ({ ...d, type: isOutside ? 'venue' : (types.includes(d.type) ? d.type : 'store') }))
    // 外販を選んだら、納品希望日に期間の始めを入れる（入れてあれば変えない）
    if (isOutside && store?.start_date) setDue(v => v || store.start_date!)
  }, [storeId, isOutside]) // eslint-disable-line react-hooks/exhaustive-deps

  const supName = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers])
  const supById = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers])

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase()
    const list = items.filter(i =>
      (!sup || i.supplier_id === sup) &&
      (!onlyCart || cart[i.id] > 0) &&
      (!onlyFav || favs.has(i.id)) &&
      (!k || `${i.code ?? ''} ${i.name} ${i.spec} ${supName[i.supplier_id] ?? ''}`.toLowerCase().includes(k)))
    const dir = sort.desc ? -1 : 1
    const byCode = (a: Item, b: Item) => (a.code ?? '').localeCompare(b.code ?? '', 'ja', { numeric: true })
    return list.sort((a, b) => {
      if (sort.key === 'times') {
        const sa = stats[a.id], sb = stats[b.id]
        const d = ((sa?.times ?? 0) - (sb?.times ?? 0)) || ((sa?.qty ?? 0) - (sb?.qty ?? 0))
        return d ? d * dir : byCode(a, b)
      }
      if (sort.key === 'name') return a.name.localeCompare(b.name, 'ja') * dir
      return byCode(a, b) * dir
    })
  }, [items, q, sup, onlyCart, onlyFav, favs, cart, supName, sort, stats])

  const groups = useMemo(() => {
    const g: Record<string, { item: Item; qty: number }[]> = {}
    for (const i of items) if (cart[i.id] > 0) (g[i.supplier_id] ||= []).push({ item: i, qty: cart[i.id] })
    return Object.entries(g).sort((a, b) => (supName[a[0]] ?? '').localeCompare(supName[b[0]] ?? '', 'ja'))
  }, [items, cart, supName])

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

  const sortButton = (
    <button className="btn" onClick={() => setSort(s => ({ ...s, desc: !s.desc }))} aria-label="並びを逆にする"
      title={sort.desc ? '多い順・後ろから（降順）' : '少ない順・前から（昇順）'}>
      {sort.desc ? '降順 ↓' : '昇順 ↑'}
    </button>
  )

  return (
    <div className="grid-order">
      <section className="panel">
        <div className="panel-head">
          <h2>商品を選ぶ</h2>
          <span className="muted small">{loading ? '読み込み中…' : `${rows.length} / ${items.length} 品`}</span>
        </div>
        <div className="toolbar">
          <input type="search" aria-label="品名・品番・取引先で探す" placeholder="品名・品番・取引先で探す" value={q} onChange={e => setQ(e.target.value)} className="grow" />
          <select aria-label="取引先" value={sup} onChange={e => setSup(e.target.value)}>
            <option value="">すべての取引先</option>
            {suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
        <div className="tbl-wrap">
          <table className="list">
            <thead><tr><th aria-label="お気に入り" /><th>品番</th><th>品名・規格</th><th>取引先</th><th className="num">仕入れ(税抜)</th><th className="num">発注</th><th className="num">数量</th></tr></thead>
            <tbody>
              {rows.map(i => (
                <tr key={i.id} className={cart[i.id] ? 'picked' : undefined}>
                  <td><button className={favs.has(i.id) ? 'star on' : 'star'} aria-pressed={favs.has(i.id)}
                    aria-label={favs.has(i.id) ? `${i.name}をお気に入りから外す` : `${i.name}をお気に入りにする`}
                    onClick={() => toggleFav(i.id)}>{favs.has(i.id) ? '★' : '☆'}</button></td>
                  <td><span className="chip">{i.code}</span></td>
                  <td>{i.name}<div className="sub">{i.spec}{i.spec && ' ／ '}{i.unit}{i.tax_rate === 8 && ' ／ 軽減8%'}{i.sale_price != null && ` ／ 販売 ${yen(i.sale_price)}`}</div></td>
                  <td className="sub">{supName[i.supplier_id]}</td>
                  <td className="num">{yen(i.price)}</td>
                  <td className="num sub">{stats[i.id] ? `${stats[i.id].times}回` : '—'}</td>
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
              {!loading && rows.length === 0 && <tr><td colSpan={7} className="muted">
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
          <button className="btn primary wide" disabled={busy || groups.length === 0 || !storeId || !deliveryReady} onClick={create}>
            {busy ? '作成中…' : `発注書を作成（${groups.length}枚）`}
          </button>
          {groups.length > 0 && !deliveryReady && <p className="warn small">納品先を選んでください。</p>}
          {groups.length > 0 && <button className="btn wide" onClick={() => setCart({})}>かごを空にする</button>}
        </div>
      </aside>
    </div>
  )
}
