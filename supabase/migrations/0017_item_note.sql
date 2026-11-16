-- 商品に備考（代表 2026-11-16）
-- 商品の「使う／使わない」を一覧で切り替えるときは、理由を備考に残す（日付・切り替えた内容・コメント・切り替えた人）
-- 0016 のあとに入れる（0016 より先に入れてもかまわない）

alter table public.items add column note text not null default '';
