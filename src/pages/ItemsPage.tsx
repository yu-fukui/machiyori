import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import type { Item } from '../lib/types'
import { yen } from '../lib/format'
import { readCsv, writeCsv } from '../lib/csv'
import MasterTable, { type Field } from '../components/MasterTable'
import CsvImport from '../components/CsvImport'

const HEADERS = ['取引先コード', '取引先名', '品番（Airレジ）', '品名', '規格', '単位', '仕入れ価格', '販売価格', '税率', 'バーコード', '発注ライン', '設定在庫数', '使う']

/** 粗利率：販売価格（税込）から税を抜いた額に対する、仕入れ価格（税抜）との差 */
function marginText(i: Pick<Item, 'price' | 'sale_price' | 'tax_rate'>) {
  if (i.sale_price == null || i.sale_price <= 0) return ''
  const net = i.sale_price / (1 + i.tax_rate / 100)
  return `粗利 ${Math.round(((net - i.price) / net) * 100)}%`
}
const toYen = (v: string | undefined) => {
  const t = (v ?? '').replace(/[,¥円\s]/g, '')
  return t === '' ? null : Number(t)
}

export default function ItemsPage() {
  const { suppliers, isAdmin, toast } = useApp()
  const [items, setItems] = useState<Item[]>([])
  const [sup, setSup] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('items').select('*').order('code')
    setItems((data ?? []) as Item[])
  }, [])
  useEffect(() => { load() }, [load])

  const supName = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers])
  const rows = sup ? items.filter(i => i.supplier_id === sup) : items

  const fields: Field<Item>[] = [
    { key: 'supplier_id', label: '取引先', type: 'select', required: true,
      options: suppliers.map(s => ({ value: s.id, label: s.name })), render: r => <span className="sub">{supName[r.supplier_id]}</span> },
    { key: 'code', label: '品番（Airレジ）', help: 'Airレジに登録した商品ID。在庫 CSV の「商品ID」と結びつけます', render: r => <span className="chip">{r.code}</span> },
    { key: 'name', label: '品名', required: true },
    { key: 'spec', label: '規格', placeholder: '例 500ml×12' },
    { key: 'unit', label: '単位', placeholder: '例 ケース' },
    { key: 'price', label: '仕入れ価格（税抜・円）', type: 'number', required: true, numeric: true, help: '発注書にはこの価格が載ります', render: r => yen(r.price) },
    { key: 'sale_price', label: '販売価格（税込・円）', type: 'number', numeric: true, help: '空でもかまいません',
      render: r => r.sale_price == null ? <span className="muted">—</span> : <>{yen(r.sale_price)}<div className="sub">{marginText(r)}</div></> },
    { key: 'tax_rate', label: '税率', type: 'select', required: true,
      options: [{ value: '10', label: '10%' }, { value: '8', label: '8%（軽減）' }], render: r => `${r.tax_rate}%` },
    { key: 'barcode', label: 'バーコード', help: '品番（Airレジ）で見つからないとき、在庫 CSV の「バーコード」と結びつけます', render: false },
    { key: 'min_stock', label: '発注ライン', type: 'number', numeric: true, help: '手で発注するときの目安です。在庫がこの数を下回ると、発注画面の行が赤くなります',
      render: r => r.min_stock == null ? <span className="muted">—</span> : r.min_stock },
    { key: 'target_stock', label: '設定在庫数', type: 'number', numeric: true, help: '在庫 CSV から数量を自動で入れるとき、「設定在庫数 − 在庫」を数量にします。空なら自動で入れません',
      render: r => r.target_stock == null ? <span className="muted">—</span> : r.target_stock },
    { key: 'active', label: '使う（発注画面に出す）', type: 'checkbox', render: r => r.active ? '' : <span className="chip">使わない</span> },
  ]

  async function save(v: Partial<Item>, id: string | null) {
    const row = {
      supplier_id: v.supplier_id, code: v.code?.toString().trim() || null, name: v.name?.trim(),
      spec: v.spec ?? '', unit: v.unit || '個', price: Math.round(Number(v.price) || 0),
      sale_price: v.sale_price == null || (v.sale_price as unknown) === '' ? null : Math.round(Number(v.sale_price)),
      tax_rate: Number(v.tax_rate) === 8 ? 8 : 10, barcode: v.barcode?.toString().trim() ?? '',
      min_stock: v.min_stock == null || (v.min_stock as unknown) === '' ? null : Math.max(0, Math.round(Number(v.min_stock))),
      target_stock: v.target_stock == null || (v.target_stock as unknown) === '' ? null : Math.max(0, Math.round(Number(v.target_stock))),
      active: v.active ?? true,
    }
    const { error } = id ? await supabase.from('items').update(row).eq('id', id) : await supabase.from('items').insert(row)
    if (error) throw error
    toast('保存しました'); await load()
  }

  async function remove(r: Item) {
    const { error } = await supabase.from('items').delete().eq('id', r.id)
    if (error) throw error
    await load()
  }

  function exportCsv() {
    const byId = Object.fromEntries(suppliers.map(s => [s.id, s]))
    writeCsv(items.map(i => ({
      取引先コード: byId[i.supplier_id]?.code ?? '', 取引先名: byId[i.supplier_id]?.name ?? '', '品番（Airレジ）': i.code ?? '', 品名: i.name,
      規格: i.spec, 単位: i.unit, 仕入れ価格: i.price, 販売価格: i.sale_price ?? '', 税率: i.tax_rate,
      バーコード: i.barcode, 発注ライン: i.min_stock ?? '', 設定在庫数: i.target_stock ?? '', 使う: i.active ? '1' : '0',
    })), HEADERS, '商品.csv')
  }

  async function parse(file: File) {
    const raw = await readCsv(file)
    const errors: string[] = []
    const out: Record<string, unknown>[] = []
    raw.forEach((r, n) => {
      const line = n + 2
      const s = suppliers.find(x => (r['取引先コード'] && x.code === r['取引先コード']) || (!r['取引先コード'] && x.name === r['取引先名']))
      if (!s) { errors.push(`${line}行目：取引先「${r['取引先コード'] || r['取引先名'] || '（空）'}」が見つかりません`); return }
      if (!r['品名']) { errors.push(`${line}行目：品名が空です`); return }
      // 前のひな形の「単価」も仕入れ価格として読む
      const priceText = r['仕入れ価格'] ?? r['単価']
      const price = toYen(priceText)
      if (price === null || !Number.isFinite(price) || price < 0) { errors.push(`${line}行目：仕入れ価格「${priceText ?? ''}」が数字ではありません`); return }
      const sale = toYen(r['販売価格'])
      if (sale !== null && (!Number.isFinite(sale) || sale < 0)) { errors.push(`${line}行目：販売価格「${r['販売価格']}」が数字ではありません`); return }
      const rate = (r['税率'] ?? '').replace(/[%％\s]/g, '')
      // 前のひな形の「最低在庫数」の列も発注ラインとして読む
      const lineCol = '発注ライン' in r ? '発注ライン' : '最低在庫数' in r ? '最低在庫数' : null
      const minStock = lineCol ? toYen(r[lineCol]) : null
      if (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) { errors.push(`${line}行目：発注ライン「${r[lineCol!]}」が数字ではありません`); return }
      const target = toYen(r['設定在庫数'])
      if (target !== null && (!Number.isFinite(target) || target < 0)) { errors.push(`${line}行目：設定在庫数「${r['設定在庫数']}」が数字ではありません`); return }
      // 品番は「品番（Airレジ）」の列、なければ前のひな形の「品番」の列から読む
      const code = (r['品番（Airレジ）'] ?? r['品番'] ?? '').replace(/^'/, '').trim()
      out.push({
        supplier_id: s.id, code: code || null, name: r['品名'], spec: r['規格'] ?? '', unit: r['単位'] || '個',
        price: Math.round(price),
        // 販売価格の列がない CSV（前のひな形）では、登録ずみの販売価格を消さない
        ...('販売価格' in r ? { sale_price: sale === null ? null : Math.round(sale) } : {}),
        // バーコード・発注ライン・設定在庫数の列がない CSV では、登録ずみの値を変えない
        ...('バーコード' in r ? { barcode: (r['バーコード'] ?? '').replace(/^['#]/, '').trim() } : {}),
        ...(lineCol ? { min_stock: minStock === null ? null : Math.round(minStock) } : {}),
        ...('設定在庫数' in r ? { target_stock: target === null ? null : Math.round(target) } : {}),
        tax_rate: rate === '8' ? 8 : 10, active: !['0', 'いいえ', '×', 'false'].includes(r['使う'] ?? ''),
      })
    })
    const known = new Set(items.filter(i => i.code).map(i => `${i.supplier_id}|${i.code}`))
    const existing = out.filter(r => r.code && known.has(`${r.supplier_id}|${r.code}`)).length
    return { rows: out, errors, existing }
  }

  async function importRows(rows: Record<string, unknown>[], addOnly: boolean) {
    // 同じコードが CSV に2回あると取り込めないので、後ろの行を使う
    const withCode = [...new Map(rows.filter(r => r.code).map(r => [`${r.supplier_id}|${r.code}`, r])).values()]
    const noCode = rows.filter(r => !r.code)
    if (withCode.length) {
      const { error } = await supabase.from('items').upsert(withCode, { onConflict: 'supplier_id,code', ignoreDuplicates: addOnly })
      if (error) throw error
    }
    if (noCode.length) {
      const { error } = await supabase.from('items').insert(noCode)
      if (error) throw error
    }
    await load()
  }

  return (
    <MasterTable<Item>
      title="商品"
      note={<>仕入れ価格は税抜、販売価格は税込で入れます。発注書には仕入れ価格が載ります。品番が同じ商品は CSV の読み込みで上書きされます。使わなくなった商品は「使う」のチェックを外すと、発注画面に出なくなります（過去の発注書はそのまま）。</>}
      rows={rows} fields={fields} canEdit={isAdmin} addLabel="商品を追加"
      blank={{ supplier_id: sup || suppliers[0]?.id, unit: '個', price: 0, tax_rate: 10, barcode: '', min_stock: 10, target_stock: 18, active: true }}
      search={(r, k) => `${r.code ?? ''} ${r.name} ${r.spec} ${r.barcode} ${supName[r.supplier_id] ?? ''}`.toLowerCase().includes(k)}
      onSave={save} onDelete={remove}
      toolbar={<>
        <select aria-label="取引先" value={sup} onChange={e => setSup(e.target.value)}>
          <option value="">すべての取引先</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn" onClick={exportCsv}>CSV 書き出し</button>
        {isAdmin && <CsvImport headers={HEADERS} parse={parse} importRows={importRows} unit="品"
          help="取引先は「取引先コード」で結びつけます。コードが空なら「取引先名」で探します。税率は 8 か 10。品番（Airレジ）は Airレジの商品ID（前のひな形の「品番」の列も読みます）。発注ライン・設定在庫数は空でもかまいません（設定在庫数が空なら、在庫 CSV で数量が自動で入りません）。CSV にない商品は消えません。品番（Airレジ）が空の行は、毎回新しく追加します。" />}
      </>}
    />
  )
}
