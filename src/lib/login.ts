/** 管理者が作るアカウントは「ID@machiyori.invalid」というメールアドレスで持つ（メールは送らない）。
 *  supabase/functions/admin-users と同じ決まり */
export const LOGIN_DOMAIN = 'machiyori.invalid'

/** ログイン画面の入力（ID かメールアドレス）を、ログインに使うメールアドレスにする */
export const toLoginEmail = (v: string) => {
  const t = v.trim().toLowerCase()
  return t.includes('@') ? t : `${t}@${LOGIN_DOMAIN}`
}

/** スタッフの一覧に出す ID（メールアドレスで登録した人はメールアドレスのまま） */
export const loginIdOf = (email: string) =>
  email.endsWith(`@${LOGIN_DOMAIN}`) ? email.slice(0, -LOGIN_DOMAIN.length - 1) : email
