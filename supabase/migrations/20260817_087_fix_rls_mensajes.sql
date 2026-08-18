-- 20260817_087_fix_rls_mensajes.sql
-- Corrige el bug reportado en la revisión estática del chat interno:
-- "receptor_marca_leido" (mensajes, migración 083) falla al marcar mensajes
-- como leídos.
--
-- Causa raíz (confirmada contra la base de datos real, transacción con
-- ROLLBACK): el WITH CHECK escribía la subconsulta de correlación así:
--
--   (SELECT solicitud_id FROM mensajes WHERE id = mensajes.id)
--
-- El FROM de la subconsulta introduce una tabla llamada "mensajes" — el
-- mismo nombre que la tabla objetivo del UPDATE. PostgreSQL resuelve la
-- referencia "mensajes.id" de la cláusula WHERE contra el alcance más
-- interno que tiene una relación con ese nombre, que es la propia
-- subconsulta (renombrada internamente a "mensajes_1"), no la fila externa
-- que se está actualizando. El resultado es una subconsulta tautológica
-- ("mensajes_1.id = mensajes_1.id", siempre verdadera) que no filtra nada y
-- devuelve TODAS las filas de la tabla en vez de una sola. Verificado en
-- vivo (insertando 2 mensajes de prueba y marcando uno como leído):
--
--   ERROR: 21000: more than one row returned by a subquery used as an expression
--
-- Exactamente el mismo bug ya corregido en este proyecto para "solicitudes"
-- y "notificaciones" (migración 036) y para "aplicaciones_tablon"
-- (045/046/048) — se copió sin querer al escribir mensajes en la migración
-- 083, sin haber revisado ese historial en el momento.
--
-- Fix: mismo patrón que la 036 — alias explícito en la subconsulta ("m")
-- para que ya no haya ambigüedad de nombre con la tabla externa, y la
-- referencia sin alias ("mensajes.id") se resuelva correctamente contra la
-- fila externa que el UPDATE está evaluando.

DROP POLICY IF EXISTS "receptor_marca_leido" ON mensajes;
CREATE POLICY "receptor_marca_leido" ON mensajes
  FOR UPDATE
  USING (
    fn_es_participante_solicitud(solicitud_id)
    AND emisor_id <> auth.uid()
  )
  WITH CHECK (
    fn_es_participante_solicitud(solicitud_id)
    AND emisor_id <> auth.uid()
    AND leido_por_receptor = true
    AND solicitud_id IS NOT DISTINCT FROM (SELECT m.solicitud_id FROM mensajes m WHERE m.id = mensajes.id)
    AND emisor_id    IS NOT DISTINCT FROM (SELECT m.emisor_id    FROM mensajes m WHERE m.id = mensajes.id)
    AND contenido    IS NOT DISTINCT FROM (SELECT m.contenido    FROM mensajes m WHERE m.id = mensajes.id)
    AND created_at   IS NOT DISTINCT FROM (SELECT m.created_at   FROM mensajes m WHERE m.id = mensajes.id)
  );

COMMENT ON POLICY "receptor_marca_leido" ON mensajes IS
  'El receptor (participante distinto de emisor_id) solo puede pasar leido_por_receptor de false a true, sin tocar ninguna otra columna. Subconsultas con alias "m" (fix migración 087, mismo patrón que 036/045/046/048) -- sin alias, "mensajes.id" en el WHERE se resolvía contra la propia subconsulta en vez de la fila externa, produciendo una tautología que hacía fallar el UPDATE con "more than one row returned by a subquery used as an expression" en cuanto había 2+ mensajes en toda la tabla.';
