-- 「最低 10」は発注する数の下限ではなく、発注ライン（最低在庫数）のこと（代表 2026-11-16）
-- ・発注ライン（min_stock）を一旦すべての商品で 10 にする。新しい商品も 10 から。あとで商品の CSV で直す
-- ・最低発注数（min_order_qty、0006 で足したもの）はやめる
-- 0007 のあとに入れる

update public.items set min_stock = 10;
alter table public.items alter column min_stock set default 10;

alter table public.items drop column min_order_qty;
