-- 20260706_015_fix_cedula_conflict_y_backfill.sql
--
-- CONTEXTO: un abogado quedó creado en auth.users (raw_user_meta_data->>'rol'
-- = 'abogado') pero sin fila en public.perfiles. El cliente sí funcionó.
--
-- REVISIÓN DE CÓDIGO (antes de este fix): fn_crear_perfil_en_registro ejecuta
-- el MISMO INSERT INTO perfiles (id, rol, nombre_completo, cedula, provincia)
-- para cualquier rol — no hay una rama de código específica para 'abogado'.
-- numero_carnet/especialidades y la subida de documentos a Storage no los
-- toca esta función en absoluto (la subida de documentos corre en el cliente,
-- después de que signUp() ya resolvió, así que no puede afectar este INSERT).
-- La causa más probable de que auth.users exista pero perfiles no: la fila
-- INSERT falló por un unique_violation en `perfiles.cedula` (columna UNIQUE
-- desde la migración 001) — típico si la prueba de abogado reusó el mismo
-- número de cédula que una prueba anterior. La migración 014 ya captura esa
-- excepción en trigger_errors y deja pasar el signUp, que es exactamente el
-- síntoma reportado (usuario en auth.users, sin perfil).
--
-- Esta migración:
--   1. Hace que fn_crear_perfil_en_registro, ante un unique_violation de
--      cédula específicamente, reintente el INSERT sin cédula en vez de
--      quedarse sin fila de perfil. Preferimos una cuenta usable sin cédula
--      guardada (se puede completar después desde el panel) a una cuenta
--      atascada que no puede ni loguearse ni volver a registrarse con ese
--      correo.
--   2. Repara manualmente al usuario c8aca9db-f7a9-4d3f-8120-a8324f42e650:
--      inserta su fila en perfiles leyendo su raw_user_meta_data. Al ser un
--      INSERT normal sobre perfiles, dispara igual que cualquier registro el
--      trigger trg_crear_fila_abogado, así que también le crea su fila en
--      abogados automáticamente si su rol es 'abogado'.

-- ────────────────────────────────────────────────────────────
-- 1. fn_crear_perfil_en_registro: reintento sin cédula ante unique_violation
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_perfil_en_registro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol             text := COALESCE(NEW.raw_user_meta_data->>'rol', 'cliente');
  v_nombre_completo text := COALESCE(NEW.raw_user_meta_data->>'nombre_completo', '');
  v_cedula          text := NEW.raw_user_meta_data->>'cedula';
  v_provincia       text := NEW.raw_user_meta_data->>'provincia';
BEGIN
  BEGIN
    INSERT INTO perfiles (id, rol, nombre_completo, cedula, provincia)
    VALUES (NEW.id, v_rol, v_nombre_completo, v_cedula, v_provincia);

  EXCEPTION
    WHEN unique_violation THEN
      -- Probablemente la cédula ya está en uso por otro perfil. Se deja
      -- registro en trigger_errors para que el admin revise el duplicado,
      -- y se reintenta sin cédula para no perder la cuenta completa.
      INSERT INTO trigger_errors (funcion, mensaje, datos)
      VALUES (
        'fn_crear_perfil_en_registro',
        'unique_violation, reintentando sin cedula: ' || SQLERRM,
        jsonb_build_object('user_id', NEW.id, 'raw_user_meta_data', NEW.raw_user_meta_data)
      );

      BEGIN
        INSERT INTO perfiles (id, rol, nombre_completo, cedula, provincia)
        VALUES (NEW.id, v_rol, v_nombre_completo, NULL, v_provincia);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO trigger_errors (funcion, mensaje, datos)
        VALUES (
          'fn_crear_perfil_en_registro (reintento sin cedula)',
          SQLERRM,
          jsonb_build_object('user_id', NEW.id, 'raw_user_meta_data', NEW.raw_user_meta_data)
        );
      END;

    WHEN OTHERS THEN
      INSERT INTO trigger_errors (funcion, mensaje, datos)
      VALUES (
        'fn_crear_perfil_en_registro',
        SQLERRM,
        jsonb_build_object('user_id', NEW.id, 'raw_user_meta_data', NEW.raw_user_meta_data)
      );
  END;

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Backfill del usuario abogado atascado
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id   uuid := 'c8aca9db-f7a9-4d3f-8120-a8324f42e650';
  v_meta      jsonb;
  v_rol       text;
  v_nombre    text;
  v_cedula    text;
  v_provincia text;
BEGIN
  IF EXISTS (SELECT 1 FROM perfiles WHERE id = v_user_id) THEN
    RAISE NOTICE 'perfiles ya tiene una fila para %, no se hace nada.', v_user_id;
    RETURN;
  END IF;

  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = v_user_id;

  IF v_meta IS NULL THEN
    RAISE NOTICE 'No se encontró auth.users.id = %, no se puede reparar.', v_user_id;
    RETURN;
  END IF;

  v_rol       := COALESCE(v_meta->>'rol', 'cliente');
  v_nombre    := COALESCE(v_meta->>'nombre_completo', '');
  v_cedula    := v_meta->>'cedula';
  v_provincia := v_meta->>'provincia';

  BEGIN
    INSERT INTO perfiles (id, rol, nombre_completo, cedula, provincia)
    VALUES (v_user_id, v_rol, v_nombre, v_cedula, v_provincia);
  EXCEPTION WHEN unique_violation THEN
    -- Mismo caso que en el trigger: la cédula guardada en su metadata ya
    -- está en uso por otro perfil. Se crea sin cédula para no dejar a este
    -- usuario puntual sin cuenta; revisar el duplicado manualmente.
    INSERT INTO perfiles (id, rol, nombre_completo, cedula, provincia)
    VALUES (v_user_id, v_rol, v_nombre, NULL, v_provincia);
  END;
END;
$$;
