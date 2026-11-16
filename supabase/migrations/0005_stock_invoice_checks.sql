-- 店舗の発注担当者へのヒアリングから（代表 2026-11-16）
-- ・商品に最低在庫数とバーコードを持たせる。Airレジの在庫 CSV を読み、最低在庫数を下回った商品に発注数を入れる
-- ・取引先に区分（買取・委託）を持たせる
-- ・月締めの請求書チェック：取引先ごと・月ごとに、請求額とチェック済みを記録する

alter table public.items
  add column barcode text not null default '',                          -- Airレジの在庫 CSV と結びつける（品番でも結びつく）
  add column min_stock integer check (min_stock is null or min_stock >= 0);   -- 最低在庫数。空なら自動で発注数を入れない

alter table public.suppliers
  add column deal_type text not null default '' check (deal_type in ('', 'buy', 'consign', 'both'));   -- 買取・委託・両方

-- ---------- 請求書チェック ----------
create table public.invoice_checks (
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  month date not null check (extract(day from month) = 1),   -- その月の1日
  invoice_amount integer check (invoice_amount is null or invoice_amount >= 0),   -- 請求書の金額（税込・円）
  checked boolean not null default false,
  note text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (supplier_id, month)
);
alter table public.invoice_checks enable row level security;
create policy invoice_checks_staff on public.invoice_checks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
revoke all on public.invoice_checks from anon, authenticated;
grant select, insert, update on public.invoice_checks to authenticated;
grant select, insert, update, delete on public.invoice_checks to service_role;
