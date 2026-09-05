# Supabase SQL Command Notes

Simple SQL notes for the L&K Sandwiches project.

Last reviewed: September 2026

## Where to run a command

1. Open the Supabase project.
2. Select **SQL Editor** in the left sidebar.
3. Select **New query**.
4. Paste one command.
5. Read it again before selecting **Run**.

SQL commands normally end with a semicolon: `;`

Text after `--` is a comment. PostgreSQL ignores it.

```sql
-- This is a comment and will not change the database.
select * from public.products;
```

## Safety rules

- Use `SELECT` first to confirm which rows you found.
- Never run `UPDATE` or `DELETE` without checking its `WHERE` condition.
- Export important data before deleting it.
- `DELETE`, `TRUNCATE`, and most SQL Editor changes do not have an Undo button.
- Never use `TRUNCATE ... CASCADE` unless you completely understand every related table.
- Do not reset order numbers after real customer orders begin.
- Never put a Supabase `service_role` or secret key in public website files.

## Important tables in this project

| Table | What it contains |
| --- | --- |
| `public.products` | Menu items, names, prices, category IDs and photos |
| `public.orders` | Customer orders and order numbers |
| `public.site_settings` | Categories, slideshow and store settings |
| `public.admin_users` | Users allowed to perform protected admin operations |
| `public.push_subscriptions` | Devices registered for new-order notifications |

## Common SQL words

| Command | Meaning |
| --- | --- |
| `SELECT` | Read data without changing it |
| `FROM` | Choose the table |
| `WHERE` | Choose only matching rows |
| `ORDER BY` | Sort the result |
| `LIMIT` | Return only a certain number of rows |
| `COUNT` | Count matching rows |
| `INSERT` | Create a new row |
| `UPDATE` | Change an existing row |
| `DELETE` | Permanently remove matching rows |
| `TRUNCATE` | Permanently empty an entire table |
| `RETURNING` | Show the row changed by an `INSERT`, `UPDATE`, or `DELETE` |

## Read products

Show every product:

```sql
select *
from public.products
order by id;
```

Show only useful columns:

```sql
select id, category, name, price
from public.products
order by category, id;
```

Show only the first 20 products:

```sql
select id, category, name, price
from public.products
order by id
limit 20;
```

## Search for an ID

Find one exact ID:

```sql
select *
from public.products
where id = 'LK-R';
```

If the saved ID contains a space, type the real space inside the quotes:

```sql
select *
from public.products
where id = 'LK R';
```

Find an ID containing some text:

```sql
select *
from public.products
where id ilike '%LK R%';
```

Search a Khmer or English product name:

```sql
select id, name, category, price
from public.products
where name ilike '%បាយ%';
```

### What `%` means

`%` means **any amount of text**. It does not mean a space.

- `'LK R'` contains a real space.
- `'LK-R'` contains a hyphen.
- `'LK%'` finds anything beginning with `LK`.
- `'%R'` finds anything ending with `R`.
- `'%LK%'` finds anything containing `LK`.
- `_` means exactly one unknown character.

`ILIKE` searches without caring about uppercase or lowercase. `LIKE` is case-sensitive.

## Correct a product ID

First, verify the old ID:

```sql
select id, name, category
from public.products
where id = 'LK R';
```

If the result is the correct product, change the space to a hyphen:

```sql
update public.products
set id = 'LK-R'
where id = 'LK R'
returning id, name, category;
```

`RETURNING` shows the changed product immediately. If the old ID is not found, zero rows are changed.

## Edit a product

Always find it first:

```sql
select id, name, category, price
from public.products
where id = 'LK-R';
```

Example update:

```sql
update public.products
set name = 'ឈ្មោះថ្មី',
    price = '1.50'
where id = 'LK-R'
returning id, name, category, price;
```

Only include columns that you want to change.

## Delete one test product

Check it first:

```sql
select id, name
from public.products
where id = 'LK-TEST';
```

Then delete only that ID:

```sql
delete from public.products
where id = 'LK-TEST'
returning id, name;
```

Never run `delete from public.products;` without a `WHERE` condition.

## View orders

Show the newest orders first:

```sql
select id, order_number, customer_name, status, total, created_at
from public.orders
order by created_at desc;
```

Find one order number:

```sql
select *
from public.orders
where order_number = 14;
```

The database stores `14` as a number. The admin website formats it as `014`.

Count orders and inspect the number range:

```sql
select
  count(*) as total_orders,
  min(order_number) as first_number,
  max(order_number) as last_number
from public.orders;
```

## Delete one test order

Use the order's UUID from the `id` column, not only its displayed order number.

Check it first:

```sql
select id, order_number, customer_name, created_at
from public.orders
where id = 'PASTE-ORDER-UUID-HERE';
```

Delete it:

```sql
delete from public.orders
where id = 'PASTE-ORDER-UUID-HERE'
returning id, order_number, customer_name;
```

Deleting one order does not rewind the order-number sequence. Gaps are normal.

## Delete all test orders and restart at 001

**Danger: this permanently deletes every order. Use it only before accepting real customer orders.**

Check the current orders first:

```sql
select id, order_number, customer_name, created_at
from public.orders
order by order_number;
```

If every row is test data, empty the table and reset its identity sequence:

```sql
truncate table public.orders restart identity;
```

What each part means:

- `TRUNCATE TABLE` empties the complete table.
- `public.orders` is the table being emptied.
- `RESTART IDENTITY` resets its owned auto-number sequence.
- The first new order receives `order_number = 1` and displays as `001`.

Verify the reset:

```sql
select
  (select count(*) from public.orders) as remaining_orders,
  last_value as sequence_value,
  is_called as number_already_used
from public.orders_order_number_seq;
```

Expected result before the next order:

- `remaining_orders` = `0`
- `sequence_value` = `1`
- `number_already_used` = `false`

## Repair the order-number sequence without deleting orders

Use this only if imports or manual edits caused the sequence to fall behind the highest existing order number:

```sql
select setval(
  pg_get_serial_sequence('public.orders', 'order_number'),
  coalesce((select max(order_number) from public.orders), 0) + 1,
  false
);
```

What it does:

- Finds the sequence owned by `orders.order_number`.
- Reads the largest existing order number.
- Makes the next generated number one higher.
- Does not delete existing orders.

Do not use this to reuse old order numbers.

## Read site settings

Show every site setting:

```sql
select key, value
from public.site_settings
order by key;
```

Find category settings:

```sql
select key, value
from public.site_settings
where key ilike '%categor%';
```

Some setting values contain JSON. Editing malformed JSON can break the customer or admin page, so use the admin interface when possible.

## Check admin users

Show the allowlisted admin user IDs:

```sql
select user_id
from public.admin_users
order by user_id;
```

Compare these UUIDs with **Authentication → Users**. Do not add an unknown UUID.

## Check Row Level Security

Check whether RLS is enabled on public tables:

```sql
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
order by tablename;
```

Show the policies protecting public tables:

```sql
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

These two commands only read security information. Ask for help before changing RLS policies.

## Useful result messages

- `Success. No rows returned` can mean the command worked but had nothing to display.
- `0 rows` after an update or delete usually means the `WHERE` condition matched nothing.
- `duplicate key value violates unique constraint` means the new ID or number already exists.
- `permission denied` usually means a grant or RLS policy blocked the operation.
- A red error message means the transaction failed; read the first error line carefully.

## Official references

- [Supabase database overview](https://supabase.com/docs/guides/database/overview)
- [Deleting data safely](https://supabase.com/docs/guides/database/postgres/data-deletion)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)

