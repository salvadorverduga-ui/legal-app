-- 20260706_014_fix_triggers.sql
-- Diagnóstico del 500 en POST /auth/v1/signup al registrarse como abogado.
--
-- Los nombres de campo entre api.js y los triggers de la migración 013 ya se
-- verificaron y coinciden exactamente (rol, nombre_completo, cedula, provincia,
-- numero_carnet, especialidades), así que el 500 no es un mismatch de nombres:
-- es una excepción real dentro de fn_crear_perfil_en_registro o
-- fn_crear_fila_abogado (constraint, permiso, tipo de dato) que aborta toda la
-- transacción de auth.users y por eso GoTrue devuelve 500.
--
-- Esta migración agrega manejo de excepciones para que un fallo en esas
-- funciones quede registrado en trigger_errors en vez de abortar el signUp
-- completo. Es una medida de DIAGNÓSTICO TEMPORAL, no la solución final:
-- una vez identificado el error real en trigger_errors, hay que corregir la
-- causa de raíz y evaluar si conviene mantener este manejo de excepciones o
-- volver a dejar que el trigger revierta el signUp (según se decida).
--
-- ADVERTENCIA IMPORTANTE: si fn_crear_perfil_en_registro sigue fallando con
-- esto en su lugar, el usuario queda creado en auth.users SIN fila en
-- perfiles. Esa cuenta no puede iniciar sesión (iniciarSesion() no encuentra
-- perfil) ni volver a registrarse con el mismo correo ("User already
-- registered"). Hay que revisar trigger_errors después de cada prueba y, si
-- aparecen filas, limpiar manualmente los usuarios huérfanos en auth.users
-- (con service_role) mientras se corrige la causa.

-- ────────────────────────────────────────────────────────────
-- Tabla de errores de triggers
-- ────────────────────────────────────────────────────────────
CREATE TABLE trigger_errors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcion    text NOT NULL,     -- nombre de la función que capturó el error
  mensaje    text NOT NULL,     -- SQLERRM: mensaje real de Postgres
  datos      jsonb,             -- contexto para diagnosticar (id, metadata recibida)
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE trigger_errors IS 'Captura errores de triggers SECURITY DEFINER que no deben abortar la transacción de signUp. Medida de diagnóstico temporal (ver 20260706_014) — revisar y limpiar periódicamente.';

ALTER TABLE trigger_errors ENABLE ROW LEVEL SECURITY;

-- Solo admin puede leer los errores capturados.
CREATE POLICY "admin_select_trigger_errors" ON trigger_errors
  FOR SELECT USING (es_admin());

-- INSERT: no se otorga a authenticated ni anon. Las funciones SECURITY
-- DEFINER que escriben aquí corren como su dueño (postgres), que no
-- necesita GRANT explícito sobre una tabla que le pertenece.
GRANT SELECT ON TABLE trigger_errors TO authenticated;


-- ────────────────────────────────────────────────────────────
-- perfiles: capturar y loguear en vez de abortar el signUp
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_perfil_en_registro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO perfiles (id, rol, nombre_completo, cedula, provincia)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'rol', 'cliente'),
      COALESCE(NEW.raw_user_meta_data->>'nombre_completo', ''),
      NEW.raw_user_meta_data->>'cedula',
      NEW.raw_user_meta_data->>'provincia'
    );
  EXCEPTION WHEN OTHERS THEN
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
-- abogados: capturar y loguear en vez de abortar el signUp
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
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO trigger_errors (funcion, mensaje, datos)
      VALUES (
        'fn_crear_fila_abogado',
        SQLERRM,
        jsonb_build_object('perfil_id', NEW.id, 'raw_user_meta_data', v_meta)
      );
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Nota: fn_crear_fila_estudio (migración 013) no se tocó — el reporte es
-- específico del registro de abogado. Si el mismo patrón de error aparece
-- ahí, aplicar el mismo manejo de excepciones en una migración aparte.
