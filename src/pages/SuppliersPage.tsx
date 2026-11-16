import { useApp } from '../lib/app'
import { supabase } from '../lib/supabase'
import type { Supplier } from '../lib/types'
import { dealLabel, methodLabel } from '../lib/format'
import { readCsv, writeCsv } from '../lib/csv'
import MasterTable, { type Field } from '../components/MasterTable'
import CsvImport from '../components/CsvImport'

const HEADERS = ['取引先コード', '取引先名', '区分', '宛名', 'メール', 'FAX', '電話', '送り方', 'メモ', '使う']
const DEAL_BY_LABEL: Record<string, Supplier['deal_type']> = { 買取: 'buy', 買: 'buy', 委託: 'consign', 委: 'consign', '買取・委託': 'both', '買・委': 'both' }

export default function SuppliersPage() {
  const { suppliers, isAdmin, reload, toast } = useApp()

  const fields: Field<Supplier>[] = [
    { key: 'code', label: '取引先コード', help: 'CSV で商品と結びつけるときに使います', render: r => <span className="chip">{r.code}</span> },
    { key: 'name', label: '取引先名', required: true },
    { key: 'deal_type', label: '区分', type: 'select',
      options: [{ value: '', label: '（なし）' }, { value: 'buy', label: '買取' }, { value: 'consign', label: '委託' }, { value: 'both', label: '買取・委託' }],
      render: r => r.deal_type ? <span className="chip">{dealLabel[r.deal_type]}</span> : '' },
    { key: 'attention', label: '宛名', placeholder: '例 営業部 御中', render: false },
    { key: 'send_method', label: '送り方', type: 'select', required: true,
      options: [{ value: 'fax', label: 'FAX' }, { value: 'email', label: 'メール' }], render: r => <span className="chip">{methodLabel[r.send_method]}</span> },
    { key: 'fax', label: 'FAX' },
    { key: 'email', label: 'メール', type: 'email' },
    { key: 'tel', label: '電話' },
    { key: 'note', label: 'メモ', render: false },
    { key: 'no_order', label: '発注しない（発注画面に出さない）', type: 'checkbox', help: '生産者さんなど発注しない取引先。商品は発注画面に出ず、在庫 CSV で数量も入りません',
      render: r => r.no_order ? <span className="chip">発注しない</span> : '' },
    { key: 'active', label: '使う', type: 'checkbox', render: r => r.active ? '' : <span className="chip">使わない</span> },
  ]

  const clean = (v: Partial<Supplier>) => ({
    code: v.code?.toString().trim() || null, name: v.name?.trim(), attention: v.attention?.trim() || '御中',
    email: v.email?.trim() ?? '', fax: v.fax?.trim() ?? '', tel: v.tel?.trim() ?? '',
    send_method: v.send_method === 'email' ? 'email' : 'fax',
    deal_type: (['buy', 'consign', 'both'] as const).find(d => d === v.deal_type) ?? '', note: v.note ?? '', active: v.active ?? true,
    // CSV には列がないので、CSV の読み込みでは登録ずみの値を変えない
    ...(v.no_order !== undefined ? { no_order: !!v.no_order } : {}),
  })

  async function save(v: Partial<Supplier>, id: string | null) {
    const row = clean(v)
    const { error } = id ? await supabase.from('suppliers').update(row).eq('id', id) : await supabase.from('suppliers').insert(row)
    if (error) throw error
    toast('保存しました'); await reload()
  }

  async function remove(r: Supplier) {
    const { error } = await supabase.from('suppliers').delete().eq('id', r.id)
    if (error) throw error
    await reload()
  }

  function exportCsv() {
    writeCsv(suppliers.map(s => ({
      取引先コード: s.code ?? '', 取引先名: s.name, 区分: dealLabel[s.deal_type], 宛名: s.attention, メール: s.email, FAX: s.fax, 電話: s.tel,
      送り方: methodLabel[s.send_method], メモ: s.note, 使う: s.active ? '1' : '0',
    })), HEADERS, '取引先.csv')
  }

  async function parse(file: File) {
    const raw = await readCsv(file)
    const errors: string[] = []
    const rows: Record<string, unknown>[] = []
    raw.forEach((r, n) => {
      if (!r['取引先名']) { errors.push(`${n + 2}行目：取引先名が空です`); return }
      rows.push(clean({
        code: r['取引先コード'], name: r['取引先名'], attention: r['宛名'], email: r['メール'], fax: r['FAX'], tel: r['電話'],
        send_method: /メール|mail/i.test(r['送り方'] ?? '') ? 'email' : 'fax', note: r['メモ'],
        deal_type: DEAL_BY_LABEL[(r['区分'] ?? '').replace(/\s/g, '')] ?? '',
        active: !['0', 'いいえ', '×', 'false'].includes(r['使う'] ?? ''),
      }))
    })
    const known = new Set(suppliers.filter(s => s.code).map(s => s.code))
    const existing = rows.filter(r => r.code && known.has(r.code as string)).length
    return { rows, errors, existing }
  }

  async function importRows(rows: Record<string, unknown>[], addOnly: boolean) {
    // 同じコードが CSV に2回あると取り込めないので、後ろの行を使う
    const withCode = [...new Map(rows.filter(r => r.code).map(r => [String(r.code), r])).values()]
    const noCode = rows.filter(r => !r.code)
    if (withCode.length) {
      const { error } = await supabase.from('suppliers').upsert(withCode, { onConflict: 'code', ignoreDuplicates: addOnly })
      if (error) throw error
    }
    if (noCode.length) {
      const { error } = await supabase.from('suppliers').insert(noCode)
      if (error) throw error
    }
    await reload()
  }

  return (
    <MasterTable<Supplier>
      title="取引先"
      note="「送り方」はおもに使う方法です。発注書の画面で、その送り方のボタンが強調されます。FAX 番号はハイフンがあっても大丈夫です。"
      rows={suppliers} fields={fields} canEdit={isAdmin} addLabel="取引先を追加"
      blank={{ attention: '御中', send_method: 'fax', deal_type: '', no_order: false, active: true }}
      search={(r, k) => `${r.code ?? ''} ${r.name} ${r.fax} ${r.email} ${r.tel}`.toLowerCase().includes(k)}
      onSave={save} onDelete={remove}
      toolbar={<>
        <button className="btn" onClick={exportCsv}>CSV 書き出し</button>
        {isAdmin && <CsvImport headers={HEADERS} parse={parse} importRows={importRows} unit="件"
          help="取引先コードが同じものは上書きします。送り方は「FAX」か「メール」。" />}
      </>}
    />
  )
}
