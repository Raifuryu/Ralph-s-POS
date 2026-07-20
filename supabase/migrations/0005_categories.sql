-- Ralph POS — product categories
--
-- A table rather than an enum: the owner isn't sure of the final list, and a
-- table lets categories be added/renamed as data instead of via migrations.
-- Seeded with typical sari-sari / convenience store sections.
--
-- products.category_id is nullable and ON DELETE SET NULL: a product without
-- a category is fine, and deleting a category must never delete products.

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.categories is
  'Product categories, seeded with typical sari-sari store sections. Managed as data, not schema.';

alter table public.products
  add column category_id uuid references public.categories (id) on delete set null;

create index products_category_id_idx on public.products (category_id);

alter table public.categories enable row level security;

-- Read-only for staff: the app renders and assigns categories but the list
-- itself is curated. Widen when a category-management UI exists.
create policy "staff read categories" on public.categories
  for select to authenticated using (true);

-- Supabase default privileges grant ALL on new tables to anon and
-- authenticated (see 0002) — trim to what the app uses.
revoke all on table public.categories from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.categories from authenticated;

insert into public.categories (name, sort_order) values
  ('Beverages',                10),
  ('Snacks',                   20),
  ('Canned & Instant Food',    30),
  ('Condiments & Sauces',      40),
  ('Rice & Grains',            50),
  ('Frozen & Chilled',         60),
  ('Personal Care',            70),
  ('Household & Cleaning',     80),
  ('School & Office Supplies', 90),
  ('Others',                  100);
