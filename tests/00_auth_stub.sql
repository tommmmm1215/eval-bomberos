-- Solo para pruebas locales fuera de Supabase.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
-- Supabase define estos dos roles; 05_permisos.sql los referencia por nombre.
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
