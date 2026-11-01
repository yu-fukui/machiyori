import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { go, useApp } from '../lib/app'
import type { Order } from '../lib/types'
import { errorText, faxAddress, jpDateTime, readLocal, statusLabel, viaLabel, writeLocal } from '../lib/format'
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
        {orders.length > 1 && <button className="btn" onClick={() => print(orders.map(o => o.id))}>すべて印刷</button>}
        <span className="muted small">{orders.length}枚。{unsaved.length > 0 ? '送る（メール・FAX・印刷・PDFを保存）と履歴に残ります。' : ''}</span>
      </div>
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
          onPrint={(fax, after) => print([o.id], fax, after)} />
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

function SheetBlock({ order: o, reload, printTarget, faxPrinting, onPrint }: {
  order: Order; reload: () => Promise<void>; printTarget: boolean; faxPrinting: boolean
  onPrint: (fax?: boolean, after?: () => void) => void
}) {
  const { suppliers, settings, toast } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState<'email' | 'fax' | 'printed' | 'faxPrinted' | 'cancel' | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [remarks, setRemarks] = useState<string | null>(null)   // 備考を書いているあいだの文

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
  async function printWithSave(fax: boolean) {
    setBusy('print'); setError(''); setConfirm(null)
    try { await keep() } catch (e) { setError(`履歴に残せませんでした：${errorText(e)}`) }
    try {
      if (settings.drive_folder_id) { await uploadPdf(); void saveToDrive() }
    } catch (e) { setError(`Google ドライブ用の PDF を作れませんでした：${errorText(e)}`) }
    finally { setBusy('') }
    if (!o.saved_at) void reload()
    if (fax) onPrint(true, () => setConfirm(o.status === 'draft' ? 'faxPrinted' : null))
    else onPrint()
  }

  async function send(via: 'email' | 'fax') {
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
      toast(via === 'email' ? `${data.to} にメールで送りました` : `FAX の送信を受け付けました（${sup.fax}）。結果はメールで届きます`)
      setConfirm(null)
      await reload()
    } catch (e) { setError(errorText(e)) }
    finally { setBusy('') }
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

  const faxPrint = () => printWithSave(true)

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
          <button className="btn" disabled={!!busy} onClick={() => printWithSave(false)}>{busy === 'print' ? '準備中…' : '印刷'}</button>
          <button className={isPrimary('email')} disabled={!!busy || closed || !mailTo} title={mailTo ? '' : '取引先にメールアドレスがありません'} onClick={() => setConfirm('email')}>メールで送る</button>
          <button className={isPrimary('fax')} disabled={!!busy || closed || !(faxTo || faxByPrint)} title={sup.fax ? '' : '取引先に FAX 番号がありません'}
            onClick={() => faxByPrint ? faxPrint() : setConfirm('fax')}>{faxByPrint ? 'FAXで送る（印刷）' : 'FAXで送る'}</button>
          {o.status === 'draft' && <button className="btn" disabled={!!busy} onClick={() => setConfirm('printed')}>手で送った</button>}
          {!closed && remarks === null && <button className="btn" disabled={!!busy} onClick={() => setRemarks(o.remarks)}>備考を書く</button>}
          {!closed && <button className="btn quiet" disabled={!!busy} onClick={() => setConfirm('cancel')}>取り消す</button>}
        </div>
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
        {faxByPrint && !closed && <p className="muted small">「FAXで送る（印刷）」を押すと、FAX 用の発注書を印刷します。印刷画面のプリンターで複合機の FAX ドライバー（または FAX 機）を選び、宛先に <b>{sup.fax}</b> を入れて送ってください。</p>}

        {confirm && (
          <div className="confirm">
            {confirm === 'email' && <p><b>{mailTo}</b> に、発注書の PDF（{fileName}）を付けてメールで送ります。</p>}
            {confirm === 'fax' && <p><b>FAX {sup.fax}</b> に送ります（インターネットFAX の宛先 {faxTo}）。</p>}
            {confirm === 'printed' && <p>印刷して FAX 機などで送ったことを記録します。</p>}
            {confirm === 'faxPrinted' && <p><b>FAX {sup.fax}</b> に送れましたか？ 送れたら「送れた」を押してください。送信済みとして記録します。</p>}
            {confirm === 'cancel' && <p>この発注書を「取消」にします。{o.status === 'sent' && '送った相手には、別に取消の連絡をしてください。'}</p>}
            {o.status === 'sent' && (confirm === 'email' || confirm === 'fax') && <p className="warn">この発注書は送信済みです。もう一度送ります。</p>}
            <div className="row">
              <button className="btn primary" disabled={!!busy} onClick={() =>
                confirm === 'email' || confirm === 'fax' ? send(confirm)
                  : rpc(confirm === 'cancel' ? 'cancel_order' : 'mark_order_printed')}>
                {busy ? '処理中…' : confirm === 'email' ? 'メールを送る' : confirm === 'fax' ? 'FAX を送る'
                  : confirm === 'printed' ? '記録する' : confirm === 'faxPrinted' ? '送れた' : '取り消す'}
              </button>
              {confirm === 'faxPrinted' && <button className="btn" disabled={!!busy} onClick={faxPrint}>もう一度印刷する</button>}
              <button className="btn" disabled={!!busy} onClick={() => setConfirm(null)}>{confirm === 'faxPrinted' ? 'まだ送っていない' : 'やめる'}</button>
            </div>
          </div>
        )}
        {error && <p className="msg">{error}</p>}
      </div>
      <div className="sheet-scroll"><OrderSheet ref={ref} order={o} fax={faxPrinting ? sup.fax : undefined} /></div>
    </section>
  )
}
