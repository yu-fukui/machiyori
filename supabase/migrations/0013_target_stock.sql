-- 発注ラインと設定在庫数を分ける（代表 2026-11-16）
-- ・発注ライン（min_stock）：手で発注するときの目安。在庫がこれを下回ると発注画面の行が赤くなる
-- ・設定在庫数（target_stock）：在庫 CSV から数量を自動で入れるとき、「設定在庫数 − 在庫」を数量にする。空なら自動で入れない
-- 0012 のあとに入れる

alter table public.items
  add column target_stock integer check (target_stock is null or target_stock >= 0);
