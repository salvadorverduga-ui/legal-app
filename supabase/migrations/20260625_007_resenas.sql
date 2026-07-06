-- 20260625_007_resenas.sql
-- Reseñas verificadas: solo una por solicitud COMPLETADA.
-- La FK a solicitudes garantiza que la solicitud existe.
-- La política RLS de INSERT valida que la solicitud esté COMPLETADA y pertenezca al cliente.
-- Las reseñas nunca se borran físicamente: se ocultan (oculta=true) por admin si es necesario.
-- Se conservan aunque el perfil del abogado esté inactivo por vencimiento de suscripción.

CREATE TABLE resenas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE en solicitud_id: solo una reseña por solicitud
  solicitud_id      uuid NOT NULL UNIQUE REFERENCES solicitudes(id) ON DELETE RESTRICT,
  cliente_id        uuid NOT NULL REFERENCES perfiles(id) ON DELETE RESTRICT,
  abogado_id        uuid NOT NULL REFERENCES abogados(id) ON DELETE RESTRICT,
  calificacion      smallint NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
  comentario        text,
  -- Respuesta pública del abogado (opcional)
  respuesta_abogado text,
  respuesta_at      timestamptz,
  -- Moderación por admin
  oculta            boolean NOT NULL DEFAULT false,   -- true = no visible en perfil; nunca se borra físicamente
  moderada          boolean NOT NULL DEFAULT false,   -- true = revisada por admin
  reportada         boolean NOT NULL DEFAULT false,
  motivo_reporte    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resenas_abogado ON resenas (abogado_id, oculta, created_at DESC);
CREATE INDEX idx_resenas_cliente ON resenas (cliente_id, created_at DESC);

COMMENT ON TABLE resenas IS 'Reseñas verificadas. Solo una por solicitud COMPLETADA. Nunca se eliminan físicamente; se ocultan vía admin.';
COMMENT ON COLUMN resenas.oculta IS 'true = no aparece en el perfil público. El dato permanece en la base de datos para auditoría.';
COMMENT ON COLUMN resenas.solicitud_id IS 'UNIQUE: impide que un cliente deje más de una reseña por solicitud. ON DELETE RESTRICT: la solicitud no se puede borrar si tiene reseña.';

ALTER TABLE resenas ENABLE ROW LEVEL SECURITY;

-- Las reseñas no ocultas son visibles para todos los autenticados (se muestran en perfil público)
CREATE POLICY "resenas_visibles_select" ON resenas
  FOR SELECT
  TO authenticated
  USING (oculta = false);

-- Admin puede ver todo incluyendo reseñas ocultas
CREATE POLICY "admin_ve_resenas" ON resenas
  FOR SELECT USING (es_admin());

-- El cliente puede ver sus propias reseñas (incluyendo las ocultas por si tiene algún problema)
CREATE POLICY "cliente_ve_propias_resenas" ON resenas
  FOR SELECT
  USING (cliente_id = auth.uid());

-- Solo el cliente puede insertar una reseña.
-- Condiciones: la solicitud debe estar COMPLETADA o RESEÑADA y pertenecer al cliente.
-- La transición a RESEÑADA la hace la Edge Function después de insertar aquí.
CREATE POLICY "cliente_inserta_resena" ON resenas
  FOR INSERT
  WITH CHECK (
    cliente_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM solicitudes s
      WHERE s.id = solicitud_id
        AND s.cliente_id = auth.uid()
        AND s.estado IN ('COMPLETADA', 'RESEÑADA')
        AND s.abogado_id = resenas.abogado_id
    )
  );

-- El abogado puede agregar o editar su respuesta pública.
-- No puede modificar calificación, comentario ni datos del cliente.
CREATE POLICY "abogado_responde_resena" ON resenas
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    -- Columnas que el abogado puede modificar: solo respuesta_abogado y respuesta_at
    AND calificacion = (SELECT calificacion FROM resenas WHERE id = resenas.id)
    AND comentario IS NOT DISTINCT FROM (SELECT comentario FROM resenas WHERE id = resenas.id)
    AND oculta = (SELECT oculta FROM resenas WHERE id = resenas.id)
  );

-- Admin puede moderar: ocultar, marcar como moderada, etc.
CREATE POLICY "admin_modera_resenas" ON resenas
  FOR UPDATE USING (es_admin());

-- Trigger: al insertar/modificar/ocultar una reseña, recalcular rating_promedio y total_resenas
-- en el abogado. Solo cuenta las reseñas no ocultas.
CREATE OR REPLACE FUNCTION fn_recalcular_rating_abogado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_abogado_id uuid;
  v_promedio   numeric(3,2);
  v_total      integer;
BEGIN
  -- Para DELETE usa OLD; para INSERT/UPDATE usa NEW
  v_abogado_id := COALESCE(NEW.abogado_id, OLD.abogado_id);

  SELECT
    ROUND(COALESCE(AVG(calificacion), 0)::numeric, 2),
    COUNT(*) FILTER (WHERE oculta = false)
  INTO v_promedio, v_total
  FROM resenas
  WHERE abogado_id = v_abogado_id
    AND oculta = false;

  UPDATE abogados
  SET rating_promedio = v_promedio,
      total_resenas   = v_total
  WHERE id = v_abogado_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_recalcular_rating_insert_update
  AFTER INSERT OR UPDATE OF oculta, calificacion ON resenas
  FOR EACH ROW EXECUTE FUNCTION fn_recalcular_rating_abogado();

CREATE TRIGGER trg_recalcular_rating_delete
  AFTER DELETE ON resenas
  FOR EACH ROW EXECUTE FUNCTION fn_recalcular_rating_abogado();

CREATE TRIGGER trg_resenas_updated_at
  BEFORE UPDATE ON resenas
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
