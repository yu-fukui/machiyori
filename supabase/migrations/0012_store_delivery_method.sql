-- 納品のしかたを店舗ごとに決める（代表 2026-11-16）
-- 店舗に「店舗納品」か「集荷」を登録し、発注画面ではその店舗の納品のしかたをはじめに選ぶ（発注ごとに変えてもよい）
-- 発注書にも「納品方法」を載せる（orders.delivery_type から。データベースの変更はこの列だけ）
-- 0011 のあとに入れる

alter table public.stores
  add column delivery_method text not null default 'store' check (delivery_method in ('store', 'pickup'));   -- store：店舗納品（外販は会場に納品）、pickup：集荷
