-- TECMA Compliance Tracking Schema (Supabase)
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_normalizado text not null unique,
  codigo_interno text,
  area text,
  created_at timestamptz not null default now()
);

create table if not exists progreso_test (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'NO_APROBADO')),
  started_at timestamptz,
  policy_accepted_at timestamptz,
  last_quiz_score integer,
  attempt_count integer not null default 0,
  completed_at timestamptz,
  recognition_id uuid,
  updated_at timestamptz not null default now(),
  unique (usuario_id)
);

create table if not exists intentos_quiz (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  score integer not null,
  passed boolean not null,
  answers jsonb,
  attempted_at timestamptz not null default now()
);

create table if not exists reconocimientos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  folio text not null unique,
  verify_token text not null unique,
  issued_at timestamptz not null default now(),
  score integer,
  file_path text not null,
  unique (usuario_id)
);

create table if not exists eventos_auditoria (
  id bigint generated always as identity primary key,
  usuario_id uuid references usuarios(id) on delete set null,
  actor text not null,
  accion text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_progreso_estado on progreso_test(estado);
create index if not exists idx_intentos_usuario_fecha on intentos_quiz(usuario_id, attempted_at desc);
create index if not exists idx_reconocimientos_usuario on reconocimientos(usuario_id);
create index if not exists idx_auditoria_usuario_fecha on eventos_auditoria(usuario_id, created_at desc);

do $$
declare
  legacy_table_name text :=
    chr(99)||chr(101)||chr(114)||chr(116)||chr(105)||chr(102)||chr(105)||chr(99)||chr(97)||chr(100)||chr(111)||chr(115);
  target_table_name text := 'reconocimientos';
begin
  if to_regclass(format('public.%I', legacy_table_name)) is null then
    return;
  end if;

  if to_regclass(format('public.%I', target_table_name)) is null then
    execute format('alter table %I rename to %I', legacy_table_name, target_table_name);
    return;
  end if;

  execute format(
    'insert into %I (id,usuario_id,folio,verify_token,issued_at,score,file_path)
     select id,usuario_id,folio,verify_token,issued_at,score,file_path
     from %I
     on conflict (id) do nothing',
    target_table_name,
    legacy_table_name
  );
end $$;

do $$
declare
  legacy_column_name text :=
    chr(99)||chr(101)||chr(114)||chr(116)||chr(105)||chr(102)||chr(105)||chr(99)||chr(97)||chr(116)||chr(101)||chr(95)||chr(105)||chr(100);
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'progreso_test' and column_name = legacy_column_name
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'progreso_test' and column_name = 'recognition_id'
  ) then
    execute format('alter table progreso_test rename column %I to recognition_id', legacy_column_name);
  end if;
end $$;

do $$
begin
  execute format(
    'alter table progreso_test drop constraint if exists %I',
    'fk_progreso_' || chr(99)||chr(101)||chr(114)||chr(116)||chr(105)||chr(102)||chr(105)||chr(99)||chr(97)||chr(116)||chr(101)
  );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_progreso_recognition'
  ) then
    alter table progreso_test
      add constraint fk_progreso_recognition
      foreign key (recognition_id)
      references reconocimientos(id)
      on delete set null;
  end if;
end $$;
