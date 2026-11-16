import { forwardRef } from 'react'
import type { Order, Settings } from '../lib/types'
import { deliveryLines, deliveryMethodText, eraDate, isPickup, num, yen } from '../lib/format'

const MIN_ROWS = 10

/** A4 の発注書。現場の様式（発注書 FAX 用.xlsx）に合わせた並び。画面のテーマに関係なく白い紙。
 *  発注元は会社（設定）、店舗は「販売場所」。fax を渡すと、上に FAX の送り状の欄を付ける（FAX 用に印刷するとき） */
const OrderSheet = forwardRef<HTMLDivElement, { order: Order; settings: Settings; fax?: string }>(function OrderSheet({ order: o, settings: cs, fax }, ref) {
  const s = o.supplier_snapshot
  const st = o.store_snapshot
  const lines = [...(o.order_lines ?? [])].sort((a, b) => a.line_no - b.line_no)
  const blanks = Math.max(0, MIN_ROWS - (fax ? 3 : 0) - lines.length)  // FAX の欄の分だけ空行を減らして A4 1枚に収める
  const hasReduced = o.tax_detail.some(t => t.rate === 8)
  const dl = deliveryLines(o)
  const from = cs.company_name || st.name                  // 会社名が未設定なら店舗名
  const person = st.person || cs.company_person
  const fromTel = cs.company_tel || st.tel
  const fromFax = cs.company_name ? cs.company_fax : st.fax

  return (
    <div className="sheet" ref={ref}>
      {o.status === 'cancelled' && <div className="sheet-void">取消</div>}
      {fax && (
        <div className="sheet-fax">
          <div><span>FAX 送信先</span><b>{fax}</b>　{s.name} {s.attention || '御中'}</div>
          <div><span>送信元</span>{from}{fromFax && `　FAX ${fromFax}`}{fromTel && `　TEL ${fromTel}`}</div>
          <div><span>送信枚数</span>1枚（この用紙を含む）</div>
        </div>
      )}
      <div className="sheet-meta"><span>発注日　{eraDate(o.order_date)}</span><span className="sub">発注番号 {o.order_no}</span></div>
      <h1 className="sheet-title">発注書</h1>
      {isPickup(o) && <div className="sheet-pickup">集荷</div>}
      <div className="sheet-parties">
        <div className="sheet-to">
          <div className="name">{s.name}　<span className="nowrap">{s.attention || '御中'}</span></div>
          <div>{s.tel && `TEL ${s.tel}`}　{s.fax && `FAX ${s.fax}`}</div>
        </div>
        <div className="sheet-from">
          <div className="name">{from}</div>
          {cs.company_name
            ? (cs.company_zip || cs.company_address) && <div>{cs.company_zip && <>〒{cs.company_zip}<br /></>}{cs.company_address}</div>
            : (st.zip || st.address) && <div>{st.zip && <>〒{st.zip}<br /></>}{st.address}</div>}
          {(fromTel || fromFax) && <div>{fromTel && `TEL: ${fromTel}`}{fromFax && `　FAX: ${fromFax}`}</div>}
          {person && <div>ご担当者：{person}</div>}
        </div>
      </div>
      <p className="sheet-lead">下記の通り、発注致します。</p>
      <div className="sheet-sum"><div>合計金額</div><div>{yen(o.total)}（税込）</div></div>
      <div className="sheet-info">
        {dl.hasWhen && <><div>{dl.whenLabel}</div><div>{dl.when}</div></>}
        {cs.payment_terms && <><div>支払条件</div><div>{cs.payment_terms}</div></>}
        <div>販売場所</div><div>{st.name}</div>
        {deliveryMethodText(o) && <><div>納品方法</div><div className={isPickup(o) ? 'sheet-strong' : undefined}>{deliveryMethodText(o)}</div></>}
        <div>{dl.whereLabel}</div><div>{dl.where}{dl.note && <><br />{dl.note}</>}</div>
      </div>
      <table className="sheet-table">
        <thead><tr>
          <th>品番・品名</th>
          <th style={{ width: '15mm' }}>数量</th><th style={{ width: '15mm' }}>単位</th><th style={{ width: '22mm' }}>単価</th><th style={{ width: '26mm' }}>金額</th>
        </tr></thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id}>
              <td>{l.code && <span className="sheet-code">{l.code}</span>}{l.name}{l.spec && `　${l.spec}`}{l.tax_rate === 8 && ' ※'}</td>
              <td className="r">{num(l.qty)}</td><td className="c">{l.unit}</td><td className="r">{num(l.price)}</td><td className="r">{num(l.price * l.qty)}</td>
            </tr>
          ))}
          {Array.from({ length: blanks }, (_, i) => <tr key={'b' + i}>{Array.from({ length: 5 }, (_, j) => <td key={j} />)}</tr>)}
        </tbody>
      </table>
      <div className="sheet-bottom">
        <div className="sheet-remarks"><span>備考：</span>{o.remarks}</div>
        <table className="sheet-totals">
          <tbody>
            <tr><td>小計</td><td className="r">{num(o.subtotal)}</td></tr>
            {o.tax_detail.map(t => <tr key={t.rate}><td>消費税（{t.rate}%）</td><td className="r">{num(t.tax)}</td></tr>)}
            <tr><td>合計金額</td><td className="r"><b>{num(o.total)}</b></td></tr>
          </tbody>
        </table>
      </div>
      {hasReduced && <div className="sheet-note">※は軽減税率（8%）対象</div>}
    </div>
  )
})

export default OrderSheet
