// スタッフのアカウントを管理者が作る・パスワードを決め直す（代表 2026-11-16）
// 使う人が限られているので、自分での登録はやめ、管理者が ID とパスワードを決める。
// ID はメールアドレスでもよい。メールアドレスでない ID は「ID@machiyori.invalid」というメールアドレスに直して使う（どちらもメールは送らない）。
// 呼べるのはログインした管理者だけ。秘密の値は Supabase が関数に自動で渡すもの（SUPABASE_SERVICE_ROLE_KEY）だけを使う。
import { createClient } from 'npm:@supabase/supabase-js@2.95.3'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** 画面の src/lib/login.ts と同じ決まり */
const LOGIN_DOMAIN = 'machiyori.invalid'
const ID_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES = ['staff', 'admin', 'pending']

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST で呼んでください' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 呼んだ人が管理者か確かめる
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'ログインし直してください' }, 401)
  const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') return json({ error: '管理者だけができます' }, 403)

  const body = await req.json().catch(() => ({}))
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 8) return json({ error: 'パスワードは8文字以上にしてください' }, 400)

  if (body.action === 'create') {
    const id = String(body.login_id ?? '').trim().toLowerCase()
    const name = String(body.name ?? '').trim()
    const role = ROLES.includes(body.role) ? body.role : 'staff'
    const isEmail = id.includes('@')
    if (isEmail ? !EMAIL_RE.test(id) || id.length > 254 : !ID_RE.test(id)) {
      return json({ error: 'ID は、メールアドレスか、半角の英小文字・数字（と . _ -）で3〜32文字にしてください' }, 400)
    }
    if (!name) return json({ error: '名前を入れてください' }, 400)

    const { data, error } = await admin.auth.admin.createUser({
      email: isEmail ? id : `${id}@${LOGIN_DOMAIN}`, password, email_confirm: true, user_metadata: { name, login_id: id },
    })
    if (error || !data.user) {
      const t = error?.message ?? ''
      return json({ error: /already|registered|exists/i.test(t) ? `ID「${id}」はもう使われています` : `作れませんでした：${t}` }, 400)
    }
    // 登録のトリガーが「承認待ち」で作った profiles を、選んだ権限・店舗にする
    const { error: e2 } = await admin.from('profiles')
      .update({ name, role, default_store_id: body.default_store_id || null }).eq('id', data.user.id)
    if (e2) return json({ error: `アカウントは作れましたが、権限を保存できませんでした：${e2.message}` }, 500)
    return json({ ok: true, id: data.user.id })
  }

  if (body.action === 'set_password') {
    const userId = String(body.user_id ?? '')
    if (!userId) return json({ error: 'スタッフの指定がありません' }, 400)
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return json({ error: `パスワードを変えられませんでした：${error.message}` }, 400)
    return json({ ok: true })
  }

  return json({ error: 'action の指定が正しくありません' }, 400)
})
