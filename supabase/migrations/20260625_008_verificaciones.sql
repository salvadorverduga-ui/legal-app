-- 20260625_008_verificaciones.sql
-- Historial del proceso de verificación para abogados y estudios.
-- Cada solicitud de verificación genera una fila.
-- Cuando el admin aprueba/rechaza/suspende, un trigger propaga el estado
-- a abogados.verificacion o estudios.verificacion.
-- La tabla de verificaciones es la fuente de verdad del proceso;
-- los campos verificacion en abogados/estudios son denormalizados para RLS eficiente.

CREATE TABLE verificaciones (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pertenece a un abogado O a un estudio, nunca a ambos
  abogado_id            uuid REFERENCES abogados(id) ON DELETE CASCADE,
  estudio_id            uuid REFERENCES estudios(id) ON DELETE CASCADE,
  estado                estado_verificacion NOT NULL DEFAULT 'PENDIENTE',
  -- Documentos subidos por el solicitante (paths en Supabase Storage)
  doc_carnet_url        text,   -- abogados: foto del carnet del foro de abogados
  doc_cedula_url        text,   -- abogados: cédula de identidad
  doc_ruc_url           text,   -- estudios: RUC
  doc_nombramiento_url  text,   -- estudios: nombramiento del representante legal
  -- Campos completados por el admin al revisar
  motivo_rechazo        text,   -- visible para el solicitante al ser rechazado
  revisado_por          uuid REFERENCES perfiles(id) ON DELETE SET NULL,
  revisado_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verificacion_entidad_exclusiva CHECK (
    (abogado_id IS NOT NULL AND estudio_id IS NULL)
    OR (abogado_id IS NULL AND estudio_id IS NOT NULL)
  )
);

-- Índice para que el admin vea la cola de pendientes ordenada por antigüedad
CREATE INDEX idx_verificaciones_pendientes ON verificaciones (created_at ASC)
  WHERE estado = 'PENDIENTE';

COMMENT ON TABLE verificaciones IS 'Historial de verificaciones. Al aprobar/rechazar, el trigger propaga el estado a abogados.verificacion o estudios.verificacion.';
COMMENT ON COLUMN verificaciones.motivo_rechazo IS 'Se muestra al abogado/estudio para que pueda corregir y volver a enviar documentos.';

ALTER TABLE verificaciones ENABLE ROW LEVEL SECURITY;

-- El abogado puede ver el estado de su propia verificación
CREATE POLICY "abogado_ve_propia_verificacion" ON verificaciones
  FOR SELECT
  USING (abogado_id = auth.uid());

-- El representante del estudio puede ver el estado de verificación de su estudio
CREATE POLICY "estudio_ve_propia_verificacion" ON verificaciones
  FOR SELECT
  USING (
    estudio_id IN (
      SELECT id FROM estudios WHERE representante_legal_id = auth.uid()
    )
  );

-- Admin ve y gestiona todas las verificaciones
CREATE POLICY "admin_select_verificaciones" ON verificaciones
  FOR SELECT USING (es_admin());

CREATE POLICY "admin_update_verificaciones" ON verificaciones
  FOR UPDATE USING (es_admin());

-- El abogado o representante del estudio puede enviar una solicitud de verificación
CREATE POLICY "entidad_envia_verificacion" ON verificaciones
  FOR INSERT
  WITH CHECK (
    (abogado_id = auth.uid())
    OR (
      estudio_id IN (
        SELECT id FROM estudios WHERE representante_legal_id = auth.uid()
      )
    )
  );

-- Trigger: propaga el cambio de estado de verificación a la entidad correspondiente.
-- También registra quién hizo la revisión y cuándo.
CREATE OR REPLACE FUNCTION fn_propagar_estado_verificacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.abogado_id IS NOT NULL THEN
      UPDATE abogados
      SET verificacion = NEW.estado
      WHERE id = NEW.abogado_id;
    END IF;

    IF NEW.estudio_id IS NOT NULL THEN
      UPDATE estudios
      SET verificacion = NEW.estado
      WHERE id = NEW.estudio_id;
    END IF;

    -- Registrar al revisor (auth.uid() puede ser NULL si lo hace un proceso interno)
    NEW.revisado_por = auth.uid();
    NEW.revisado_at  = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_propagar_verificacion
  BEFORE UPDATE OF estado ON verificaciones
  FOR EACH ROW EXECUTE FUNCTION fn_propagar_estado_verificacion();

CREATE TRIGGER trg_verificaciones_updated_at
  BEFORE UPDATE ON verificaciones
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
