-- =====================================================================
-- 06_dni_y_fotos.sql — Identidad civil y retrato del bombero
--
-- El bloque de Storage se saltea si el esquema `storage` no existe, para
-- que las migraciones sigan aplicando en un Postgres pelado (tests).
-- =====================================================================

-- --- DNI --------------------------------------------------------------

alter table bombero add column if not exists dni text;

do $$ begin
  alter table bombero add constraint dni_formato
    check (dni is null or dni ~ '^[0-9]{7,8}$');
exception when duplicate_object then null; end $$;

create unique index if not exists bombero_dni_idx
  on bombero (cuartel_id, dni) where dni is not null;

comment on column bombero.dni is
  'Documento Nacional de Identidad. Dato personal: solo lo lee el mando via RLS.';

-- --- Retrato ----------------------------------------------------------
-- Se guarda solo la ruta. El archivo vive en un bucket privado y se sirve
-- con signed URL. El nombre del archivo es el uuid del bombero, nunca el
-- DNI ni el apellido: si una URL se filtra, no revela de quién es la foto.

alter table bombero add column if not exists foto_path text;

comment on column bombero.foto_path is
  'Ruta dentro del bucket privado fotos-bomberos. Nunca se expone públicamente.';

-- --- Bucket y políticas de Storage ------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Sin esquema storage (Postgres local): se saltea el bucket de fotos';
    return;
  end if;

  -- public = false es lo que impide que la foto de un bombero sea
  -- accesible con solo conocer la URL.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('fotos-bomberos', 'fotos-bomberos', false, 5242880,
          array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update
    set public = false,
        file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg','image/png','image/webp'];

  -- Lectura: cualquier autenticado que pertenezca a un cuartel.
  if not exists (select 1 from pg_policies
                 where schemaname='storage' and tablename='objects'
                   and policyname='fotos_lectura') then
    execute $p$
      create policy fotos_lectura on storage.objects for select to authenticated
      using (bucket_id = 'fotos-bomberos' and app_cuartel_actual() is not null)
    $p$;
  end if;

  -- Escritura: solo el mando.
  if not exists (select 1 from pg_policies
                 where schemaname='storage' and tablename='objects'
                   and policyname='fotos_alta') then
    execute $p$
      create policy fotos_alta on storage.objects for insert to authenticated
      with check (bucket_id = 'fotos-bomberos' and app_es_jefe(app_cuartel_actual()))
    $p$;
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='storage' and tablename='objects'
                   and policyname='fotos_reemplazo') then
    execute $p$
      create policy fotos_reemplazo on storage.objects for update to authenticated
      using (bucket_id = 'fotos-bomberos' and app_es_jefe(app_cuartel_actual()))
      with check (bucket_id = 'fotos-bomberos' and app_es_jefe(app_cuartel_actual()))
    $p$;
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='storage' and tablename='objects'
                   and policyname='fotos_baja') then
    execute $p$
      create policy fotos_baja on storage.objects for delete to authenticated
      using (bucket_id = 'fotos-bomberos' and app_es_jefe(app_cuartel_actual()))
    $p$;
  end if;
end $$;
