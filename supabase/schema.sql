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
  certificate_id uuid,
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

create table if not exists certificados (
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
create index if not exists idx_certificados_usuario on certificados(usuario_id);
create index if not exists idx_auditoria_usuario_fecha on eventos_auditoria(usuario_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_progreso_certificate'
  ) then
    alter table progreso_test
      add constraint fk_progreso_certificate
      foreign key (certificate_id)
      references certificados(id)
      on delete set null;
  end if;
end $$;
