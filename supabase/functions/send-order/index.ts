// 発注書を送る：メールで取引先へ、または メールtoFAX のサービスへ（PDF を添付）
// 呼べるのはログインしたスタッフだけ。送信は Gmail（SMTP・アプリ パスワード）を使う。
// Supabase の Edge Function は 25・587 番ポートに出られないので、465 番（SSL）で送る。
//
// 必要な秘密の値（Supabase の Edge Functions → Secrets に入れる。リポジトリには書かない）
//   GMAIL_USER          送信に使う Gmail のアドレス。FAX サービスにはこのアドレスを送信元として登録する
//   GMAIL_APP_PASSWORD  その Gmail のアプリ パスワード（16文字）
//   MAIL_FROM_NAME      送信者の名前（なくてもよい。例 まちより 発注）
import { createClient } from 'npm:@supabase/supabase-js@2.95.3'
import nodemailer from 'npm:nodemailer@7.0.13'
import { Buffer } from 'node:buffer'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
const jpDate = (s: string | null) => {
  if (!s) return 'ご相談'
  const [y, m, d] = s.split('-')
  return `${y}年${+m}月${+d}日`
}

// 納品先と日時（発注書の「納品希望日時」「納品先」と同じ書き方）
function deliveryText(order: Record<string, any>, store: Record<string, any>) {
  const d = order.delivery_snapshot
  const pickup = order.delivery_type === 'pickup'
  const when = [order.due_date ? jpDate(order.due_date) : '', order.delivery_time].filter(Boolean).join(' ') || 'ご相談'
  let where: string
  if (!d) where = store.delivery_note || store.name
  else if (pickup) where = '集荷（貴社へ引き取りに伺います）'
  else where = [d.name, [d.zip && `〒${d.zip}`, d.address].filter(Boolean).join(' '), d.tel && `TEL ${d.tel}`].filter(Boolean).join('　')
  return [
    `${pickup ? '集荷日時' : '納品希望日時'}：${when}`,
    `${pickup ? '受け渡し' : '納品先'}：${where}`,
    ...(d?.note ? [`　${d.note}`] : []),
  ]
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST で呼んでください' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')?.replace(/\s/g, '')
  if (!gmailUser || !gmailPass) return json({ error: 'メール送信の設定（GMAIL_USER・GMAIL_APP_PASSWORD）がありません' }, 500)

  // 呼んだ人を確かめる
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'ログインし直してください' }, 401)
  const { data: me } = await admin.from('profiles').select('role, name').eq('id', user.id).single()
  if (!me || !['staff', 'admin'].includes(me.role)) return json({ error: '送信する権限がありません' }, 403)

  const { order_id, via } = await req.json().catch(() => ({}))
  if (typeof order_id !== 'string' || !['email', 'fax'].includes(via)) return json({ error: '送り先の指定が正しくありません' }, 400)

  const { data: order } = await admin.from('orders').select('*, order_lines(*), suppliers(*)').eq('id', order_id).single()
  if (!order) return json({ error: '発注書が見つかりません' }, 404)
  if (order.status === 'cancelled') return json({ error: '取消した発注書は送れません' }, 409)
  if (!order.pdf_path) return json({ error: '発注書の PDF がありません。もう一度お試しください' }, 400)
  const { data: settings } = await admin.from('settings').select('*').eq('id', 1).single()

  const sup = order.suppliers
  const store = order.store_snapshot
  let to = ''
  if (via === 'email') {
    to = (sup.email ?? '').trim()
    if (!to) return json({ error: '取引先にメールアドレスがありません' }, 400)
  } else {
    const digits = (sup.fax ?? '').replace(/\D/g, '')
    if (!settings?.fax_gateway) return json({ error: 'インターネットFAX の宛先が設定されていません' }, 400)
    if (!digits) return json({ error: '取引先に FAX 番号がありません' }, 400)
    to = settings.fax_gateway.split('{fax}').join(digits)
  }

  const file = await admin.storage.from('order-pdfs').download(order.pdf_path)
  if (file.error || !file.data) return json({ error: '発注書の PDF を読めませんでした' }, 500)
  const pdf = Buffer.from(await file.data.arrayBuffer())

  const lines = [...order.order_lines].sort((a, b) => a.line_no - b.line_no)
  const subject = via === 'email' ? `【発注書】${order.order_no} ${store.name}` : `発注書 ${order.order_no}`
  // FAX サービスは本文を送り状にすることがあるので、FAX のときは短くする
  const text = via === 'fax'
    ? `${sup.name} ${sup.attention || '御中'}\n${store.name}より発注書をお送りします（${order.order_no}）。`
    : [
        `${sup.name} ${sup.attention || '御中'}`,
        '',
        `いつもお世話になっております。${store.name}の${store.person || me.name || ''}です。`,
        '下記のとおり発注いたします。発注書（PDF）を添付しております。',
        '',
        `発注番号：${order.order_no}`,
        ...deliveryText(order, store),
        '',
        ...lines.map(l => `${l.line_no}. ${l.code ?? ''} ${l.name} ${l.spec}　${l.qty}${l.unit}`),
        '',
        `合計（税込）：${yen(order.total)}`,
        ...(order.remarks ? ['', `備考：${order.remarks}`] : []),
        '',
        'お手数ですが、ご確認のほどよろしくお願いいたします。',
        '',
        store.name,
        [store.tel && `TEL ${store.tel}`, store.fax && `FAX ${store.fax}`].filter(Boolean).join(' / '),
      ].join('\n')

  const replyTo = settings?.reply_to || store.email || undefined
  let ok = true
  let detail = ''
  try {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gmailUser, pass: gmailPass },
    })
    const info = await transport.sendMail({
      from: { name: Deno.env.get('MAIL_FROM_NAME') || store.name, address: gmailUser },
      to, replyTo, subject, text,
      attachments: [{ filename: `${order.order_no}.pdf`, content: pdf, contentType: 'application/pdf' }],
    })
    detail = `${info.messageId ?? ''} ${info.response ?? ''}`.trim()
  } catch (e) {
    ok = false
    detail = String(e instanceof Error ? e.message : e)
  }

  await admin.from('send_logs').insert({ order_id, via, to_addr: to, ok, detail: detail.slice(0, 1000), sent_by: user.id })
  if (!ok) {
    const hint = /auth|credentials|535/i.test(detail) ? 'Gmail のアドレスかアプリ パスワードが違います。' : ''
    return json({ error: `送信できませんでした。${hint}（${detail.slice(0, 200)}）` }, 502)
  }

  await admin.from('orders').update({
    status: 'sent', sent_via: via, sent_to: to, sent_at: new Date().toISOString(), sent_by: user.id,
    saved_at: order.saved_at ?? new Date().toISOString(),   // 送ったら履歴に残す
  }).eq('id', order_id)
  return json({ ok: true, to })
})
