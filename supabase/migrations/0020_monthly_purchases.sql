-- 仕入れを月ごとに手で入れる（代表 2026-11-26「仕入れを直接入力する欄がなかったので、作ってほしい」）
-- ・発注書を使っていない月（このシステムを使う前など）や、発注書を通さない仕入れの分を入れる
-- ・画面の「仕入れ」は、発注書の合計 ＋ ここで入れた金額
-- お金の情報なので、読むのも書くのも管理者だけ

create table public.monthly_purchases (
  store_id uuid not null references public.stores (id) on delete cascade,
  month date not null check (extract(day from month) = 1),   -- その月の1日
  amount integer not null check (amount >= 0),               -- 仕入れ（税込・円）
  note text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, month)
);

alter table public.monthly_purchases enable row level security;
create policy monthly_purchases_admin on public.monthly_purchases for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.monthly_purchases from anon, authenticated;
grant select, insert, update, delete on public.monthly_purchases to authenticated;
grant select, insert, update, delete on public.monthly_purchases to service_role;
