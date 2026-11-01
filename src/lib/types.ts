export type Role = 'pending' | 'staff' | 'admin'

export interface Profile {
  id: string
  email: string
  name: string
  role: Role
  default_store_id: string | null
}

export interface Store {
  id: string
  code: string
  name: string
  kind: 'fixed' | 'mobile'
  zip: string
  address: string
  tel: string
  fax: string
  email: string
  person: string
  delivery_note: string
  active: boolean
  sort: number
  start_date: string | null   // 外販の期間
  end_date: string | null
}

export interface Supplier {
  id: string
  code: string | null
  name: string
  attention: string
  email: string
  fax: string
  tel: string
  send_method: 'fax' | 'email'
  note: string
  active: boolean
}

export interface Item {
  id: string
  supplier_id: string
  code: string | null
  name: string
  spec: string
  unit: string
  price: number              // 仕入れ価格（税抜）。発注書にはこれを載せる
  sale_price: number | null  // 販売価格（税込）
  tax_rate: 8 | 10
  active: boolean
}

export interface DeliveryPlace {
  id: string
  name: string
  zip: string
  address: string
  tel: string
  note: string
  active: boolean
  sort: number
}

export type DeliveryType = 'store' | 'pickup' | 'address' | 'venue'

export interface DeliverySnapshot {
  type: DeliveryType
  name: string
  zip: string
  address: string
  tel: string
  note: string
}

export interface Settings {
  fax_gateway: string
  tax_round: 'floor' | 'round' | 'ceil'
  reply_to: string
  drive_folder_id: string
}

export interface OrderLine {
  id: string
  line_no: number
  item_id: string | null   // 商品を消したあとは空
  code: string | null
  name: string
  spec: string
  unit: string
  price: number
  tax_rate: number
  qty: number
}

export interface Order {
  id: string
  order_no: string
  store_id: string
  supplier_id: string
  order_date: string
  due_date: string | null
  remarks: string
  store_snapshot: Store
  supplier_snapshot: Supplier
  subtotal: number
  tax: number
  total: number
  tax_detail: { rate: number; base: number; tax: number }[]
  status: 'draft' | 'sent' | 'cancelled'
  pdf_path: string | null
  delivery_type: DeliveryType
  delivery_time: string
  delivery_snapshot: DeliverySnapshot | null
  drive_url: string | null
  drive_saved_at: string | null
  created_by: string | null
  orderer?: { name: string; email: string } | null   // 発注した人（profiles）
  sent_via: 'email' | 'fax' | 'print' | null
  sent_to: string | null
  sent_at: string | null
  saved_at: string | null   // 履歴に残した日時。空は「作っただけ」
  created_at: string
  order_lines?: OrderLine[]
}
