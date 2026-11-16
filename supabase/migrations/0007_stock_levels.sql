-- 在庫をデータベースに保存する（代表 2026-11-16）
-- ・週に1回、Airレジの在庫 CSV を発注画面で読み込む。読み込んだ在庫は、どのパソコンからでも同じものが見える
-- ・在庫は店舗ごと。読み込むたびに、その店舗の在庫をまるごと置き換える
-- 0006 のあとに入れる

-- ---------- 店舗ごとの在庫（いちばん新しく読み込んだもの） ----------
create table public.stock_levels (
  store_id uuid not null references public.stores (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  qty integer not null,   -- 在庫数（Airレジではマイナスもありうる）
  primary key (store_id, item_id)
);
alter table public.stock_levels enable row level security;
create policy stock_levels_read on public.stock_levels for select to authenticated using (public.is_staff());
revoke all on public.stock_levels from anon, authenticated;
grant select on public.stock_levels to authenticated;
grant select, insert, update, delete on public.stock_levels to service_role;

-- ---------- 読み込みの記録 ----------
create table public.stock_imports (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  file_name text not null default '',
  item_count integer not null default 0,   -- 商品と結びついた行
  miss_count integer not null default 0,   -- 商品が見つからなかった行
  imported_by uuid references public.profiles (id) on delete set null,
  imported_at timestamptz not null default now()
);
create index stock_imports_store_idx on public.stock_imports (store_id, imported_at desc);
alter table public.stock_imports enable row level security;
create policy stock_imports_read on public.stock_imports for select to authenticated using (public.is_staff());
revoke all on public.stock_imports from anon, authenticated;
grant select on public.stock_imports to authenticated;
grant select, insert, update, delete on public.stock_imports to service_role;

-- 在庫を読み込む：その店舗の在庫をまるごと置き換えて、記録を残す
-- p_rows は [{"item_id": "...", "qty": 12}, ...]
create function public.import_stock(p_store_id uuid, p_file text, p_miss int, p_rows jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  if not public.is_staff() then raise exception '権限がありません' using errcode = '42501'; end if;
  if not exists (select 1 from public.stores where id = p_store_id) then raise exception '店舗が見つかりません'; end if;

  delete from public.stock_levels where store_id = p_store_id;
  insert into public.stock_levels (store_id, item_id, qty)
  select p_store_id, x.item_id, round(x.qty)::int
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x (item_id uuid, qty numeric)
   where x.item_id is not null and x.qty is not null
     and exists (select 1 from public.items i where i.id = x.item_id)
  on conflict (store_id, item_id) do update set qty = excluded.qty;
  get diagnostics n = row_count;

  insert into public.stock_imports (store_id, file_name, item_count, miss_count, imported_by)
  values (p_store_id, left(coalesce(p_file, ''), 200), n, greatest(coalesce(p_miss, 0), 0), auth.uid());
end;
$$;
revoke execute on function public.import_stock(uuid, text, int, jsonb) from public, anon;
grant execute on function public.import_stock(uuid, text, int, jsonb) to authenticated;
