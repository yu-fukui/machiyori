-- 月ごとの売上と経費を入れて集計する（代表 2026-11-25「月ごとの売り上げ、それからその他の経費を入力して、集計する」）
-- ・売上は手で月の合計（税込）を入れる（代表「売上は手入力します」）
-- ・経費は項目ごと（家賃・人件費など。項目は管理者が足せる）
-- ・仕入れは発注書の合計（税込・取消を除く・履歴に残ったもの）から画面で集計する
-- お金の情報なので、読むのも書くのも管理者だけ

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.expense_categories (name, sort) values
  ('人件費', 10), ('家賃', 20), ('水道光熱費', 30), ('送料・運賃', 40), ('消耗品', 50),
  ('広告・販促', 60), ('手数料（決済・振込）', 70), ('その他', 90);

create table public.monthly_sales (
  store_id uuid not null references public.stores (id) on delete cascade,
  month date not null check (extract(day from month) = 1),   -- その月の1日
  amount integer not null check (amount >= 0),               -- 売上（税込・円）
  note text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, month)
);

create table public.monthly_expenses (
  store_id uuid not null references public.stores (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_id uuid not null references public.expense_categories (id) on delete restrict,
  amount integer not null check (amount >= 0),               -- 経費（税込・円）
  note text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, month, category_id)
);

alter table public.expense_categories enable row level security;
alter table public.monthly_sales enable row level security;
alter table public.monthly_expenses enable row level security;
create policy expense_categories_admin on public.expense_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy monthly_sales_admin on public.monthly_sales for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy monthly_expenses_admin on public.monthly_expenses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.expense_categories, public.monthly_sales, public.monthly_expenses from anon, authenticated;
grant select, insert, update on public.expense_categories to authenticated;
grant select, insert, update, delete on public.monthly_sales, public.monthly_expenses to authenticated;
grant select, insert, update, delete on public.expense_categories, public.monthly_sales, public.monthly_expenses to service_role;
