-- 代表 2026-11-16
-- ・「バーコード」の欄には Airレジの登録ID（商品ID）を入れるので、名前を「品番（Airレジ）」（airregi_code）にする
-- ・商品に最低発注数を持たせる。いまある商品は一旦すべて 10。新しい商品も 10 から始める
-- 0005 のあとに入れる

alter table public.items rename column barcode to airregi_code;   -- Airレジの商品ID。在庫 CSV の「商品ID」と結びつける

alter table public.items
  add column min_order_qty integer not null default 10 check (min_order_qty >= 1);   -- 最低発注数。在庫 CSV で発注数を入れるときは、これより少なくしない
