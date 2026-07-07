-- 20260706_013_registro_metadata.sql
-- Extiende el registro para capturar los datos que recoge el nuevo
-- frontend/pages/registro.html: provincia (todos los roles), numero_registro
-- y especialidades (abogados), y los datos del estudio jurídico (estudios).
--
-- POR QUÉ VÍA METADATA + TRIGGER Y NO INSERT DIRECTO DESDE EL CLIENTE:
-- Con confirmación de email activa (mensaje "Revise su correo" en app.js),
-- supabase.auth.signUp() no deja sesión activa hasta que el usuario confirma
-- el enlace. Sin sesión, cualquier INSERT/UPDATE protegido por RLS con
-- auth.uid() falla. La única vía disponible en ese momento es
-- raw_user_meta_data, que el propio signUp() puede escribir sin sesión.
-- Los triggers SECURITY DEFINER (ya existentes: fn_crear_perfil_en_registro,
-- fn_crear_fila_abogado) leen esa metadata y completan las filas
-- correspondientes. Esta migración sigue el mismo patrón.

-- ────────────────────────────────────────────────────────────
-- perfiles: agregar provincia desde metadata
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_perfil_en_registro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO perfiles (id, rol, nombre_completo, cedula, provincia)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'rol', 'cliente'),
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', ''),
    NEW.raw_user_meta_data->>'cedula',
    NEW.raw_user_meta_data->>'provincia'
  );
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- abogados: agregar numero_registro (carnet) y especialidades desde metadata.
-- El trigger dispara AFTER INSERT ON perfiles, por lo que NEW no trae la
-- metadata de auth.users; hay que leerla aparte con una subconsulta.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_fila_abogado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
BEGIN
  IF NEW.rol = 'abogado' THEN
    SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = NEW.id;

    INSERT INTO abogados (id, numero_registro, especialidades)
    VALUES (
      NEW.id,
      v_meta->>'numero_carnet',
      COALESCE(
        (SELECT array_agg(valor) FROM jsonb_array_elements_text(v_meta->'especialidades') AS valor),
        '{}'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- estudios: crear automáticamente la fila del estudio cuando el
-- representante legal se registra con rol='estudio'. Mismo patrón que
-- fn_crear_fila_abogado. El plan queda en PEQUENO por defecto para el MVP;
-- el admin lo ajusta manualmente si corresponde a uno mayor.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_fila_estudio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
BEGIN
  IF NEW.rol = 'estudio' THEN
    SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = NEW.id;

    INSERT INTO estudios (nombre, ruc, plan, provincia, especialidades, representante_legal_id)
    VALUES (
      v_meta->>'nombre_estudio',
      v_meta->>'ruc',
      'PEQUENO',
      v_meta->>'provincia',
      COALESCE(
        (SELECT array_agg(valor) FROM jsonb_array_elements_text(v_meta->'especialidades') AS valor),
        '{}'
      ),
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crear_fila_estudio
  AFTER INSERT ON perfiles
  FOR EACH ROW EXECUTE FUNCTION fn_crear_fila_estudio();

COMMENT ON FUNCTION fn_crear_fila_estudio() IS 'Crea la fila en estudios cuando un perfil se registra con rol=estudio, leyendo nombre_estudio/ruc/provincia/especialidades de raw_user_meta_data. Plan por defecto PEQUENO en el MVP.';

-- Sin GRANT nuevo: es una función de trigger, invocada por el motor de
-- PostgreSQL al insertar en perfiles, no por el cliente (CLAUDE.md §12).
