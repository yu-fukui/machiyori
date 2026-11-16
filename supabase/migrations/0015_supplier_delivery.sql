-- 納品のしかたは取引先ごと（代表 2026-11-16）
-- 取引先に「納品」（配達／集荷）を登録する。発注書は取引先ごとなので、その取引先の納品のしかたを載せる。集荷は発注書に目立つように出す
-- 発注書の supplier_snapshot（to_jsonb(取引先)）にこの列も入るので、作った発注書の納品のしかたはあとで変わらない
-- 0014 のあとに入れる

alter table public.suppliers
  add column delivery_method text not null default 'delivery' check (delivery_method in ('delivery', 'pickup'));   -- delivery：配達、pickup：集荷
