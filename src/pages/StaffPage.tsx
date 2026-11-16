import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { Profile, Role } from '../lib/types'
import { errorText } from '../lib/format'
import { loginIdOf } from '../lib/login'

const ROLE: Record<Role, string> = { pending: '使えない', staff: 'スタッフ', admin: '管理者' }

/** 関数 admin-users を呼ぶ。エラーのときは関数が返した文を投げる */
async function callAdmin(body: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const res = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(res?.error || errorText(error))
  }
}

const blank = { login_id: '', name: '', password: '', role: 'staff' as Role, default_store_id: '' }

export default function StaffPage() {
  const { profile: me, stores, toast } = useApp()
  const [list, setList] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [pwFor, setPwFor] = useState<string | null>(null)   // パスワードを決め直している人の id
  const [newPw, setNewPw] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setList((data ?? []) as Profile[])
  }, [])
  useEffect(() => { load() }, [load])

  async function update(p: Profile, patch: Partial<Profile>) {
    setError('')
    if (p.id === me.id && patch.role && patch.role !== 'admin') { setError('自分の管理者権限は外せません。ほかの管理者に頼んでください。'); return }
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) { setError(errorText(error)); return }
    toast('保存しました'); await load()
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await callAdmin({ action: 'create', ...form, default_store_id: form.default_store_id || null })
      toast(`アカウント「${form.login_id.trim().toLowerCase()}」を作りました`)
      setForm(blank); await load()
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  async function setPassword(p: Profile) {
    setError(''); setBusy(true)
    try {
      await callAdmin({ action: 'set_password', user_id: p.id, password: newPw })
      toast(`${p.name || loginIdOf(p.email)} さんのパスワードを変えました`)
      setPwFor(null); setNewPw('')
    } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>スタッフ</h2></div>
      <div className="note">アカウントは管理者がここで作ります。ID（半角英数字か、本人のメールアドレス）とパスワードを決めて、本人に伝えてください。パスワードを忘れた人がいたら「パスワードを決め直す」で新しいパスワードにします。商品・取引先・店舗・設定を直せるのは管理者だけです。</div>
      {error && <p className="msg">{error}</p>}

      <form className="toolbar" onSubmit={create}>
        <input aria-label="ID" placeholder="ID（半角英数字かメールアドレス）" autoCapitalize="none" spellCheck={false} required
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}|[^\s@]+@[^\s@]+\.[^\s@]+" title="メールアドレスか、半角の英数字（と . _ -）で3〜32文字"
          value={form.login_id} onChange={e => setForm({ ...form, login_id: e.target.value })} />
        <input aria-label="名前" placeholder="名前" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input aria-label="パスワード" placeholder="パスワード（8文字以上）" minLength={8} required autoComplete="new-password"
          value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <select aria-label="権限" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>
          <option value="staff">スタッフ</option><option value="admin">管理者</option>
        </select>
        <select aria-label="いつもの店舗" value={form.default_store_id} onChange={e => setForm({ ...form, default_store_id: e.target.value })}>
          <option value="">いつもの店舗 —</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn primary" disabled={busy}>アカウントを作る</button>
      </form>

      <div className="tbl-wrap">
        <table className="list">
          <thead><tr><th>名前</th><th>ID</th><th>権限</th><th>いつもの店舗</th><th>パスワード</th></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id}>
                <td><input aria-label="名前" defaultValue={p.name} onBlur={e => e.target.value !== p.name && update(p, { name: e.target.value })} /></td>
                <td><span className="chip">{loginIdOf(p.email)}</span></td>
                <td>
                  <select aria-label="権限" value={p.role} onChange={e => update(p, { role: e.target.value as Role })}>
                    {(Object.keys(ROLE) as Role[]).map(r => <option key={r} value={r}>{ROLE[r]}</option>)}
                  </select>
                </td>
                <td>
                  <select aria-label="いつもの店舗" value={p.default_store_id ?? ''} onChange={e => update(p, { default_store_id: e.target.value || null })}>
                    <option value="">—</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td>
                  {pwFor === p.id ? (
                    <span className="row">
                      <input aria-label="新しいパスワード" placeholder="新しいパスワード（8文字以上）" minLength={8} autoComplete="new-password"
                        value={newPw} onChange={e => setNewPw(e.target.value)} />
                      <button className="btn small primary" disabled={busy || newPw.length < 8} onClick={() => setPassword(p)}>このパスワードにする</button>
                      <button className="btn small" onClick={() => { setPwFor(null); setNewPw('') }}>やめる</button>
                    </span>
                  ) : (
                    <button className="btn small" onClick={() => { setPwFor(p.id); setNewPw('') }}>パスワードを決め直す</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">やめた人は権限を「使えない」にすると、ログインしても使えなくなります。</p>
    </section>
  )
}
