-- 20260719_053_limite_solicitudes_directas_y_origen_independiente.sql
-- CLAUDE.md módulo 4: dos cambios sobre solicitudes directas.
--
-- 1. Límite de solicitudes directas activas (PENDIENTE/ACEPTADA) entre un
--    mismo par cliente-abogado: sube de 1 a 3. Una UNIQUE index solo puede
--    garantizar "como máximo 1 fila" -- para "como máximo 3" hace falta un
--    trigger que cuente, mismo patrón que fn_verificar_limite_casos_tablon
--    (migración 040) y fn_verificar_limite_aplicaciones_tablon.
--
-- 2. Solicitudes directas y de El Tablón dejan de compartir el límite de
--    actividad: idx_solicitud_activa_unica (migración 006) aplicaba a
--    cualquier solicitud sin importar el origen, así que un cliente con una
--    solicitud directa activa no podía además elegir al mismo abogado desde
--    un caso de El Tablón (o viceversa) sin chocar contra el índice -- la
--    migración 052 ya trabajaba alrededor de esta limitación linkeando la
--    solicitud existente en vez de crear una nueva. Ahora cada origen tiene
--    su propio control de actividad y son independientes entre sí.

-- ─── 1. Reemplazar el índice único global por uno solo para origen Tablón ───
-- El origen Tablón conserva el límite de 1 activa simultánea por par
-- cliente-abogado (un cliente no debería tener dos consultas activas con el
-- mismo abogado elegidas desde dos casos distintos del Tablón a la vez). La
-- rama EXCEPTION WHEN unique_violation de fn_crear_solicitud_desde_tablon
-- (migración 047/052) sigue funcionando igual, solo que ahora el choque es
-- exclusivamente contra otra solicitud también de origen Tablón.
DROP INDEX IF EXISTS idx_solicitud_activa_unica;

CREATE UNIQUE INDEX idx_solicitud_activa_unica_tablon
  ON solicitudes (cliente_id, abogado_id)
  WHERE estado IN ('PENDIENTE', 'ACEPTADA') AND caso_tablon_id IS NOT NULL;

COMMENT ON INDEX idx_solicitud_activa_unica_tablon IS
  'Máximo una solicitud activa de origen Tablón (caso_tablon_id NOT NULL) por par cliente-abogado. Las solicitudes directas usan fn_verificar_limite_solicitudes_directas en su lugar (límite de 3, no de 1).';

-- ─── 2. Límite de 3 solicitudes directas activas por par cliente-abogado ────
CREATE OR REPLACE FUNCTION fn_verificar_limite_solicitudes_directas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_limite CONSTANT integer := 3;
  v_activas integer;
BEGIN
  -- El límite de esta función es exclusivo de solicitudes directas; las de
  -- origen Tablón ya están cubiertas por idx_solicitud_activa_unica_tablon.
  IF NEW.caso_tablon_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_activas
  FROM solicitudes
  WHERE cliente_id = NEW.cliente_id
    AND abogado_id = NEW.abogado_id
    AND caso_tablon_id IS NULL
    AND estado IN ('PENDIENTE', 'ACEPTADA');

  IF v_activas >= v_limite THEN
    RAISE EXCEPTION 'Ya tiene % solicitudes activas con este abogado. Espere una respuesta o cancele alguna antes de enviar una nueva.', v_limite
      USING HINT = 'LIMITE_SOLICITUDES_DIRECTAS';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_verificar_limite_solicitudes_directas() IS
  'Rechaza el INSERT de una solicitud directa (caso_tablon_id IS NULL) si el cliente ya tiene 3 solicitudes activas (PENDIENTE/ACEPTADA) con ese mismo abogado. No aplica a solicitudes de origen Tablón.';

CREATE TRIGGER trg_verificar_limite_solicitudes_directas
  BEFORE INSERT ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_limite_solicitudes_directas();

-- Función trigger: no necesita GRANT (CLAUDE.md §12) -- la invoca el motor
-- de PostgreSQL en el INSERT, no un rol de la app directamente.
