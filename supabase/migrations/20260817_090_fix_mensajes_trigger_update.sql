-- 20260817_090_fix_mensajes_trigger_update.sql
-- Fix HIGH 3 de la auditoría de Codex: aunque el fix 087 ya corrigió la
-- tautología concreta de "receptor_marca_leido" (alias explícito "m"),
-- ese WITH CHECK seguía dependiendo de cuatro subconsultas contra la propia
-- tabla mensajes dentro de una política de mensajes -- el mismo patrón
-- estructural que en este proyecto ya disparó "infinite recursion detected
-- in policy" (42P17) en otras tablas bajo ciertos planes del optimizador
-- (ver fix_recursion_definitiva_tablon / fix_recursion_verificaciones). No
-- se reprodujo recursión con el alias corregido, pero el patrón en sí es
-- justamente el que este proyecto viene evitando de forma sistemática cada
-- vez que aparece.
--
-- Fix: se elimina la dependencia de subconsultas por completo. Las columnas
-- congeladas pasan a un trigger BEFORE UPDATE que compara OLD vs NEW
-- directamente (sin ningún SELECT contra mensajes) -- estructuralmente
-- inmune a esta clase de bug, mismo principio que ya se aplicó moviendo
-- verificaciones de RLS a funciones SECURITY DEFINER en otros casos, pero
-- acá ni siquiera hace falta una función con SELECT: un trigger que compara
-- OLD/NEW no consulta la tabla en absoluto.

CREATE OR REPLACE FUNCTION fn_congelar_columnas_mensajes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id             IS DISTINCT FROM OLD.id
    OR NEW.solicitud_id IS DISTINCT FROM OLD.solicitud_id
    OR NEW.emisor_id    IS DISTINCT FROM OLD.emisor_id
    OR NEW.contenido    IS DISTINCT FROM OLD.contenido
    OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Solo se puede actualizar el estado de lectura de un mensaje.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_congelar_columnas_mensajes() IS
  'Congela id/solicitud_id/emisor_id/contenido/created_at en cualquier UPDATE sobre mensajes -- solo leido_por_receptor puede cambiar. Comparación directa OLD vs NEW, sin subconsultas (fix 090): reemplaza la versión anterior de este chequeo, que vivía como subconsultas correlacionadas dentro del WITH CHECK de "receptor_marca_leido" (mismo patrón que ya causó recursión de RLS en otras tablas de este proyecto).';

DROP TRIGGER IF EXISTS trg_congelar_columnas_mensajes ON mensajes;
CREATE TRIGGER trg_congelar_columnas_mensajes
  BEFORE UPDATE ON mensajes
  FOR EACH ROW EXECUTE FUNCTION fn_congelar_columnas_mensajes();

-- La política ya no necesita validar columnas congeladas -- el trigger de
-- arriba corre antes (BEFORE UPDATE) y aborta la transacción si se intenta
-- cambiar algo más que leido_por_receptor, así que RLS solo valida permisos.
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
  );

COMMENT ON POLICY "receptor_marca_leido" ON mensajes IS
  'El receptor (participante distinto de emisor_id) puede pasar leido_por_receptor a true. La restricción de "ninguna otra columna cambia" ya no vive acá -- la aplica el trigger fn_congelar_columnas_mensajes (fix 090), sin subconsultas contra mensajes dentro de esta política.';
