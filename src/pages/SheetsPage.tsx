import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { go, useApp } from '../lib/app'
import type { Order } from '../lib/types'
import { errorText, faxAddress, isPickup, jpDateTime, jpDateW, readLocal, statusLabel, viaLabel, writeLocal } from '../lib/format'
import { downloadBlob, sheetPdf } from '../lib/pdf'
import OrderSheet from '../components/OrderSheet'
import { LAST_KEY, RESTORE_KEY, type OrderForm } from './OrderPage'

export default function SheetsPage({ ids }: { ids: string[] }) {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [printing, setPrinting] = useState<{ ids: string[]; fax: boolean } | null>(null)
  const afterPrint = useRef<(() => void) | null>(null)
  const [leaving, setLeaving] = useState(false)   // 「発注画面へ」で、保存するかをたずねているあいだ
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  const { suppliers, settings, toast } = useApp()
  const apis = useRef(new Map<string, SheetApi>())
  const register = useCallback((id: string, api: SheetApi | null) => { if (api) apis.current.set(id, api); else apis.current.delete(id) }, [])
  const [bulk, setBulk] = useState<{ kind: 'fax' | 'email' | 'faxSent'; ids: string[] } | null>(null)
  const [bulkBusy, setBulkBusy] = useState('')
  const [bulkMsg, setBulkMsg] = useState('')

  const load = useCallback(async () => {
    if (ids.length === 0) { setOrders([]); return }
    const { data } = await supabase.from('orders')
      .select('*, order_lines(*), orderer:profiles!orders_created_by_fkey(name, email)').in('id', ids).order('order_no')
    setOrders((data ?? []) as Order[])
  }, [ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // 印刷：選んだ発注書だけを印刷する。印刷画面を閉じたら afterPrint を呼ぶ
  useEffect(() => {
    if (!printing) return
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      setPrinting(null)
      afterPrint.current?.()
      afterPrint.current = null
    }
    window.addEventListener('afterprint', done, { once: true })
    const t = window.setTimeout(() => { window.print(); done() }, 50)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [printing])

  const print = (ids: string[], fax = false, after?: () => void) => {
    afterPrint.current = after ?? null
    setPrinting({ ids, fax })
  }

  if (!orders) return <p className="muted">読み込み中…</p>
  if (orders.length === 0) return <p className="muted">発注書が見つかりません。<a href="#/history">履歴</a>から開いてください。</p>

  // まだ履歴に残していない発注書（作っただけで、送る操作をしていない）
  const unsaved = orders.filter(o => !o.saved_at)

  // まとめて送る相手：まだ送っていない発注書を、取引先のおもな送り方で分ける
  const supOf = (o: Order) => suppliers.find(s => s.id === o.supplier_id) ?? o.supplier_snapshot
  const pending = orders.filter(o => o.status === 'draft')
  const faxTargets = pending.filter(o => supOf(o).send_method === 'fax' && supOf(o).fax)
  const mailTargets = pending.filter(o => supOf(o).send_method === 'email' && supOf(o).email)
  const faxByPrint = !settings.fax_gateway

  // 全部の発注書を一度に印刷する（取消したものは除く）。印刷の前に履歴に残し、ドライブに保存する
  // 印刷したあと、まだ送っていない発注書があれば「送れましたか」とたずねて、まとめて送信済みにできる
  const printable = orders.filter(o => o.status !== 'cancelled')
  async function printAll() {
    const ids = printable.map(o => o.id)
    const drafts = printable.filter(o => o.status === 'draft').map(o => o.id)
    setBulkBusy('print'); setBulkMsg(''); setBulk(null)
    for (const id of ids) await apis.current.get(id)?.prepare()
    setBulkBusy('')
    await load()
    print(ids, false, () => { if (drafts.length) setBulk({ kind: 'faxSent', ids: drafts }) })
  }

  // まとめて記録する：印刷して FAX で送れた発注書を送信済みにする
  async function bulkMarkSent(ids: string[]) {
    setBulkBusy('mark'); setBulkMsg('')
    let ng = 0
    for (const id of ids) {
      const { error } = await supabase.rpc('mark_order_printed', { p_order_id: id })
      if (error) ng++
    }
    setBulkBusy(''); setBulk(null)
    setBulkMsg(ng ? `${ids.length - ng}枚を送信済みにしました。${ng}枚は記録できませんでした。` : `${ids.length}枚を送信済みにしました。`)
    await load()
  }

  // メール（またはインターネットFAX）でまとめて送る
  async function bulkSend(via: 'email' | 'fax', ids: string[]) {
    setBulkBusy(via); setBulkMsg(''); setBulk(null)
    let ok = 0
    for (const id of ids) if (await apis.current.get(id)?.send(via)) ok++
    setBulkBusy('')
    setBulkMsg(ok === ids.length ? `${ok}件を送りました。` : `${ok}件を送りました。${ids.length - ok}件は送れませんでした（その発注書の下にわけを出しています）。`)
    if (ok) toast(`${ok}件を送りました`)
    await load()
  }

  function back() {
    if (unsaved.length === 0) { go('order'); return }
    setLeaveError(''); setLeaving(true)
  }

  // 保存する：下書きとして履歴に残す
  async function saveAndBack() {
    setLeaveBusy(true); setLeaveError('')
    const { error } = await supabase.rpc('save_orders', { p_ids: unsaved.map(o => o.id) })
    setLeaveBusy(false)
    if (error) { setLeaveError(errorText(error)); return }
    go('order')
  }

  // 保存しない：発注書を消して、数量などを発注画面に戻す
  async function discardAndBack() {
    setLeaveBusy(true); setLeaveError('')
    const ids = unsaved.map(o => o.id)
    const { error } = await supabase.rpc('discard_orders', { p_ids: ids })
    setLeaveBusy(false)
    if (error) { setLeaveError(errorText(error)); return }
    writeLocal(RESTORE_KEY, JSON.stringify(restoreForm(unsaved)))
    go('order')
  }

  return (
    <div>
      <div className="toolbar no-print">
        <button className="btn" onClick={back}>← 発注画面へ</button>
        {printable.length > 1 && <button className="btn primary" disabled={!!bulkBusy} onClick={printAll}>{bulkBusy === 'print' ? '準備中…' : `全部の発注書を印刷（${printable.length}枚）`}</button>}
        <span className="muted small">{orders.length}枚。{unsaved.length > 0 ? '送る（メール・FAX・印刷・PDFを保存）と履歴に残ります。' : ''}</span>
      </div>
      {pending.length > 1 && ((!faxByPrint && faxTargets.length > 0) || mailTargets.length > 0) && (
        <div className="toolbar no-print bulk">
          <strong className="small">まとめて：</strong>
          {!faxByPrint && faxTargets.length > 0 && <button className="btn primary" disabled={!!bulkBusy} onClick={() => setBulk({ kind: 'fax', ids: faxTargets.map(o => o.id) })}>{bulkBusy === 'fax' ? '送信中…' : `インターネットFAX でまとめて送る（${faxTargets.length}件）`}</button>}
          {mailTargets.length > 0 && <button className="btn primary" disabled={!!bulkBusy} onClick={() => setBulk({ kind: 'email', ids: mailTargets.map(o => o.id) })}>{bulkBusy === 'email' ? '送信中…' : `メールでまとめて送る（${mailTargets.length}件）`}</button>}
          <span className="muted small">送り方が「FAX」「メール」の取引先で、まだ送っていない発注書が対象です。</span>
        </div>
      )}
      {bulk && (
        <div className="confirm no-print">
          {bulk.kind === 'faxSent' && <>
            <p>印刷した発注書のうち、まだ送っていない <b>{bulk.ids.length}枚</b> を、取引先に送れましたか（FAX・手渡しなど）？ 全部送れたら「全部送れた」を押してください。送信済みとして記録します。</p>
            <p className="muted small">送れなかった発注書があるときは「あとで1枚ずつ記録する」を押し、送れた発注書の「手で送った」を押してください。</p>
          </>}
          {bulk.kind === 'email' && <p><b>{bulk.ids.length}件</b> の発注書を、それぞれの取引先にメールで送ります（PDF を付けます）。</p>}
          {bulk.kind === 'fax' && <p><b>{bulk.ids.length}件</b> の発注書を、インターネットFAX で送ります。</p>}
          <div className="row">
            {bulk.kind === 'faxSent'
              ? <><button className="btn primary" disabled={!!bulkBusy} onClick={() => bulkMarkSent(bulk.ids)}>{bulkBusy ? '記録中…' : '全部送れた'}</button>
                  <button className="btn" disabled={!!bulkBusy} onClick={() => setBulk(null)}>あとで1枚ずつ記録する</button></>
              : <><button className="btn primary" disabled={!!bulkBusy} onClick={() => bulkSend(bulk.kind as 'email' | 'fax', bulk.ids)}>{bulk.kind === 'email' ? 'メールを送る' : 'FAX を送る'}</button>
                  <button className="btn" disabled={!!bulkBusy} onClick={() => setBulk(null)}>やめる</button></>}
          </div>
        </div>
      )}
      {bulkMsg && <p className="msg no-print">{bulkMsg}</p>}
      {leaving && (
        <div className="confirm no-print">
          <p>まだ送っていない発注書が <b>{unsaved.length}枚</b> あります。履歴に保存しますか？</p>
          <ul className="small">
            <li>「下書きとして保存する」：履歴に「下書き」で残ります。あとで履歴から開いて送れます。</li>
            <li>「保存しない」：この発注書は消えます。入れた数量は発注画面のかごに戻ります。</li>
          </ul>
          <div className="row">
            <button className="btn primary" disabled={leaveBusy} onClick={saveAndBack}>{leaveBusy ? '処理中…' : '下書きとして保存する'}</button>
            <button className="btn" disabled={leaveBusy} onClick={discardAndBack}>保存しない（数量をかごに戻す）</button>
            <button className="btn quiet" disabled={leaveBusy} onClick={() => setLeaving(false)}>やめる</button>
          </div>
          {leaveError && <p className="msg">{leaveError}</p>}
        </div>
      )}
      {orders.map(o => (
        <SheetBlock key={o.id} order={o} reload={load} printTarget={!printing || printing.ids.includes(o.id)}
          faxPrinting={!!printing?.fax && printing.ids.includes(o.id)}
          onPrint={(fax, after) => print([o.id], fax, after)} register={register} />
      ))}
    </div>
  )
}

// 「保存しない」で発注画面に戻す入力。作ったときの控えがあればそれを、なければ発注書の明細から数量を戻す
function restoreForm(unsaved: Order[]): OrderForm {
  let last: OrderForm | null = null
  try { last = JSON.parse(readLocal(LAST_KEY) || 'null') } catch { /* 控えがなくても明細から戻す */ }
  const ids = new Set(unsaved.map(o => o.id))
  if (last?.ids?.some(id => ids.has(id))) {
    // 一部の発注書を送ったあとなら、送っていない取引先の分だけ戻す
    const keep = new Set(unsaved.flatMap(o => (o.order_lines ?? []).map(l => l.item_id)))
    const cart = Object.fromEntries(Object.entries(last.cart).filter(([id]) => keep.has(id)))
    return { ...last, ids: undefined, cart }
  }
  const o = unsaved[0]
  const cart: Record<string, number> = {}
  for (const u of unsaved) for (const l of u.order_lines ?? []) if (l.item_id) cart[l.item_id] = (cart[l.item_id] ?? 0) + l.qty
  return {
    storeId: o.store_id, cart, due: o.due_date ?? '', time: o.delivery_time, remarks: o.remarks,
    delivery: { type: o.delivery_type, storeId: '', placeId: '' },
  }
}

/** まとめて印刷・送信するときに、親の画面から1枚ずつの発注書を動かすための口 */
interface SheetApi {
  prepare: () => Promise<void>                       // 履歴に残し、ドライブに保存する（印刷の前）
  send: (via: 'email' | 'fax') => Promise<boolean>   // 送れたら true
}

function SheetBlock({ order: o, reload, printTarget, faxPrinting, onPrint, register }: {
  order: Order; reload: () => Promise<void>; printTarget: boolean; faxPrinting: boolean
  onPrint: (fax?: boolean, after?: () => void) => void
  register: (id: string, api: SheetApi | null) => void
}) {
  const { suppliers, settings, toast } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState<'email' | 'fax' | 'printed' | 'faxPrinted' | 'cancel' | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [remarks, setRemarks] = useState<string | null>(null)   // 備考を書いているあいだの文
  const [dueEdit, setDueEdit] = useState<string | null>(null)   // 希望納期を直しているあいだの日付

  // 宛先は今の取引先の情報から取る（作ったあとに直したメール・FAX 番号も使えるように）
  const sup = suppliers.find(s => s.id === o.supplier_id) ?? o.supplier_snapshot
  const mailTo = sup.email
  const faxTo = faxAddress(settings.fax_gateway, sup.fax)
  // インターネットFAX が未設定のあいだは、「FAXで送る」で FAX 用の発注書を印刷する（FAX 機・複合機の PC-FAX で送る）
  const faxByPrint = !settings.fax_gateway && !!sup.fax
  const fileName = `${o.order_no}.pdf`

  async function makePdf() {
    if (!ref.current) throw new Error('発注書が表示されていません')
    return sheetPdf(ref.current)
  }

  // PDF を作って保管庫（Supabase）に置く。メール・FAX の送信とドライブへの保存はこれを使う
  async function uploadPdf() {
    const blob = await makePdf()
    const path = `orders/${o.id}.pdf`
    const up = await supabase.storage.from('order-pdfs').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
    if (up.error) throw up.error
    const upd = await supabase.from('orders').update({ pdf_path: path }).eq('id', o.id)
    if (upd.error) throw upd.error
    return blob
  }

  // Google ドライブの指定フォルダに保存する（設定でフォルダを決めたときだけ）。失敗しても本来の操作は止めない
  async function saveToDrive() {
    if (!settings.drive_folder_id) return
    const { error } = await supabase.functions.invoke('save-to-drive', { body: { order_id: o.id } })
    if (error) {
      const ctx = (error as { context?: Response }).context
      const body = ctx ? await ctx.json().catch(() => null) : null
      setError(`Google ドライブに保存できませんでした：${body?.error || errorText(error)}`)
      return
    }
    await reload()
  }

  // 履歴に残す（PDF保存・印刷のとき。メール・FAX・手で送った・取消はデータベースの側で残す）
  async function keep() {
    if (o.saved_at) return
    const { error } = await supabase.rpc('save_orders', { p_ids: [o.id] })
    if (error) throw error
  }

  async function savePdf() {
    setBusy('pdf'); setError('')
    try {
      await keep()
      const blob = await uploadPdf()
      downloadBlob(blob, `発注書_${o.order_no}_${o.supplier_snapshot.name}.pdf`)
      void saveToDrive()
      if (!o.saved_at) await reload()
    } catch (e) { setError(errorText(e)) }
    finally { setBusy('') }
  }

  // 印刷の前に PDF を作ってドライブに保存する（FAX の欄を付ける前の発注書を保存する）
  // 印刷の前：履歴に残し、FAX の欄を付ける前の発注書をドライブに保存する
  async function prepare() {
    try { await keep() } catch (e) { setError(`履歴に残せませんでした：${errorText(e)}`) }
    try {
      if (settings.drive_folder_id) { await uploadPdf(); void saveToDrive() }
    } catch (e) { setError(`Google ドライブ用の PDF を作れませんでした：${errorText(e)}`) }
  }

  async function printWithSave(fax: boolean) {
    setBusy('print'); setError(''); setConfirm(null)
    await prepare()
    setBusy('')
    if (!o.saved_at) void reload()
    // 印刷したあと、まだ送っていなければ「送れましたか」とたずねる
    onPrint(fax, () => setConfirm(o.status === 'draft' ? 'faxPrinted' : null))
  }

  async function send(via: 'email' | 'fax', quiet = false) {
    setBusy(via); setError('')
    try {
      await uploadPdf()
      void saveToDrive()
      const { data, error } = await supabase.functions.invoke('send-order', { body: { order_id: o.id, via } })
      if (error) {
        // 関数が返したエラー文を出す
        const ctx = (error as { context?: Response }).context
        const body = ctx ? await ctx.json().catch(() => null) : null
        throw new Error(body?.error || errorText(error))
      }
      if (!quiet) toast(via === 'email' ? `${data.to} にメールで送りました` : `FAX の送信を受け付けました（${sup.fax}）。結果はメールで届きます`)
      setConfirm(null)
      if (!quiet) await reload()
      return true
    } catch (e) { setError(errorText(e)); return false }
    finally { setBusy('') }
  }

  // 親の画面に、いまの prepare・send を渡しておく
  const api = useRef<SheetApi>({ prepare, send: v => send(v, true) })
  api.current.prepare = prepare
  api.current.send = v => send(v, true)
  useEffect(() => {
    register(o.id, { prepare: () => api.current.prepare(), send: v => api.current.send(v) })
    return () => register(o.id, null)
  }, [o.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDue() {
    if (dueEdit === null) return
    setBusy('due'); setError('')
    const { error } = await supabase.from('orders').update({ due_date: dueEdit || null }).eq('id', o.id)
    setBusy('')
    if (error) { setError(errorText(error)); return }
    setDueEdit(null)
    toast('希望納期を保存しました')
    await reload()
  }

  async function saveRemarks() {
    if (remarks === null) return
    setBusy('remarks'); setError('')
    const { error } = await supabase.from('orders').update({ remarks }).eq('id', o.id)
    setBusy('')
    if (error) { setError(errorText(error)); return }
    setRemarks(null)
    toast('備考を保存しました')
    await reload()
  }

  async function rpc(fn: 'mark_order_printed' | 'cancel_order') {
    setBusy(fn); setError('')
    const { error } = await supabase.rpc(fn, { p_order_id: o.id })
    setBusy('')
    if (error) { setError(errorText(error)); return }
    setConfirm(null)
    await reload()
  }

  const isPrimary = (m: 'email' | 'fax') => sup.send_method === m ? 'btn primary' : 'btn'
  const closed = o.status === 'cancelled'


  return (
    <section className={printTarget ? 'sheet-block print-target' : 'sheet-block'}>
      <div className="sheet-actions no-print">
        <div className="sheet-actions-head">
          <strong>{o.supplier_snapshot.name}</strong>
          {o.saved_at ? <span className={`chip status-${o.status}`}>{statusLabel[o.status]}</span>
            : <span className="chip status-draft">未保存（まだ履歴にありません）</span>}
          {o.sent_via && <span className="muted small">{viaLabel[o.sent_via]} {jpDateTime(o.sent_at)}{o.sent_to && `（${o.sent_to}）`}</span>}
          <span className="muted small">発注者：{o.orderer?.name || o.orderer?.email || '—'}</span>
          {o.drive_url && <a className="chip" href={o.drive_url} target="_blank" rel="noreferrer">ドライブに保存済み {jpDateTime(o.drive_saved_at)}</a>}
        </div>
        <div className="row">
          <button className="btn" disabled={!!busy} onClick={savePdf}>{busy === 'pdf' ? '作成中…' : 'PDFを保存'}</button>
          <button className={faxByPrint && sup.send_method === 'fax' ? 'btn primary' : 'btn'} disabled={!!busy} onClick={() => printWithSave(false)}>{busy === 'print' ? '準備中…' : 'この発注書だけ印刷'}</button>
          <button className={isPrimary('email')} disabled={!!busy || closed || !mailTo} title={mailTo ? '' : '取引先にメールアドレスがありません'} onClick={() => setConfirm('email')}>メールで送る</button>
          {!faxByPrint && <button className={isPrimary('fax')} disabled={!!busy || closed || !faxTo} title={sup.fax ? '' : '取引先に FAX 番号がありません'}
            onClick={() => setConfirm('fax')}>インターネットFAXで送る</button>}
          {o.status === 'draft' && <button className="btn" disabled={!!busy} onClick={() => setConfirm('printed')}>手で送った</button>}
          {!closed && dueEdit === null && <button className="btn" disabled={!!busy} onClick={() => setDueEdit(o.due_date ?? '')}>希望納期を変える</button>}
          {!closed && remarks === null && <button className="btn" disabled={!!busy} onClick={() => setRemarks(o.remarks)}>備考を書く</button>}
          {!closed && <button className="btn quiet" disabled={!!busy} onClick={() => setConfirm('cancel')}>取り消す</button>}
        </div>
        {dueEdit !== null && (
          <div className="confirm remarks-edit">
            <label htmlFor={`due-${o.id}`}>この発注書の希望納期</label>
            <div className="row">
              <input id={`due-${o.id}`} type="date" value={dueEdit} autoFocus onChange={e => setDueEdit(e.target.value)} />
              {dueEdit && <span className="small">「{jpDateW(dueEdit)}に{isPickup(o) ? '集荷に伺います' : '納品をお願いいたします'}。」と載ります</span>}
              {!dueEdit && <span className="small muted">空なら発注書に載りません</span>}
            </div>
            {o.status === 'sent' && <p className="warn small">この発注書は送信済みです。直した希望納期は相手に届いていません。直したあと、もう一度送ってください。</p>}
            <div className="row">
              <button className="btn primary" disabled={!!busy} onClick={saveDue}>{busy === 'due' ? '保存中…' : '希望納期を保存'}</button>
              <button className="btn" disabled={!!busy} onClick={() => setDueEdit(null)}>やめる</button>
            </div>
          </div>
        )}
        {remarks !== null && (
          <div className="confirm remarks-edit">
            <label htmlFor={`remarks-${o.id}`}>この発注書の備考</label>
            <textarea id={`remarks-${o.id}`} value={remarks} autoFocus onChange={e => setRemarks(e.target.value)} />
            {o.status === 'sent' && <p className="warn small">この発注書は送信済みです。直した備考は相手に届いていません。直したあと、もう一度送ってください。</p>}
            <div className="row">
              <button className="btn primary" disabled={!!busy} onClick={saveRemarks}>{busy === 'remarks' ? '保存中…' : '備考を保存'}</button>
              <button className="btn" disabled={!!busy} onClick={() => setRemarks(null)}>やめる</button>
            </div>
          </div>
        )}
        {faxByPrint && !closed && sup.send_method === 'fax' && <p className="muted small">FAX は、印刷して複合機・FAX 機から <b>{sup.fax || '（FAX 番号が未登録）'}</b> に送ってください。印刷画面のプリンターで複合機の FAX ドライバーを選んでも送れます。</p>}

        {confirm && (
          <div className="confirm">
            {confirm === 'email' && <p><b>{mailTo}</b> に、発注書の PDF（{fileName}）を付けてメールで送ります。</p>}
            {confirm === 'fax' && <p><b>FAX {sup.fax}</b> に送ります（インターネットFAX の宛先 {faxTo}）。</p>}
            {confirm === 'printed' && <p>印刷して FAX 機などで送ったことを記録します。</p>}
            {confirm === 'faxPrinted' && <p>印刷した発注書を、取引先に送れましたか（{sup.fax ? `FAX ${sup.fax}` : 'FAX'}・手渡しなど）？ 送れたら「送れた」を押してください。送信済みとして記録します。</p>}
            {confirm === 'cancel' && <p>この発注書を「取消」にします。{o.status === 'sent' && '送った相手には、別に取消の連絡をしてください。'}</p>}
            {o.status === 'sent' && (confirm === 'email' || confirm === 'fax') && <p className="warn">この発注書は送信済みです。もう一度送ります。</p>}
            <div className="row">
              <button className="btn primary" disabled={!!busy} onClick={() =>
                confirm === 'email' || confirm === 'fax' ? send(confirm)
                  : rpc(confirm === 'cancel' ? 'cancel_order' : 'mark_order_printed')}>
                {busy ? '処理中…' : confirm === 'email' ? 'メールを送る' : confirm === 'fax' ? 'FAX を送る'
                  : confirm === 'printed' ? '記録する' : confirm === 'faxPrinted' ? '送れた' : '取り消す'}
              </button>
              {confirm === 'faxPrinted' && <button className="btn" disabled={!!busy} onClick={() => printWithSave(false)}>もう一度印刷する</button>}
              <button className="btn" disabled={!!busy} onClick={() => setConfirm(null)}>{confirm === 'faxPrinted' ? 'まだ送っていない' : 'やめる'}</button>
            </div>
          </div>
        )}
        {error && <p className="msg">{error}</p>}
      </div>
      <div className="sheet-scroll"><OrderSheet ref={ref} order={o} settings={settings} fax={faxPrinting ? sup.fax : undefined} /></div>
    </section>
  )
}
