-- 希望納期は発注書ごとに決める（代表 2026-11-16）
-- 発注画面で取引先ごとに入れた希望納期を、作った発注書に書く。発注書の画面でも1枚ずつ直せる
-- 行は RLS（orders_pdf：is_staff()）で絞る。列は希望納期だけ書けるようにする
-- 0017 のあとに入れる

grant update (due_date) on public.orders to authenticated;
