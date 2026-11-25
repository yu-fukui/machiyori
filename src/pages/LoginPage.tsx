import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorText } from '../lib/format'
import { toLoginEmail } from '../lib/login'

// アカウントは管理者が「スタッフ」の画面で作る。自分での登録はしない
export default function LoginPage() {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(loginId), password })
      if (error) throw error
    } catch (err) {
      const t = errorText(err)
      setMsg(t.includes('Invalid login') ? 'ID かパスワードが違います。' : t)
    } finally { setBusy(false) }
  }

  return (
    <main className="center">
      <form className="panel narrow" onSubmit={submit}>
        <h1 className="login-brand"><span className="brand-mark" aria-hidden="true">ま</span>まちより 発注</h1>
        <p className="muted">管理者から受け取った ID とパスワードでログインしてください。</p>
        <div className="field"><label htmlFor="login-id">ID（またはメールアドレス）</label>
          <input id="login-id" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={loginId} onChange={e => setLoginId(e.target.value)} required /></div>
        <div className="field"><label htmlFor="password">パスワード</label>
          <input id="password" type="password" autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)} required /></div>
        {msg && <p className="msg">{msg}</p>}
        <button className="btn primary wide" disabled={busy}>ログイン</button>
        <p className="muted small">パスワードを忘れたときは、管理者に新しいパスワードを決めてもらってください。</p>
      </form>
    </main>
  )
}
