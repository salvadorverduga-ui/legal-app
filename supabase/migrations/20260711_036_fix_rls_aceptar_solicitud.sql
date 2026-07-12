-- 20260711_036_fix_rls_aceptar_solicitud.sql
-- Corrige el bug reportado "No se pudo aceptar la solicitud" en panel-abogado.js.
--
-- Causa raíz (confirmada contra la base de datos real): las políticas WITH
-- CHECK agregadas en 019/023/033 escriben la subconsulta de correlación así:
--
--   (SELECT estado FROM solicitudes WHERE id = solicitudes.id)
--
-- El FROM de la subconsulta introduce una tabla llamada "solicitudes" —el
-- mismo nombre que la tabla objetivo del UPDATE. PostgreSQL resuelve la
-- referencia "solicitudes.id" de la cláusula WHERE contra el alcance más
-- interno que tiene una relación con ese nombre, que es la propia
-- subconsulta (renombrada internamente a "solicitudes_1"), no la fila
-- externa que se está actualizando. El resultado es una subconsulta
-- tautológica ("solicitudes_1.id = solicitudes_1.id", siempre verdadera)
-- que no filtra nada y devuelve TODAS las filas de la tabla en vez de una
-- sola. Verificado en vivo:
--
--   SELECT (SELECT estado FROM solicitudes WHERE id = solicitudes.id)
--   FROM solicitudes;
--   ERROR: 21000: more than one row returned by a subquery used as an expression
--
-- Con más de una solicitud en toda la tabla (caso normal en producción),
-- cualquier UPDATE que dispare estas políticas falla con ese error de
-- Postgres — de ahí "No se pudo aceptar la solicitud" en panel-abogado.js.
--
-- El mismo patrón roto se copió en cuatro políticas de "solicitudes"
-- (019, 023, 033) y en una de "notificaciones" (025, "usuario_marca_leida":
-- marcar una notificación como leída fallaba igual). Se corrigen las cinco
-- acá porque comparten la causa exacta.
--
-- Fix: alias explícito en la subconsulta (ej. "s") para que ya no haya
-- ambigüedad de nombre con la tabla externa, y la referencia sin alias
-- (ej. "solicitudes.id") se resuelva correctamente contra la fila externa.

-- ─── solicitudes ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "abogado_responde_solicitud" ON solicitudes;
CREATE POLICY "abogado_responde_solicitud" ON solicitudes
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    AND (SELECT s.estado FROM solicitudes s WHERE s.id = solicitudes.id) = 'PENDIENTE'
    AND estado IN ('ACEPTADA', 'RECHAZADA')
    AND cliente_id = (SELECT s.cliente_id FROM solicitudes s WHERE s.id = solicitudes.id)
    AND descripcion_caso IS NOT DISTINCT FROM (SELECT s.descripcion_caso FROM solicitudes s WHERE s.id = solicitudes.id)
    AND disponibilidad_horaria IS NOT DISTINCT FROM (SELECT s.disponibilidad_horaria FROM solicitudes s WHERE s.id = solicitudes.id)
  );

DROP POLICY IF EXISTS "cliente_completa_solicitud" ON solicitudes;
CREATE POLICY "cliente_completa_solicitud" ON solicitudes
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    AND (
      ((SELECT s.estado FROM solicitudes s WHERE s.id = solicitudes.id) = 'ACEPTADA' AND estado = 'COMPLETADA')
      OR ((SELECT s.estado FROM solicitudes s WHERE s.id = solicitudes.id) = 'COMPLETADA' AND estado = 'RESEÑADA')
    )
  );

DROP POLICY IF EXISTS "cliente_cancela_solicitud" ON solicitudes;
CREATE POLICY "cliente_cancela_solicitud" ON solicitudes
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    AND (SELECT s.estado FROM solicitudes s WHERE s.id = solicitudes.id) = 'PENDIENTE'
    AND estado = 'CANCELADA'
  );

DROP POLICY IF EXISTS "cliente_edita_solicitud_pendiente" ON solicitudes;
CREATE POLICY "cliente_edita_solicitud_pendiente" ON solicitudes
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    AND (SELECT s.estado FROM solicitudes s WHERE s.id = solicitudes.id) = 'PENDIENTE'
    AND estado = 'PENDIENTE'
    AND abogado_id = (SELECT s.abogado_id FROM solicitudes s WHERE s.id = solicitudes.id)
    AND cliente_telefono IS NOT DISTINCT FROM (SELECT s.cliente_telefono FROM solicitudes s WHERE s.id = solicitudes.id)
    AND cliente_email    IS NOT DISTINCT FROM (SELECT s.cliente_email    FROM solicitudes s WHERE s.id = solicitudes.id)
    AND motivo_rechazo   IS NOT DISTINCT FROM (SELECT s.motivo_rechazo   FROM solicitudes s WHERE s.id = solicitudes.id)
    AND expires_at       =                    (SELECT s.expires_at       FROM solicitudes s WHERE s.id = solicitudes.id)
    AND aceptada_at      IS NOT DISTINCT FROM (SELECT s.aceptada_at      FROM solicitudes s WHERE s.id = solicitudes.id)
    AND rechazada_at     IS NOT DISTINCT FROM (SELECT s.rechazada_at     FROM solicitudes s WHERE s.id = solicitudes.id)
    AND completada_at    IS NOT DISTINCT FROM (SELECT s.completada_at    FROM solicitudes s WHERE s.id = solicitudes.id)
  );

COMMENT ON POLICY "abogado_responde_solicitud" ON solicitudes IS
  'El abogado solo puede mover PENDIENTE -> ACEPTADA/RECHAZADA en solicitudes propias, sin alterar los datos enviados por el cliente. Subconsultas con alias "s" (fix migración 036: sin alias, "solicitudes.id" en el WHERE se resolvía contra la propia subconsulta, no la fila externa).';
COMMENT ON POLICY "cliente_completa_solicitud" ON solicitudes IS
  'El cliente solo puede mover ACEPTADA -> COMPLETADA y COMPLETADA -> RESEÑADA en solicitudes propias. Subconsultas con alias "s" (fix migración 036).';
COMMENT ON POLICY "cliente_cancela_solicitud" ON solicitudes IS
  'El cliente solo puede mover PENDIENTE -> CANCELADA en solicitudes propias. Subconsultas con alias "s" (fix migración 036).';
COMMENT ON POLICY "cliente_edita_solicitud_pendiente" ON solicitudes IS
  'El cliente puede actualizar descripcion_caso y disponibilidad_horaria de su propia solicitud solo mientras está PENDIENTE. Ninguna otra columna ni transición de estado está permitida por esta política. Subconsultas con alias "s" (fix migración 036).';

-- ─── notificaciones ─────────────────────────────────────────────────────────
-- Mismo bug: "marcar como leída" fallaba con el mismo error de Postgres en
-- cuanto hubiera más de una notificación en toda la tabla.

DROP POLICY IF EXISTS "usuario_marca_leida" ON notificaciones;
CREATE POLICY "usuario_marca_leida" ON notificaciones
  FOR UPDATE
  USING (usuario_id = auth.uid())
  WITH CHECK (
    usuario_id = auth.uid()
    AND leida = true
    AND tipo        IS NOT DISTINCT FROM (SELECT n.tipo        FROM notificaciones n WHERE n.id = notificaciones.id)
    AND titulo      IS NOT DISTINCT FROM (SELECT n.titulo      FROM notificaciones n WHERE n.id = notificaciones.id)
    AND mensaje     IS NOT DISTINCT FROM (SELECT n.mensaje     FROM notificaciones n WHERE n.id = notificaciones.id)
    AND url_destino IS NOT DISTINCT FROM (SELECT n.url_destino FROM notificaciones n WHERE n.id = notificaciones.id)
  );

COMMENT ON POLICY "usuario_marca_leida" ON notificaciones IS
  'El usuario solo puede transicionar leida de false a true en notificaciones propias, sin alterar el resto de columnas. Subconsultas con alias "n" (fix migración 036).';
