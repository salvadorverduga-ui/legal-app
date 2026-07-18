-- 20260720_054_resena_minimo_24h.sql
-- CLAUDE.md módulo 5: una solicitud solo puede ser reseñada si pasaron al
-- menos 24 horas desde que transicionó a COMPLETADA.
--
-- No hace falta agregar ninguna columna: solicitudes.completada_at ya existe
-- desde la migración 20260625_006_solicitudes.sql y fn_revelar_contacto_al_aceptar
-- ya la setea con now() en la transición ACEPTADA -> COMPLETADA (única
-- transición posible hacia COMPLETADA, forzada por la política RLS
-- "cliente_completa_solicitud" de solicitudes). Solo hace falta extender la
-- condición de la política de INSERT de resenas.

DROP POLICY IF EXISTS "cliente_inserta_resena" ON resenas;
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
        AND s.completada_at IS NOT NULL
        AND s.completada_at <= now() - INTERVAL '24 hours'
    )
  );

COMMENT ON POLICY "cliente_inserta_resena" ON resenas IS
  'El cliente reseña su propia solicitud COMPLETADA/RESEÑADA, y solo a partir de 24h desde solicitudes.completada_at (CLAUDE.md módulo 5).';
