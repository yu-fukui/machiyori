-- 0006 の取り違えを直す（代表 2026-11-16）
-- 「ID は Airレジの登録ID なので品番（Airレジ）に」は、いまの「品番」（items.code）の呼び名を変える意味だった。
-- 0006 で airregi_code にした列には Airレジのバーコードが入っているので、名前を barcode に戻す。
-- 0008 のあとに入れる

alter table public.items rename column airregi_code to barcode;   -- Airレジのバーコード（在庫 CSV の「バーコード」の # を除いたもの）
