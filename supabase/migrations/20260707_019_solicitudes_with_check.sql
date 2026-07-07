-- 20260707_019_solicitudes_with_check.sql
-- Corrige un hueco de RLS en las políticas UPDATE de solicitudes (migración 006):
-- "abogado_responde_solicitud" y "cliente_completa_solicitud" solo tenían
-- USING (dueño de la fila), sin WITH CHECK. En PostgreSQL, si una política de
-- UPDATE no define WITH CHECK, se reutiliza el USING también para la fila
-- nueva — es decir, la única validación real era "es tu propia solicitud",
-- no "la transición de estado es válida".
--
-- Esto permitía, llamando directo a la REST API de Supabase (sin pasar por
-- frontend/js/api.js), que:
--   - un cliente forzara su propia solicitud de PENDIENTE a COMPLETADA sin
--     que el abogado la aceptara jamás, y luego insertara una reseña falsa
--     (resenas.cliente_inserta_resena solo exige estado IN ('COMPLETADA','RESEÑADA')).
--   - un cliente revirtiera una solicitud RECHAZADA/EXPIRADA a cualquier estado.
--   - un abogado aceptara/rechazara una solicitud que no está PENDIENTE, o
--     modificara cliente_id/descripcion_caso/disponibilidad_horaria de una
--     solicitud ya resuelta.
--
-- El patrón correcto ya existe en 007_resenas.sql (política
-- "abogado_responde_resena"): WITH CHECK con subconsultas contra la fila
-- actual para fijar qué transición y qué columnas son legítimas. Esta
-- migración aplica el mismo patrón a solicitudes.

DROP POLICY IF EXISTS "abogado_responde_solicitud" ON solicitudes;
CREATE POLICY "abogado_responde_solicitud" ON solicitudes
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    -- Solo se puede actuar sobre una solicitud que estaba PENDIENTE
    AND (SELECT estado FROM solicitudes WHERE id = solicitudes.id) = 'PENDIENTE'
    -- Y solo se permite moverla a ACEPTADA o RECHAZADA
    AND estado IN ('ACEPTADA', 'RECHAZADA')
    -- El abogado no puede reescribir los datos que el cliente envió ni reasignar la solicitud
    AND cliente_id = (SELECT cliente_id FROM solicitudes WHERE id = solicitudes.id)
    AND descripcion_caso IS NOT DISTINCT FROM (SELECT descripcion_caso FROM solicitudes WHERE id = solicitudes.id)
    AND disponibilidad_horaria IS NOT DISTINCT FROM (SELECT disponibilidad_horaria FROM solicitudes WHERE id = solicitudes.id)
  );

DROP POLICY IF EXISTS "cliente_completa_solicitud" ON solicitudes;
CREATE POLICY "cliente_completa_solicitud" ON solicitudes
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    AND (
      -- El cliente marca la consulta como completada tras el match
      ((SELECT estado FROM solicitudes WHERE id = solicitudes.id) = 'ACEPTADA' AND estado = 'COMPLETADA')
      -- api.resenas.crearResena transiciona a RESEÑADA en la misma sesión del cliente,
      -- inmediatamente después de insertar la reseña (frontend/js/api.js)
      OR ((SELECT estado FROM solicitudes WHERE id = solicitudes.id) = 'COMPLETADA' AND estado = 'RESEÑADA')
    )
  );

COMMENT ON POLICY "abogado_responde_solicitud" ON solicitudes IS
  'El abogado solo puede mover PENDIENTE -> ACEPTADA/RECHAZADA en solicitudes propias, sin alterar los datos enviados por el cliente.';
COMMENT ON POLICY "cliente_completa_solicitud" ON solicitudes IS
  'El cliente solo puede mover ACEPTADA -> COMPLETADA y COMPLETADA -> RESEÑADA en solicitudes propias.';
