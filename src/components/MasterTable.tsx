import { type ReactNode, useMemo, useState } from 'react'
import { errorText } from '../lib/format'

type Value = string | number | boolean | null

export interface Field<T> {
  key: keyof T & string
  label: string
  type?: 'text' | 'number' | 'email' | 'date' | 'select' | 'checkbox' | 'textarea'
  options?: { value: string; label: string }[]
  required?: boolean
  placeholder?: string
  help?: string
  /** 一覧に出すときの書き方。false なら一覧に出さない */
  render?: ((row: T) => ReactNode) | false
  numeric?: boolean
  /** false なら編集フォームに出さない（一覧で切り替える項目など） */
  form?: false
}

interface Props<T extends { id: string }> {
  title: string
  note?: ReactNode
  rows: T[]
  fields: Field<T>[]
  blank: Partial<T>
  canEdit: boolean
  addLabel: string
  search?: (row: T, q: string) => boolean
  toolbar?: ReactNode
  onSave: (values: Partial<T>, id: string | null) => Promise<void>
  onDelete?: (row: T) => Promise<void>
}

/** 商品・取引先・店舗の一覧と編集（同じ形の画面をまとめたもの） */
export default function MasterTable<T extends { id: string }>(p: Props<T>) {
  const [editing, setEditing] = useState<{ id: string | null; values: Partial<T> } | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k && p.search ? p.rows.filter(r => p.search!(r, k)) : p.rows
  }, [p.rows, q, p.search])

  const listFields = p.fields.filter(f => f.render !== false)
  const set = (key: string, v: Value) => setEditing(e => e && { ...e, values: { ...e.values, [key]: v } })

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true); setError('')
    try { await p.onSave(editing.values, editing.id); setEditing(null) }
    catch (err) { setError(friendly(errorText(err))) }
    finally { setBusy(false) }
  }

  async function remove(row: T) {
    setBusy(true); setError('')
    try { await p.onDelete!(row); setDeleting(null) }
    catch (err) { setError(friendly(errorText(err))) }
    finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{p.title}</h2>
        <span className="muted small">{rows.length === p.rows.length ? `${p.rows.length}件` : `${rows.length} / ${p.rows.length}件`}</span>
      </div>
      {p.note && <div className="note">{p.note}</div>}
      <div className="toolbar">
        {p.search && <input type="search" className="grow" placeholder="探す" aria-label="探す" value={q} onChange={e => setQ(e.target.value)} />}
        {p.canEdit && <button className="btn primary" onClick={() => { setEditing({ id: null, values: { ...p.blank } }); setError('') }}>{p.addLabel}</button>}
        {p.toolbar}
      </div>

      {editing && (
        <form className="edit-form" onSubmit={save}>
          <h3>{editing.id ? '編集' : p.addLabel}</h3>
          <div className="form-grid">
            {p.fields.filter(f => f.form !== false).map(f => {
              const v = editing.values[f.key] as Value | undefined
              const id = `f-${f.key}`
              if (f.type === 'checkbox') return (
                <label key={f.key} className="check"><input id={id} type="checkbox" checked={Boolean(v)} onChange={e => set(f.key, e.target.checked)} />{f.label}</label>
              )
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={id} title={f.label}>{f.label}{f.required && ' *'}</label>
                  {f.type === 'textarea'
                    ? <textarea id={id} value={String(v ?? '')} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)} />
                    : f.type === 'select'
                    ? <select id={id} value={String(v ?? '')} required={f.required} onChange={e => set(f.key, e.target.value)}>
                        {!f.required && <option value="">—</option>}
                        {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    : <input id={id} type={f.type ?? 'text'} value={v === null || v === undefined ? '' : String(v)}
                        required={f.required} placeholder={f.placeholder} min={f.type === 'number' ? 0 : undefined}
                        onChange={e => set(f.key, f.type === 'number' || f.type === 'date'
                          ? (e.target.value === '' ? null : f.type === 'number' ? Number(e.target.value) : e.target.value)
                          : e.target.value)} />}
                  {f.help && <span className="muted small">{f.help}</span>}
                </div>
              )
            })}
          </div>
          {error && <p className="msg">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>やめる</button>
          </div>
        </form>
      )}
      {!editing && error && <p className="msg">{error}</p>}

      <div className="tbl-wrap">
        <table className="list">
          <thead><tr>
            {listFields.map(f => <th key={f.key} className={f.numeric ? 'num' : undefined}>{f.label}</th>)}
            {p.canEdit && <th />}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                {listFields.map(f => (
                  <td key={f.key} className={f.numeric ? 'num' : undefined}>
                    {f.render ? f.render(r) : String((r[f.key] as Value) ?? '')}
                  </td>
                ))}
                {p.canEdit && (
                  <td className="actions">
                    {deleting === r.id ? <>
                      <button className="btn small danger" disabled={busy} onClick={() => remove(r)}>削除する</button>
                      <button className="btn small" onClick={() => setDeleting(null)}>やめる</button>
                    </> : <>
                      <button className="btn small" onClick={() => { setEditing({ id: r.id, values: { ...r } }); setError(''); window.scrollTo({ top: 0 }) }}>編集</button>
                      {p.onDelete && <button className="btn small quiet" onClick={() => setDeleting(r.id)}>削除</button>}
                    </>}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={listFields.length + 1} className="muted">まだありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function friendly(msg: string) {
  if (msg.includes('duplicate key')) return '同じコード（品番）がもうあります。別のコードにしてください。'
  if (msg.includes('foreign key')) return 'ほかのデータで使われているので削除できません。「使う」のチェックを外すと、一覧に出なくなります。'
  if (msg.includes('row-level security') || msg.includes('permission denied')) return 'この操作は管理者だけができます。'
  return msg
}
