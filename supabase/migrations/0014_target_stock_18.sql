-- 設定在庫数を一旦すべての商品で 18 にする。新しい商品も 18 から（代表 2026-11-16）。あとで商品の CSV で直す
-- 0013 のあとに入れる

update public.items set target_stock = 18;
alter table public.items alter column target_stock set default 18;
