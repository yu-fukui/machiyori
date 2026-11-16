import { useApp } from '../lib/app'
import { supabase } from '../lib/supabase'
import type { Store } from '../lib/types'
import { kindLabel, periodText } from '../lib/format'
import MasterTable, { type Field } from '../components/MasterTable'

export default function StoresPage() {
  const { stores, isAdmin, reload, toast } = useApp()

  const fields: Field<Store>[] = [
    { key: 'code', label: '店舗コード', required: true, placeholder: '例 A、CAR', help: '英数字1〜4文字。発注番号に入ります（PO-A-20261027-001）', render: r => <span className="chip">{r.code}</span> },
    { key: 'name', label: '名称（店名・外販の名前）', required: true, placeholder: '例 本店、丸岡城さくらまつり出店' },
    { key: 'kind', label: '種類', type: 'select', required: true,
      options: [{ value: 'fixed', label: kindLabel.fixed }, { value: 'mobile', label: kindLabel.mobile }], help: '外販は1回ごとに登録します（名称・場所・期間）', render: r => kindLabel[r.kind] },
    { key: 'start_date', label: '期間の始め（外販）', type: 'date', render: r => r.kind === 'mobile' ? (periodText(r) || <span className="muted">期間なし</span>) : '' },
    { key: 'end_date', label: '期間の終わり（外販）', type: 'date', help: '終わった外販は発注の画面に出なくなります', render: false },
    { key: 'zip', label: '郵便番号', render: false },
    { key: 'address', label: '住所（外販は会場の場所）' },
    { key: 'tel', label: '電話' },
    { key: 'fax', label: 'FAX', render: false },
    { key: 'email', label: 'メール', type: 'email', help: '取引先からの返信先にもなります', render: false },
    { key: 'person', label: '発注担当', render: false },
    { key: 'sort', label: '並び順', type: 'number', render: false },
    { key: 'active', label: '使う', type: 'checkbox', render: r => r.active ? '' : <span className="chip">使わない</span> },
  ]

  async function save(v: Partial<Store>, id: string | null) {
    const row = {
      code: String(v.code ?? '').trim().toUpperCase(), name: v.name?.trim(), kind: v.kind === 'mobile' ? 'mobile' : 'fixed',
      zip: v.zip ?? '', address: v.address ?? '', tel: v.tel ?? '', fax: v.fax ?? '', email: v.email ?? '',
      person: v.person ?? '', sort: Number(v.sort) || 0, active: v.active ?? true,
      start_date: v.kind === 'mobile' ? v.start_date || null : null,
      end_date: v.kind === 'mobile' ? v.end_date || null : null,
    }
    if (row.start_date && row.end_date && row.end_date < row.start_date) throw new Error('期間の終わりは、始めより後の日にしてください')
    if (!/^[A-Z0-9]{1,4}$/.test(row.code)) throw new Error('店舗コードは英数字1〜4文字にしてください')
    const { error } = id ? await supabase.from('stores').update(row).eq('id', id) : await supabase.from('stores').insert(row)
    if (error) throw error
    toast('保存しました'); await reload()
  }

  return (
    <MasterTable<Store>
      title="店舗"
      note="発注書の「販売場所」に載ります（発注元は「設定」の会社）。外販は1回ごとに、名称・会場の場所（住所）・期間を登録します。外販のときに選べる別の納品先の住所は「納品先」画面で登録します。直した内容は、これから作る発注書から反映されます（作った発注書はそのまま）。"
      rows={stores} fields={fields} canEdit={isAdmin} addLabel="店舗を追加"
      blank={{ kind: 'fixed', active: true, sort: 0, start_date: null, end_date: null }}
      onSave={save}
    />
  )
}
