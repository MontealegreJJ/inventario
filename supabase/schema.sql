-- =====================================================================
--  Inventario de componentes — base de datos (Supabase / PostgreSQL)
--  Pegar TODO este archivo en Supabase → SQL Editor → Run.
--  Se puede volver a correr sin dañar datos (usa "if not exists").
-- =====================================================================

-- ---------- 1. Miembros autorizados (los tres del grupo) --------------
create table if not exists public.members (
  email text primary key,
  name  text not null
);

-- Los tres integrantes. Deben coincidir con los usuarios creados en
-- Authentication → Users y con USUARIOS en js/config.js.
insert into public.members (email, name) values
  ('manuel.cruz@inventario.example',      'Manuel Cruz'),
  ('mabel.rincon@inventario.example',     'Mabel Rincón'),
  ('juan.montealegre@inventario.example', 'Juan Montealegre')
on conflict (email) do update set name = excluded.name;

-- ¿El usuario que hace la consulta es uno de los tres?
create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- 2. Cajas -------------------------------------------------
create table if not exists public.boxes (
  number      int primary key check (number > 0),
  description text not null default '',
  photo_url   text,
  created_at  timestamptz not null default now()
);
alter table public.boxes add column if not exists photo_url text;  -- foto de la caja

-- ---------- 3. Componentes ------------------------------------------
-- "key" es el nombre normalizado (sin mayúsculas, espacios ni guiones).
-- Es ÚNICO: así nunca quedan dos fichas del mismo componente.
create table if not exists public.components (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  key         text not null unique,
  aliases     text[] not null default '{}',
  category    text not null default 'Otros',
  box         int references public.boxes(number) on update cascade on delete set null,
  quantity    int not null default 1 check (quantity >= 0),
  notes       text not null default '',
  photo_url   text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- ---------- 4. Observaciones (comentarios por componente) -----------
create table if not exists public.observations (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  author       text,
  text         text not null,
  created_at   timestamptz not null default now()
);

-- ---------- 5. Préstamos --------------------------------------------
create table if not exists public.loans (
  id               uuid primary key default gen_random_uuid(),
  component_id     uuid references public.components(id) on delete set null,
  component_name   text not null,
  box              int,
  quantity         int not null default 1 check (quantity > 0),
  borrower_kind    text not null check (borrower_kind in ('miembro', 'externo')),
  borrower_name    text not null,
  borrower_contact text not null default '',
  lent_by          text,
  lent_at          timestamptz not null default now(),
  due_at           date,
  returned_at      timestamptz,
  notes            text not null default ''
);

-- ---------- 6. Novedades (historial de todo lo que pasa) -------------
create table if not exists public.activity (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,
  component_id   uuid,
  component_name text,
  actor_email    text,
  actor_name     text,
  detail         text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists activity_created_idx on public.activity (created_at desc);

-- ---------- 7. Suscripciones a notificaciones push -------------------
create table if not exists public.push_subscriptions (
  endpoint     text primary key,
  user_email   text not null,
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);

-- ---------- 7b. Proyectos revisados por la IA ------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null,
  result      jsonb not null default '{}',
  model       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- 8. Seguridad: solo los tres miembros ven y editan ---------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.is_member() to authenticated;
revoke all on all tables in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array['boxes','components','observations','loans','activity','push_subscriptions','projects']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "solo miembros" on public.%I', t);
    execute format(
      'create policy "solo miembros" on public.%I for all to authenticated
         using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

alter table public.members enable row level security;
drop policy if exists "miembros se ven" on public.members;
create policy "miembros se ven" on public.members
  for select to authenticated using (public.is_member());

-- ---------- 9. Fotos (Storage) ---------------------------------------
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do nothing;

drop policy if exists "miembros ven fotos" on storage.objects;
create policy "miembros ven fotos" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and public.is_member());

drop policy if exists "miembros suben fotos" on storage.objects;
create policy "miembros suben fotos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_member());

drop policy if exists "miembros cambian fotos" on storage.objects;
create policy "miembros cambian fotos" on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos' and public.is_member());

drop policy if exists "miembros borran fotos" on storage.objects;
create policy "miembros borran fotos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and public.is_member());

-- ---------- 10. Tiempo real (que los cambios lleguen al instante) -----
do $$
declare t text;
begin
  foreach t in array array['boxes','components','observations','loans','activity','projects']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
