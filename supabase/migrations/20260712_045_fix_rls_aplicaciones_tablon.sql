-- 20260712_045_fix_rls_aplicaciones_tablon.sql
-- Bug crítico reportado: "infinite recursion detected in policy for relation
-- aplicaciones_tablon". Mismo bug ya corregido en solicitudes/notificaciones
-- (20260711_036_fix_rls_aceptar_solicitud.sql): una política WITH CHECK
-- escribe la subconsulta de correlación sin alias, por ejemplo
--
--   (SELECT estado FROM aplicaciones_tablon WHERE id = aplicaciones_tablon.id)
--
-- El FROM de la subconsulta introduce una relación llamada
-- "aplicaciones_tablon" —el mismo nombre que la tabla objetivo del UPDATE—
-- así que la referencia "aplicaciones_tablon.id" del WHERE se resuelve
-- contra el alcance más interno (la propia subconsulta), no contra la fila
-- externa que se está actualizando. Además de la tautología resultante
-- (mismo problema que en la 036), al ser una tabla con RLS habilitado
-- Postgres debe volver a aplicar las políticas de esa misma relación para
-- resolver la subconsulta, y con la referencia mal resuelta esto dispara el
-- chequeo de recursión de políticas (42P17, "infinite recursion detected in
-- policy for relation ...") en vez de (o además de) el error de "more than
-- one row returned" que se vio en la 036 — mismo origen, síntoma distinto
-- según la forma exacta de la política.
--
-- Fix: alias explícito en la subconsulta para que la referencia sin alias
-- a la tabla externa se resuelva correctamente (mismo patrón que la 036).

-- ────────────────────────────────────────────────────────────
-- Revisión de TODAS las políticas de aplicaciones_tablon, casos_tablon y
-- referidos (pedido explícito del reporte de bug):
--
-- aplicaciones_tablon (migración 040/041):
--   - abogado_ve_propias_aplicaciones_tablon (SELECT)              -> OK, sin subconsulta
--   - cliente_ve_aplicaciones_de_sus_casos (SELECT)                -> OK, subconsulta a casos_tablon con alias "c"
--   - admin_ve_aplicaciones_tablon (SELECT)                        -> OK, sin subconsulta
--   - abogado_aplica_tablon (INSERT)                               -> OK, subconsultas a abogados/casos_tablon con alias "a"/"c"
--   - cliente_elige_aplicacion_tablon (UPDATE)                     -> OK, subconsulta a casos_tablon con alias "c"
--   - abogado_actualiza_seguimiento_aplicacion (UPDATE, 041)       -> ROTA, se corrige acá
--
-- casos_tablon (migración 040/041):
--   - cliente_ve_propios_casos_tablon (SELECT)                     -> OK, sin subconsulta
--   - abogado_ve_casos_activos_tablon (SELECT)                     -> OK, subconsulta a abogados con alias "a"
--   - admin_ve_casos_tablon (SELECT)                               -> OK, sin subconsulta
--   - cliente_crea_caso_tablon (INSERT)                            -> OK, subconsulta a perfiles (tabla distinta, sin ambigüedad posible)
--   - cliente_cierra_caso_tablon (UPDATE, 041)                     -> ROTA, se corrige acá
--
-- referidos (migración 043):
--   - abogado_ve_propios_referidos (SELECT)                        -> OK, sin subconsulta
--   - admin_ve_referidos (SELECT)                                  -> OK, sin subconsulta
--   Ninguna política de referidos tiene subconsultas autoreferenciadas —
--   no requiere cambios.
--
-- (abogados.abogado_update_propio, tocada en la migración 043, usa
-- "WHERE id = auth.uid()" en vez de "WHERE id = abogados.id" — auth.uid()
-- es una llamada a función, no una referencia a la tabla externa, así que
-- no sufre la ambigüedad de nombres y no es el mismo bug.)
-- ────────────────────────────────────────────────────────────

-- ─── aplicaciones_tablon ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon;
CREATE POLICY "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    AND caso_id                IS NOT DISTINCT FROM (SELECT ap.caso_id                FROM aplicaciones_tablon ap WHERE ap.id = aplicaciones_tablon.id)
    AND mensaje                IS NOT DISTINCT FROM (SELECT ap.mensaje                FROM aplicaciones_tablon ap WHERE ap.id = aplicaciones_tablon.id)
    AND estado                 IS NOT DISTINCT FROM (SELECT ap.estado                 FROM aplicaciones_tablon ap WHERE ap.id = aplicaciones_tablon.id)
    AND en_seguimiento_cliente IS NOT DISTINCT FROM (SELECT ap.en_seguimiento_cliente FROM aplicaciones_tablon ap WHERE ap.id = aplicaciones_tablon.id)
  );

COMMENT ON POLICY "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon IS
  'El abogado puede alternar únicamente en_seguimiento_abogado en su propia aplicación. Ninguna otra columna puede cambiar por esta política. Subconsultas con alias "ap" (fix migración 045: sin alias, "aplicaciones_tablon.id" en el WHERE se resolvía contra la propia subconsulta, no la fila externa — mismo bug que la migración 036).';

-- ─── casos_tablon ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cliente_cierra_caso_tablon" ON casos_tablon;
CREATE POLICY "cliente_cierra_caso_tablon" ON casos_tablon
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    AND estado = 'CERRADO'
    AND (SELECT c.estado FROM casos_tablon c WHERE c.id = casos_tablon.id) = 'ACTIVO'
    AND titulo       = (SELECT c.titulo       FROM casos_tablon c WHERE c.id = casos_tablon.id)
    AND descripcion  = (SELECT c.descripcion  FROM casos_tablon c WHERE c.id = casos_tablon.id)
    AND especialidad = (SELECT c.especialidad FROM casos_tablon c WHERE c.id = casos_tablon.id)
    AND caso_comun   IS NOT DISTINCT FROM (SELECT c.caso_comun FROM casos_tablon c WHERE c.id = casos_tablon.id)
    AND provincia    IS NOT DISTINCT FROM (SELECT c.provincia  FROM casos_tablon c WHERE c.id = casos_tablon.id)
    AND ciudad       IS NOT DISTINCT FROM (SELECT c.ciudad     FROM casos_tablon c WHERE c.id = casos_tablon.id)
    AND anonimo      = (SELECT c.anonimo      FROM casos_tablon c WHERE c.id = casos_tablon.id)
    AND expires_at   = (SELECT c.expires_at   FROM casos_tablon c WHERE c.id = casos_tablon.id)
  );

COMMENT ON POLICY "cliente_cierra_caso_tablon" ON casos_tablon IS
  'El cliente puede transicionar su propio caso de ACTIVO a CERRADO, y ninguna otra columna ni transición. Subconsultas con alias "c" (fix migración 045, mismo bug que la migración 036).';
