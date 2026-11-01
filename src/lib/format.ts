import type { Order } from './types'

export const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
export const num = (n: number) => Math.round(n).toLocaleString('ja-JP')

export function jpDate(s: string | null | undefined) {
  if (!s) return ''
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${y}年${+m}月${+d}日`
}

export function jpDateTime(s: string | null | undefined) {
  if (!s) return ''
  return new Date(s).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** FAX 番号を数字だけにして、メールtoFAX の宛先の形に入れる */
export function faxAddress(gateway: string, fax: string) {
  const digits = fax.replace(/\D/g, '')
  if (!gateway || !digits) return ''
  return gateway.split('{fax}').join(digits)
}

export const methodLabel = { fax: 'FAX', email: 'メール' } as const
export const kindLabel = { fixed: '実店舗', mobile: '外販' } as const
export const deliveryLabel = { venue: '外販の会場に納品', store: '店舗に納品', pickup: '集荷', address: '指定の住所' } as const

const md = (s: string) => { const [, m, d] = s.split('-'); return `${+m}/${+d}` }
/** 外販の期間（例 4/1〜4/10）。日付がなければ空 */
export function periodText(s: { start_date: string | null; end_date: string | null }) {
  if (!s.start_date && !s.end_date) return ''
  if (s.start_date && (!s.end_date || s.end_date === s.start_date)) return md(s.start_date)
  return `${s.start_date ? md(s.start_date) : ''}〜${s.end_date ? md(s.end_date) : ''}`
}
/** 今日（日本時間）を YYYY-MM-DD で */
export const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
export const statusLabel = { draft: '下書き', sent: '送信済み', cancelled: '取消' } as const
export const viaLabel = { email: 'メール', fax: 'FAX', print: '印刷・FAX機' } as const

export function errorText(e: unknown) {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export function readLocal(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
export function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* 保存できなくても動く */ }
}

/** 発注書・メールに出す納品先と日時。納品先を選べるようになる前の発注書は、店の情報から作る */
export function deliveryLines(o: Pick<Order, 'delivery_type' | 'delivery_time' | 'delivery_snapshot' | 'due_date' | 'store_snapshot'>) {
  const d = o.delivery_snapshot
  const pickup = o.delivery_type === 'pickup'
  const when = [o.due_date ? jpDate(o.due_date) : '', o.delivery_time].filter(Boolean).join(' ') || 'ご相談'
  let where: string
  if (!d) {
    const st = o.store_snapshot as { name: string; delivery_note?: string }
    where = st.delivery_note || `${st.name}（上記住所）`
  } else if (pickup) {
    where = '集荷（貴社へ引き取りに伺います）'
  } else {
    where = [d.name, [d.zip && `〒${d.zip}`, d.address].filter(Boolean).join(' '), d.tel && `TEL ${d.tel}`].filter(Boolean).join('　')
  }
  return {
    whenLabel: pickup ? '集荷日時' : '納品希望日時',
    when,
    whereLabel: pickup ? '受け渡し' : '納品先',
    where,
    note: d?.note ?? '',
  }
}
