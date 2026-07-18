-- 20260723_058_fix_seguimiento_tablon.sql
-- CLAUDE.md módulo 9: bug reportado — al marcar seguimiento desde el cliente
-- en un caso de El Tablón, a veces aparece error y el caso no aparece en
-- "En seguimiento".
--
-- DIAGNÓSTICO: se reprodujo en vivo (BEGIN + SET LOCAL ROLE authenticated +
-- request.jwt.claims + ROLLBACK, mismo método que la migración 046) el flujo
-- completo de api.seguimiento.toggleTablon() -> api.seguimiento.getMisSeguimientos()
-- para un cliente real: UPDATE aplicaciones_tablon SET en_seguimiento_cliente,
-- luego SELECT sobre aplicaciones_tablon y tablon_caso_detalle. Las tres
-- consultas funcionan sin error hoy -- no se logró reproducir "infinite
-- recursion detected in policy" de forma determinística.
--
-- Sin embargo, la propia migración 046 (que corrigió el mismo síntoma para
-- "abogado_actualiza_seguimiento_aplicacion" y "cliente_cierra_caso_tablon")
-- deja registrado que el detector de recursión de Postgres (42P17) es "una
-- guardia estructural en tiempo de planeación, no un análisis semántico" que
-- "puede dispararse de forma dependiente del plan exacto incluso con
-- subconsultas correctamente correlacionadas" -- es decir, no determinístico:
-- que un caso puntual no falle hoy no prueba que el patrón sea seguro en
-- todos los planes futuros (cambios de estadísticas, de índices, del
-- optimizador). "cliente_elige_aplicacion_tablon" (la política detrás de
-- toggleTablon del lado del cliente) y "cliente_ve_aplicaciones_de_sus_casos"
-- (la política detrás del SELECT de getMisSeguimientos()) todavía usan
-- exactamente ese patrón frágil: una subconsulta correlacionada contra
-- casos_tablon embebida directamente en la política de aplicaciones_tablon.
--
-- FIX: mismo principio que fn_rol_perfil/es_admin/fn_existe_bloqueo -- mover
-- la verificación de propiedad del caso a una función SECURITY DEFINER. Al
-- ser SECURITY DEFINER, la consulta a casos_tablon dentro de la función NO
-- pasa por el RLS de casos_tablon (bypass total), así que no hay ninguna
-- subconsulta correlacionada dentro de la política en sí -- elimina la
-- clase de bug por completo en vez de esperar a que un plan distinto la
-- vuelva a disparar en producción.

CREATE OR REPLACE FUNCTION fn_cliente_dueno_caso_tablon(p_caso_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM casos_tablon WHERE id = p_caso_id AND cliente_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION fn_cliente_dueno_caso_tablon(uuid) IS
  'true si el caso de El Tablón pertenece al cliente autenticado. SECURITY DEFINER: evita que las políticas de aplicaciones_tablon que la usan disparen una re-evaluación de las políticas de casos_tablon (fix 058, mismo síntoma que ya resolvió la migración 046 para otras políticas de esta misma tabla).';

GRANT EXECUTE ON FUNCTION fn_cliente_dueno_caso_tablon(uuid) TO authenticated;

DROP POLICY IF EXISTS "cliente_elige_aplicacion_tablon" ON aplicaciones_tablon;
CREATE POLICY "cliente_elige_aplicacion_tablon" ON aplicaciones_tablon
  FOR UPDATE
  USING (fn_cliente_dueno_caso_tablon(caso_id))
  WITH CHECK (fn_cliente_dueno_caso_tablon(caso_id));

DROP POLICY IF EXISTS "cliente_ve_aplicaciones_de_sus_casos" ON aplicaciones_tablon;
CREATE POLICY "cliente_ve_aplicaciones_de_sus_casos" ON aplicaciones_tablon
  FOR SELECT
  USING (fn_cliente_dueno_caso_tablon(caso_id));

COMMENT ON POLICY "cliente_elige_aplicacion_tablon" ON aplicaciones_tablon IS
  'El cliente actualiza aplicaciones de sus propios casos (elegir abogado, alternar en_seguimiento_cliente). Mismo alcance que antes de la 058, solo cambia el mecanismo de verificación de propiedad (fn_cliente_dueno_caso_tablon en vez de subconsulta embebida) por estabilidad frente al detector de recursión de RLS.';
