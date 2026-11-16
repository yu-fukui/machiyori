import Papa from 'papaparse'
import { downloadBlob } from './pdf'

/** Excel の CSV は Shift_JIS のことが多い。UTF-8 で読めなければ Shift_JIS で読み直す */
export async function readCsv(file: File): Promise<Record<string, string>[]> {
  const buf = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buf)
  if (text.includes('�')) text = new TextDecoder('shift_jis').decode(buf)
  text = text.replace(/^﻿/, '')
  // Airレジの CSV は1行目が「"v200"」のような版の行で、列名は2行目にある。
  // Excel で保存し直すと「v200,,,,」になることもあるので、中身が1つ以下の先頭の行は飛ばす
  for (;;) {
    const first = text.split(/\r?\n/, 1)[0]
    const filled = first.split(',').filter(c => c.replace(/"/g, '').trim() !== '').length
    if (filled > 1 || first.length === text.length) break
    text = text.slice(first.length).replace(/^\r?\n/, '')
  }
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: h => h.trim(),
    transform: v => v.trim(),
  })
  return res.data
}

/** Excel でそのまま開けるよう BOM 付き UTF-8 で書き出す */
export function writeCsv(rows: Record<string, string | number>[], headers: string[], filename: string) {
  const csv = Papa.unparse({ fields: headers, data: rows.map(r => headers.map(h => r[h] ?? '')) })
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv' }), filename)
}
