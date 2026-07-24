-- Fix: recursión de RLS en verificaciones al actualizar la fila PENDIENTE
-- propia (api.abogados.enviarDocumentosVerificacion / subir-documentos.js).
--
-- Diagnóstico (vía MCP, pg_policies):
-- La política "abogado_actualiza_verificacion_pendiente" (migración
-- 20260725_061) comparaba contra la fila previa con subconsultas como
--   (SELECT estado FROM verificaciones WHERE id = verificaciones.id)
-- Dentro de esa subconsulta, "FROM verificaciones" vuelve a introducir una
-- relación llamada "verificaciones" en el scope más interno — así que TANTO
-- el "id" suelto como el "verificaciones.id" calificado se resuelven contra
-- esa misma relación interna, no contra la fila externa que se está
-- actualizando (shadowing de nombre, no hay alias que la distinga). Postgres
-- lo dejó guardado en el catálogo exactamente así:
--   WHERE (verificaciones_1.id = verificaciones_1.id)
-- una tautología que nunca compara contra la fila real. Dos problemas a la
-- vez:
--   1) Seguridad: la restricción de columnas "congeladas" (estado,
--      revisado_por, revisado_at, motivo_rechazo) nunca se aplicaba de
--      verdad — solo compara el resultado de la subconsulta contra sí mismo.
--   2) Estabilidad: evaluar una subconsulta contra la misma tabla que la
--      política protege obliga a Postgres a re-aplicar el RLS de
--      "verificaciones" (política abogado_ve_propia_verificacion) dentro de
--      la propia evaluación de "abogado_actualiza_verificacion_pendiente",
--      lo que dispara "infinite recursion detected in policy" (42P17) —
--      mismo patrón ya documentado en CLAUDE.md §34 (fix_seguimiento_tablon):
--      el detector de recursión de RLS es una guardia estructural en tiempo
--      de planeación, no un análisis semántico, y se dispara según el plan
--      que elija el optimizador.
--
-- Fix (mismo patrón ya usado varias veces en este proyecto — fn_existe_bloqueo,
-- fn_rol_perfil, fn_cliente_dueno_caso_tablon): una función SECURITY DEFINER
-- que recibe el id explícito y bypassea el RLS de verificaciones al
-- resolverlo, rompiendo la auto-referencia. Al tomar el id como parámetro
-- (no una columna de "verificaciones" dentro de su propio FROM), tampoco hay
-- ninguna ambigüedad de nombres que resolver — corrige los dos problemas a
-- la vez.

CREATE OR REPLACE FUNCTION fn_verificacion_previa(p_id uuid)
RETURNS verificaciones
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM verificaciones WHERE id = p_id;
$$;

COMMENT ON FUNCTION fn_verificacion_previa(uuid) IS
  'Devuelve la fila de verificaciones por id, bypaseando RLS. Usada en la política abogado_actualiza_verificacion_pendiente para comparar contra la fila previa sin disparar recursión de RLS (ver comentario de la migración 066).';

DROP POLICY IF EXISTS "abogado_actualiza_verificacion_pendiente" ON verificaciones;

CREATE POLICY "abogado_actualiza_verificacion_pendiente" ON verificaciones
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    AND (fn_verificacion_previa(id)).estado = 'PENDIENTE'
    AND estado = 'PENDIENTE'
    AND revisado_por   IS NOT DISTINCT FROM (fn_verificacion_previa(id)).revisado_por
    AND revisado_at    IS NOT DISTINCT FROM (fn_verificacion_previa(id)).revisado_at
    AND motivo_rechazo IS NOT DISTINCT FROM (fn_verificacion_previa(id)).motivo_rechazo
  );

COMMENT ON POLICY "abogado_actualiza_verificacion_pendiente" ON verificaciones IS
  'Permite al abogado adjuntar sus documentos a la fila PENDIENTE creada automáticamente por el trigger, sin poder tocar estado, revisor ni motivo de rechazo. Compara contra la fila previa vía fn_verificacion_previa() (SECURITY DEFINER) para evitar la recursión/ambigüedad de RLS que tenía la subconsulta original.';

-- CLAUDE.md §12: toda función nueva necesita su GRANT en el mismo PR.
-- Solo authenticated la usa (la política de UPDATE en verificaciones nunca
-- corre para anon).
GRANT EXECUTE ON FUNCTION fn_verificacion_previa(uuid) TO authenticated;
