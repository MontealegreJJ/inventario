-- Agrega la foto de las cajas y la tabla de proyectos con IA.
-- No borra ni cambia ningún dato. Se puede correr varias veces.
alter table public.boxes add column if not exists photo_url text;

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
alter table public.projects enable row level security;
revoke all on public.projects from anon;
grant select, insert, update, delete on public.projects to authenticated, service_role;
drop policy if exists "solo miembros" on public.projects;
create policy "solo miembros" on public.projects for all to authenticated
  using (public.is_member()) with check (public.is_member());

do $$ begin
  alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

select (select count(*) from public.boxes) as cajas,
       (select count(*) from public.components) as componentes,
       (select count(*) from public.projects) as proyectos;
