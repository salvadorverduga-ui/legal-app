-- 20260625_005_suscripciones.sql
-- Historial de suscripciones: una fila por período de pago.
-- Al insertar o activar una suscripción, el trigger sincroniza suscripcion_vigente_hasta
-- en la entidad correspondiente (abogados o estudios), que es lo que usa el RLS de búsqueda.
-- Una suscripción pertenece a UN abogado O a UN estudio, nunca ambos (constraint CHECK).

CREATE TYPE tipo_suscripcion AS ENUM (
  'ABOGADO_INDIVIDUAL',  -- $11.99/mes
  'ESTUDIO_PEQUENO',     -- $29.99/mes, hasta 3 miembros
  'ESTUDIO_MEDIANO',     -- $59.99/mes, hasta 8 miembros
  'ESTUDIO_GRANDE'       -- $99.99/mes, ilimitados
);

CREATE TYPE estado_suscripcion AS ENUM ('ACTIVA', 'VENCIDA', 'CANCELADA');
CREATE TYPE metodo_pago AS ENUM ('TRANSFERENCIA', 'PAYPHONE', 'MANUAL_ADMIN');

CREATE TABLE suscripciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactamente uno de los dos FKs debe ser no nulo (ver constraint al final)
  abogado_id          uuid REFERENCES abogados(id) ON DELETE CASCADE,
  estudio_id          uuid REFERENCES estudios(id) ON DELETE CASCADE,
  tipo                tipo_suscripcion NOT NULL,
  estado              estado_suscripcion NOT NULL DEFAULT 'ACTIVA',
  monto               numeric(10,2) NOT NULL,            -- precio en USD al momento del pago
  fecha_inicio        date NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento   date NOT NULL,
  metodo_pago         metodo_pago NOT NULL DEFAULT 'TRANSFERENCIA',
  referencia_pago     text,                              -- número de comprobante o ID de PayPhone
  notas_admin         text,                              -- campo interno; no visible para el suscriptor
  registrado_por      uuid REFERENCES perfiles(id) ON DELETE SET NULL,  -- admin que cargó el pago manual
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suscriptor_exclusivo CHECK (
    (abogado_id IS NOT NULL AND estudio_id IS NULL)
    OR (abogado_id IS NULL AND estudio_id IS NOT NULL)
  )
);

CREATE INDEX idx_suscripciones_abogado ON suscripciones (abogado_id, estado, fecha_vencimiento DESC);
CREATE INDEX idx_suscripciones_estudio ON suscripciones (estudio_id, estado, fecha_vencimiento DESC);

COMMENT ON TABLE suscripciones IS 'Historial de suscripciones. Al insertar una ACTIVA, el trigger actualiza suscripcion_vigente_hasta en abogados o estudios.';
COMMENT ON CONSTRAINT suscriptor_exclusivo ON suscripciones IS 'Una suscripción pertenece a un abogado O a un estudio, nunca a ambos.';
COMMENT ON COLUMN suscripciones.monto IS 'Precio registrado al momento del cobro. Independiente de cambios futuros en el catálogo de precios.';

ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;

-- Solo admin gestiona suscripciones en MVP (cobro manual o PayPhone)
CREATE POLICY "admin_select_suscripciones" ON suscripciones
  FOR SELECT USING (es_admin());

CREATE POLICY "admin_insert_suscripciones" ON suscripciones
  FOR INSERT WITH CHECK (es_admin());

CREATE POLICY "admin_update_suscripciones" ON suscripciones
  FOR UPDATE USING (es_admin());

-- El abogado puede consultar su propio historial de suscripciones
CREATE POLICY "abogado_ve_propias_suscripciones" ON suscripciones
  FOR SELECT
  USING (abogado_id = auth.uid());

-- El representante del estudio puede ver el historial de su estudio
CREATE POLICY "estudio_ve_propias_suscripciones" ON suscripciones
  FOR SELECT
  USING (
    estudio_id IN (
      SELECT id FROM estudios WHERE representante_legal_id = auth.uid()
    )
  );

-- Trigger: al insertar o activar una suscripción, sincronizar suscripcion_vigente_hasta.
-- Usa GREATEST para no retroceder la fecha si ya hay una suscripción más larga activa.
CREATE OR REPLACE FUNCTION fn_sincronizar_suscripcion_vigente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo actúa cuando la suscripción está ACTIVA
  IF NEW.estado = 'ACTIVA' THEN
    IF NEW.abogado_id IS NOT NULL THEN
      UPDATE abogados
      SET suscripcion_vigente_hasta = GREATEST(
        COALESCE(suscripcion_vigente_hasta, '1970-01-01'::date),
        NEW.fecha_vencimiento
      )
      WHERE id = NEW.abogado_id;
    END IF;

    IF NEW.estudio_id IS NOT NULL THEN
      UPDATE estudios
      SET suscripcion_vigente_hasta = GREATEST(
        COALESCE(suscripcion_vigente_hasta, '1970-01-01'::date),
        NEW.fecha_vencimiento
      )
      WHERE id = NEW.estudio_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sincronizar_suscripcion
  AFTER INSERT OR UPDATE OF estado, fecha_vencimiento ON suscripciones
  FOR EACH ROW EXECUTE FUNCTION fn_sincronizar_suscripcion_vigente();

CREATE TRIGGER trg_suscripciones_updated_at
  BEFORE UPDATE ON suscripciones
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
