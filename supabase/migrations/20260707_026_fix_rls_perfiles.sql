-- 20260707_026_fix_rls_perfiles.sql
-- Corrige "infinite recursion detected in policy for relation perfiles" al
-- actualizar el propio perfil (frontend/js/api.js: perfiles.actualizarPerfil).
--
-- CAUSA: la política "perfil_propio_update" (migración 001) usa, dentro de
-- su propio WITH CHECK, un subquery sin protección contra la propia tabla:
--
--   rol = (SELECT rol FROM perfiles WHERE id = auth.uid())
--
-- Evaluar ese subquery obliga a Postgres a re-aplicar las políticas SELECT
-- de perfiles sobre esa misma fila, lo que dispara una re-evaluación
-- indefinida de las políticas de la tabla -- el mismo problema que el
-- comentario de es_admin() en la migración 001 ya advertía ("SECURITY
-- DEFINER para poder leer la tabla perfiles sin recursión infinita"), pero
-- que no se aplicó también al WITH CHECK de UPDATE.
--
-- FIX: mismo patrón que es_admin() -- envolver la lectura del rol actual en
-- una función SECURITY DEFINER (dueña de la tabla, bypassea RLS) en lugar
-- de un subquery directo sujeto a las políticas de perfiles.

CREATE OR REPLACE FUNCTION fn_rol_perfil(p_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT rol FROM perfiles WHERE id = p_id;
$$;

COMMENT ON FUNCTION fn_rol_perfil(uuid) IS
  'Retorna el rol almacenado de un perfil sin pasar por RLS (SECURITY DEFINER). Usada por la política "perfil_propio_update" para validar que el usuario no cambie su propio rol sin causar recursión.';

GRANT EXECUTE ON FUNCTION fn_rol_perfil(uuid) TO authenticated;

DROP POLICY IF EXISTS "perfil_propio_update" ON perfiles;
CREATE POLICY "perfil_propio_update" ON perfiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND rol = fn_rol_perfil(auth.uid())
  );

COMMENT ON POLICY "perfil_propio_update" ON perfiles IS
  'El usuario actualiza su propio perfil sin poder cambiar el rol. Usa fn_rol_perfil() (SECURITY DEFINER) en vez de un subquery directo sobre perfiles para evitar recursión de RLS.';
