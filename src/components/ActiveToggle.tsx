import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { Item } from '../lib/types'

/** 商品の「使う／使わない」の切り替え。理由を書いてもらい、備考の先頭に残す（日付・内容・コメント・切り替えた人）。
 *  切り替えられるのは管理者だけ。商品の画面と発注画面で使う */
export default function ActiveToggle({ item: r, onDone }: { item: Item; onDone: (updated: Item) => void }) {
  const { isAdmin, profile, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toText = r.active ? '使わない' : '使う'

  async function save() {
    const to = !r.active
    const day = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
    const line = `${day} ${to ? '使う' : '使わない'}に変更：${comment.trim()}（${profile.name || profile.email}）`
    const note = r.note ? `${line}\n${r.note}` : line
    setBusy(true); setError('')
    const { error: e } = await supabase.from('items').update({ active: to, note }).eq('id', r.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    setOpen(false); setComment('')
    toast(`${r.name}を「${to ? '使う' : '使わない'}」にしました`)
    onDone({ ...r, active: to, note })
  }

  return (
    <div className="toggle-cell">
      <button type="button" role="switch" aria-checked={r.active} className={`mini-switch${r.active ? ' on' : ''}`} disabled={!isAdmin}
        aria-label={`${r.name}を${toText}にする`} title={isAdmin ? '押すと切り替えます（理由を備考に残します）' : '切り替えられるのは管理者だけです'}
        onClick={() => { setOpen(o => !o); setError('') }}>
        <span />{r.active ? '使う' : '使わない'}
      </button>
      {open && (
        <form className="toggle-form" onSubmit={e => { e.preventDefault(); save() }}>
          <label htmlFor={`tg-${r.id}`}>「{toText}」にする理由（備考に残ります）</label>
          <input id={`tg-${r.id}`} autoFocus required placeholder="例 取り扱い終了、季節商品のため" value={comment}
            onChange={e => setComment(e.target.value)} />
          <div className="row">
            <button className="btn small primary" disabled={busy || !comment.trim()}>{busy ? '保存中…' : `${toText}にする`}</button>
            <button type="button" className="btn small" onClick={() => setOpen(false)}>やめる</button>
          </div>
          {error && <p className="msg">{error}</p>}
        </form>
      )}
    </div>
  )
}
