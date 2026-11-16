import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { Settings } from '../lib/types'
import { errorText, faxAddress } from '../lib/format'

/** フォルダの URL から ID を取り出す（ID をそのまま貼ってもよい） */
function folderId(text: string) {
  const t = text.trim()
  return t.match(/folders\/([\w-]+)/)?.[1] ?? t.match(/[?&]id=([\w-]+)/)?.[1] ?? t
}

export default function SettingsPage() {
  const { settings, reload, toast } = useApp()
  const [v, setV] = useState<Settings>(settings)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setV(settings), [settings])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (v.fax_gateway && !v.fax_gateway.includes('{fax}')) { setError('宛先の形に {fax} を入れてください（FAX 番号が入る場所）。'); return }
    setBusy(true)
    const { error } = await supabase.from('settings').update({ ...v, updated_at: new Date().toISOString() }).eq('id', 1)
    setBusy(false)
    if (error) { setError(errorText(error)); return }
    toast('保存しました'); await reload()
  }

  return (
    <form className="panel narrow-wide" onSubmit={save}>
      <h2>設定</h2>

      <h3>発注書</h3>
      <div className="note">発注書の右上に「発注元」として載せる会社の情報と、支払条件です。店舗は「販売場所」として載ります。ご担当者は、店舗に担当者があればそちらを載せます。</div>
      <div className="field"><label htmlFor="cname">会社名</label>
        <input id="cname" value={v.company_name} onChange={e => setV({ ...v, company_name: e.target.value })} /></div>
      <div className="field"><label htmlFor="czip">郵便番号</label>
        <input id="czip" value={v.company_zip} placeholder="例 910-0000" onChange={e => setV({ ...v, company_zip: e.target.value })} /></div>
      <div className="field"><label htmlFor="caddr">住所</label>
        <input id="caddr" value={v.company_address} onChange={e => setV({ ...v, company_address: e.target.value })} /></div>
      <div className="field"><label htmlFor="ctel">電話</label>
        <input id="ctel" value={v.company_tel} onChange={e => setV({ ...v, company_tel: e.target.value })} /></div>
      <div className="field"><label htmlFor="cfax">FAX</label>
        <input id="cfax" value={v.company_fax} placeholder="空なら載せません" onChange={e => setV({ ...v, company_fax: e.target.value })} /></div>
      <div className="field"><label htmlFor="cperson">ご担当者</label>
        <input id="cperson" value={v.company_person} onChange={e => setV({ ...v, company_person: e.target.value })} /></div>
      <div className="field"><label htmlFor="terms">支払条件</label>
        <input id="terms" value={v.payment_terms} placeholder="例 月末締翌月末振込" onChange={e => setV({ ...v, payment_terms: e.target.value })} /></div>

      <h3>インターネットFAX（メールtoFAX）</h3>
      <div className="note">
        契約したサービスが決めている「FAX を送るときのメールの宛先」の形を入れます。<code>{'{fax}'}</code> のところに取引先の FAX 番号（数字だけ）が入ります。
        サービスによっては、送信元のメールアドレスを先にサービスへ登録しておく必要があります（README を見てください）。
      </div>
      <div className="field">
        <label htmlFor="gw">宛先の形</label>
        <input id="gw" value={v.fax_gateway} placeholder="例 {fax}@（サービスのドメイン）" onChange={e => setV({ ...v, fax_gateway: e.target.value.trim() })} />
        {v.fax_gateway && <span className="muted small">例：FAX 0776-11-2222 → {faxAddress(v.fax_gateway, '0776-11-2222')}</span>}
      </div>

      <h3>Google ドライブへの保存</h3>
      <div className="note">
        発注書のボタン（PDFを保存・印刷・メール・FAX）を押すたびに、発注書の PDF をこのフォルダに保存します（月ごとのフォルダに分けます）。
        受け取り役の Google Apps Script を先に用意してください（README の「Google ドライブへの保存」）。空なら保存しません。
      </div>
      <div className="field">
        <label htmlFor="drive">保存先フォルダの ID か URL</label>
        <input id="drive" value={v.drive_folder_id} placeholder="例 https://drive.google.com/drive/folders/1AbC…"
          onChange={e => setV({ ...v, drive_folder_id: folderId(e.target.value) })} />
        <span className="muted small">フォルダを開いたときのアドレスをそのまま貼れます。ID だけが保存されます。</span>
      </div>

      <h3>メール</h3>
      <div className="field">
        <label htmlFor="reply">返信先のメールアドレス</label>
        <input id="reply" type="email" value={v.reply_to} onChange={e => setV({ ...v, reply_to: e.target.value.trim() })} />
        <span className="muted small">取引先が発注メールに返信したときの宛先。空なら店舗のメールアドレス。</span>
      </div>

      <h3>消費税</h3>
      <div className="field">
        <label htmlFor="round">端数の処理（税率ごと・発注書ごと）</label>
        <select id="round" value={v.tax_round} onChange={e => setV({ ...v, tax_round: e.target.value as Settings['tax_round'] })}>
          <option value="floor">切り捨て</option><option value="round">四捨五入</option><option value="ceil">切り上げ</option>
        </select>
      </div>

      {error && <p className="msg">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
    </form>
  )
}
