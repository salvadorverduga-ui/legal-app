-- 20260712_043_referidos.sql
-- Programa de referidos: cada abogado tiene un código único; cuando otro
-- abogado se registra con ese código, ambos reciben un mes gratis.
--
-- La recompensa se otorga vía suscripciones (fuente de verdad de
-- abogados.suscripcion_vigente_hasta, ver 20260625_005_suscripciones.sql) y
-- nunca escribiendo esa columna directamente — la política RLS
-- "abogado_update_propio" (migración 004) explícitamente prohíbe que nada
-- fuera del trigger fn_sincronizar_suscripcion_vigente la modifique.

-- ────────────────────────────────────────────────────────────
-- metodo_pago: nuevo valor para distinguir las suscripciones gratuitas que
-- otorga este programa (automáticas) del resto (TRANSFERENCIA/PAYPHONE/
-- MANUAL_ADMIN, todas cobros reales). Va primero en el archivo porque
-- Postgres exige que un valor de enum agregado con ADD VALUE se use en un
-- comando posterior, nunca en el mismo — acá se usa más abajo, en
-- fn_crear_fila_abogado, dentro de la misma transacción de esta migración
-- (soportado desde Postgres 12).
-- ────────────────────────────────────────────────────────────
ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'REFERIDO';

-- ────────────────────────────────────────────────────────────
-- abogados.codigo_referido: código único de 8 caracteres
-- ────────────────────────────────────────────────────────────
ALTER TABLE abogados ADD COLUMN codigo_referido text UNIQUE;

COMMENT ON COLUMN abogados.codigo_referido IS 'Código único de 8 caracteres para el programa de referidos (frontend/pages/referidos.html). Generado automáticamente por fn_generar_codigo_referido al crear la fila; nunca editable por el usuario.';

CREATE OR REPLACE FUNCTION fn_generar_codigo_referido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_codigo  text;
  v_intento integer := 0;
BEGIN
  LOOP
    v_codigo := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    v_intento := v_intento + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM abogados WHERE codigo_referido = v_codigo) OR v_intento > 10;
  END LOOP;

  NEW.codigo_referido := v_codigo;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_generar_codigo_referido() IS 'Genera codigo_referido (8 hex uppercase) al crear una fila de abogados. Reintenta hasta 10 veces ante colisión (improbable con 16^8 combinaciones).';

CREATE TRIGGER trg_generar_codigo_referido
  BEFORE INSERT ON abogados
  FOR EACH ROW EXECUTE FUNCTION fn_generar_codigo_referido();

-- "abogado_update_propio" (migración 004) ya congela verificacion y
-- suscripcion_vigente_hasta contra el propio abogado; se extiende acá para
-- que codigo_referido tampoco sea editable — de lo contrario el abogado
-- podría reescribir su propio código y romper enlaces ya compartidos.
ALTER POLICY "abogado_update_propio" ON abogados
  WITH CHECK (
    id = auth.uid()
    AND verificacion = (SELECT verificacion FROM abogados WHERE id = auth.uid())
    AND suscripcion_vigente_hasta IS NOT DISTINCT FROM (SELECT suscripcion_vigente_hasta FROM abogados WHERE id = auth.uid())
    AND codigo_referido IS NOT DISTINCT FROM (SELECT codigo_referido FROM abogados WHERE id = auth.uid())
  );


-- ────────────────────────────────────────────────────────────
-- TABLA: referidos
-- ────────────────────────────────────────────────────────────
CREATE TYPE estado_referido AS ENUM ('PENDIENTE', 'COMPLETADO');

CREATE TABLE referidos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referidor_id    uuid NOT NULL REFERENCES abogados(id) ON DELETE RESTRICT,
  referido_email  text,
  codigo_referido text NOT NULL,
  estado          estado_referido NOT NULL DEFAULT 'PENDIENTE',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_referidos_referidor ON referidos (referidor_id, created_at DESC);

COMMENT ON TABLE referidos IS 'Historial de referidos por abogado (frontend/pages/referidos.html).';
COMMENT ON COLUMN referidos.codigo_referido IS 'Copia del código del referidor (abogados.codigo_referido) al momento del registro. No es UNIQUE en esta tabla: un mismo abogado puede referir a varias personas con su mismo código — la unicidad real vive en abogados.codigo_referido.';
COMMENT ON COLUMN referidos.estado IS 'En este MVP las filas se crean directamente en COMPLETADO: la recompensa se otorga de inmediato al registrarse con un código válido (fn_crear_fila_abogado). PENDIENTE queda reservado para un futuro flujo de invitaciones no reclamadas.';

ALTER TABLE referidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abogado_ve_propios_referidos" ON referidos
  FOR SELECT
  USING (referidor_id = auth.uid());

CREATE POLICY "admin_ve_referidos" ON referidos
  FOR SELECT USING (es_admin());

-- Sin política de INSERT/UPDATE/DELETE: las filas solo las crea
-- fn_crear_fila_abogado (SECURITY DEFINER), nunca el frontend.


-- ────────────────────────────────────────────────────────────
-- Validar un código antes de registrarse (RPC, sin sesión — mismo patrón
-- que abogado_es_visible). Solo expone el nombre del referidor, nada
-- sensible.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validar_codigo_referido(p_codigo text)
RETURNS TABLE (valido boolean, referidor_nombre text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_id     uuid;
  v_nombre text;
BEGIN
  SELECT a.id, p.nombre_completo INTO v_id, v_nombre
  FROM abogados a
  JOIN perfiles p ON p.id = a.id
  WHERE a.codigo_referido = upper(trim(p_codigo));

  RETURN QUERY SELECT (v_id IS NOT NULL), v_nombre;
END;
$$;

COMMENT ON FUNCTION validar_codigo_referido(text) IS 'Valida un código de referido antes del registro (accesible sin sesión). Solo expone si es válido y el nombre del referidor.';


-- ────────────────────────────────────────────────────────────
-- Procesar el referido al registrarse: se extiende fn_crear_fila_abogado
-- (última versión: 20260706_014_fix_triggers.sql) en vez de crear un
-- trigger nuevo, para leer raw_user_meta_data->>'ref' en el mismo lugar
-- donde ya se lee el resto de la metadata de registro.
--
-- El procesamiento del referido va en su PROPIO bloque BEGIN/EXCEPTION,
-- separado del INSERT en abogados: en PL/pgSQL un bloque con EXCEPTION es
-- una subtransacción (savepoint) — si el referido fallara dentro del MISMO
-- bloque que el INSERT en abogados, revertiría también esa fila ya creada.
-- Mismo criterio de aislamiento de fallos que 20260706_014_fix_triggers.sql.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_fila_abogado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta           jsonb;
  v_email          text;
  v_codigo_ref     text;
  v_referidor_id   uuid;
BEGIN
  IF NEW.rol = 'abogado' THEN
    BEGIN
      SELECT raw_user_meta_data, email INTO v_meta, v_email FROM auth.users WHERE id = NEW.id;

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

    -- Programa de referidos: si se registró con un código válido de otro
    -- abogado, un mes gratis para ambos.
    BEGIN
      v_codigo_ref := upper(trim(v_meta->>'ref'));

      IF v_codigo_ref IS NOT NULL AND v_codigo_ref <> '' THEN
        SELECT id INTO v_referidor_id FROM abogados WHERE codigo_referido = v_codigo_ref;

        -- v_referidor_id <> NEW.id: nunca debería pasar (el propio código
        -- todavía no existiría al momento de usarlo), pero evita que un
        -- futuro cambio de flujo permita "autoreferirse".
        IF v_referidor_id IS NOT NULL AND v_referidor_id <> NEW.id THEN
          INSERT INTO referidos (referidor_id, referido_email, codigo_referido, estado)
          VALUES (v_referidor_id, v_email, v_codigo_ref, 'COMPLETADO');

          -- Recompensa al referidor: extiende desde su fecha de vigencia
          -- actual si sigue vigente, o desde hoy si no tenía o ya venció.
          INSERT INTO suscripciones (abogado_id, tipo, estado, monto, fecha_vencimiento, metodo_pago, notas_admin)
          VALUES (
            v_referidor_id,
            'ABOGADO_INDIVIDUAL',
            'ACTIVA',
            0,
            (GREATEST(COALESCE((SELECT suscripcion_vigente_hasta FROM abogados WHERE id = v_referidor_id), CURRENT_DATE), CURRENT_DATE) + INTERVAL '30 days')::date,
            'REFERIDO',
            'Mes gratis — programa de referidos'
          );

          -- Recompensa al recién registrado: siempre desde hoy (recién se crea).
          INSERT INTO suscripciones (abogado_id, tipo, estado, monto, fecha_vencimiento, metodo_pago, notas_admin)
          VALUES (
            NEW.id,
            'ABOGADO_INDIVIDUAL',
            'ACTIVA',
            0,
            (CURRENT_DATE + INTERVAL '30 days')::date,
            'REFERIDO',
            'Mes gratis — programa de referidos'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO trigger_errors (funcion, mensaje, datos)
      VALUES (
        'fn_crear_fila_abogado:referidos',
        SQLERRM,
        jsonb_build_object('perfil_id', NEW.id, 'codigo_ref', v_codigo_ref)
      );
    END;
  END IF;
  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- GRANTS (CLAUDE.md §12)
-- ────────────────────────────────────────────────────────────
GRANT SELECT ON TABLE referidos TO authenticated;
GRANT EXECUTE ON FUNCTION validar_codigo_referido(text) TO anon, authenticated;
-- codigo_referido: columna nueva en una tabla ya otorgada (GRANT SELECT ON
-- TABLE abogados, migración 011) — no requiere GRANT aparte.
-- fn_crear_fila_abogado: función de trigger, invocada por el motor de
-- PostgreSQL, no por el cliente — sin GRANT (CLAUDE.md §12).
