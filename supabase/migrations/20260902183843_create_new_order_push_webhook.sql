create extension if not exists pg_net with schema extensions;

create or replace function public.send_new_order_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret
    into webhook_secret
  from vault.decrypted_secrets
  where name = 'order_push_webhook_secret'
  limit 1;

  if webhook_secret is null or webhook_secret = '' then
    raise warning 'Order push webhook secret is unavailable';
    return new;
  end if;

  perform net.http_post(
    url := 'https://chaxkujdkybcgekryudr.supabase.co/functions/v1/send-order-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', to_jsonb(new),
      'old_record', null
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    raise warning 'Order push webhook enqueue failed: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.send_new_order_push_webhook() from public;
revoke execute on function public.send_new_order_push_webhook() from anon, authenticated;

drop trigger if exists send_new_order_push on public.orders;
create trigger send_new_order_push
after insert on public.orders
for each row
execute function public.send_new_order_push_webhook();
