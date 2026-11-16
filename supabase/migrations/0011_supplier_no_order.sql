-- 取引先 100番台（生産者さん）は発注しない（代表 2026-11-16）
-- 「発注しない取引先」にすると、その取引先の商品は発注画面に出さず、在庫 CSV で数量も入れない
-- 取引先ごとに切り替えられるようにし、最初はコード 100〜199 を「発注しない」にする
-- 0010 のあとに入れる

alter table public.suppliers add column no_order boolean not null default false;
update public.suppliers set no_order = true where code ~ '^1[0-9]{2}$';
