-- 発注書を作っただけでは履歴に残さない（代表 2026-10-29）
-- ・送る操作（メール・FAX・印刷・PDF保存・手で送った）をしたら履歴に残す
-- ・何もせずに「発注画面へ」を押したら、保存するかをたずねる。保存する → 下書き（status draft）として履歴に残す
--   保存しない → その発注書は消し、発注画面のかごに数量を戻す
-- saved_at が空の発注書は「作っただけ」。履歴と「発注の多い順」には数えない

alter table public.orders add column saved_at timestamptz;
update public.orders set saved_at = created_at;   -- これまでの発注書は全部履歴に残す
create index orders_saved_idx on public.orders (saved_at) where saved_at is null;

-- 下書きとして保存する（PDF保存・印刷のときも画面がこれを呼ぶ）
create function public.save_orders(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception '権限がありません' using errcode = '42501'; end if;
  update public.orders set saved_at = now() where id = any (p_ids) and saved_at is null;
end;
$$;

-- 保存しない：作っただけの発注書を消す（自分が作った、まだ履歴にないものだけ）
-- 発注番号の連番は、その日の残っている番号のいちばん大きいものに戻す（次の発注書が続きの番号になるように）
create function public.discard_orders(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  if not public.is_staff() then raise exception '権限がありません' using errcode = '42501'; end if;
  for r in
    delete from public.orders
     where id = any (p_ids) and saved_at is null and created_by = auth.uid()
    returning store_id, order_date
  loop
    update public.order_counters c
       set n = coalesce((select max(substring(o.order_no from '[0-9]+$')::int) from public.orders o
                          where o.store_id = r.store_id and o.order_date = r.order_date), 0)
     where c.store_id = r.store_id and c.day = r.order_date;
  end loop;
end;
$$;

revoke execute on function public.save_orders(uuid[]), public.discard_orders(uuid[]) from public, anon;
grant execute on function public.save_orders(uuid[]), public.discard_orders(uuid[]) to authenticated;

-- 手で送った・取消も履歴に残す
create or replace function public.mark_order_printed(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception '権限がありません' using errcode = '42501'; end if;
  update public.orders
     set status = 'sent', sent_via = 'print', sent_to = coalesce(supplier_snapshot ->> 'fax', ''),
         sent_at = now(), sent_by = auth.uid(), saved_at = coalesce(saved_at, now())
   where id = p_order_id and status = 'draft';
  if found then
    insert into public.send_logs (order_id, via, to_addr, ok, detail, sent_by)
    values (p_order_id, 'print', '', true, '印刷して手で送信', auth.uid());
  end if;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then raise exception '権限がありません' using errcode = '42501'; end if;
  update public.orders set status = 'cancelled', saved_at = coalesce(saved_at, now()) where id = p_order_id;
end;
$$;

-- 発注の多い順は、履歴に残った発注書だけで数える
create or replace function public.item_order_stats(p_store_id uuid)
returns table (item_id uuid, times int, qty int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select l.item_id, count(*)::int, sum(l.qty)::int
  from public.order_lines l join public.orders o on o.id = l.order_id
  where o.store_id = p_store_id and o.status <> 'cancelled' and o.saved_at is not null and l.item_id is not null
  group by l.item_id;
$$;
