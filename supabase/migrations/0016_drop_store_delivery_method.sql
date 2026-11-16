-- 0012 で店舗に足した「納品のしかた」はやめる（取引先ごとにした。0015）
-- 0015 のあと、画面を新しくしてから入れる

alter table public.stores drop column delivery_method;
