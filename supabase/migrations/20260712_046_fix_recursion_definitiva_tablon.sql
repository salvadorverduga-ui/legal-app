-- 20260712_046_fix_recursion_definitiva_tablon.sql
-- La migración 045 corrigió el alias de las subconsultas autoreferenciadas
-- en aplicaciones_tablon/casos_tablon (mismo patrón que la 036 para
-- solicitudes), pero el bug "infinite recursion detected in policy for
-- relation aplicaciones_tablon" persistió al ejecutar elegirAbogado()
-- (PATCH a aplicaciones_tablon).
--
-- DIAGNÓSTICO (verificado en vivo contra la base de datos real, reproduciendo
-- el UPDATE exacto que hace elegirAbogado() con SET LOCAL ROLE authenticated
-- + request.jwt.claims, dentro de transacciones con ROLLBACK):
--
--   1. Con la política "abogado_actualiza_seguimiento_aplicacion" (fix 045,
--      con alias "ap") presente, CUALQUIER UPDATE a aplicaciones_tablon
--      falla con 42P17, incluso uno hecho por el CLIENTE (que no matchea el
--      USING de esa política — abogado_id = auth.uid() — así que en teoría
--      no debería ni entrar en juego).
--   2. Al DROP de esa única política, el mismo UPDATE del cliente funciona
--      sin error. Esto confirma que la política es la causante.
--   3. El mismo patrón (subconsulta autoreferenciada con alias correcto) en
--      "cliente_cierra_caso_tablon" (casos_tablon, también fix 045) tiene el
--      MISMO problema: recursion incluso reduciendo su WITH CHECK a una sola
--      cláusula autoreferenciada.
--   4. Sorprendentemente, el idéntico patrón en las políticas de
--      "solicitudes" (migración 036: abogado_responde_solicitud,
--      cliente_completa_solicitud, etc.) SÍ funciona sin recursion, probado
--      en vivo con los mismos pasos. No se pudo aislar una diferencia
--      estructural concluyente entre "solicitudes" (funciona) y
--      "casos_tablon"/"aplicaciones_tablon" (no funciona) — se probó con una
--      tabla nueva mínima con el mismo patrón (funciona), reduciendo la
--      política a una sola cláusula (sigue fallando en casos_tablon),
--      agregando un trigger BEFORE UPDATE extra (sin efecto) y revisando
--      columnas/constraints/índices (sin diferencias relevantes). El
--      detector de recursión de políticas de Postgres (42P17) es una guarda
--      estructural en tiempo de planeación, no un análisis semántico — puede
--      dispararse de forma dependiente del plan exacto incluso con
--      subconsultas correctamente correlacionadas. No vale la pena seguir
--      derivando la causa exacta cuando existe un fix estructuralmente
--      inmune al problema (ver abajo).
--
-- FIX DEFINITIVO: eliminar por completo las subconsultas autoreferenciadas
-- de las políticas RLS de aplicaciones_tablon y casos_tablon. En su lugar,
-- un trigger BEFORE UPDATE compara OLD vs NEW directamente (sin volver a
-- consultar la tabla — OLD/NEW ya están disponibles nativamente dentro de
-- un trigger), así que no hay ninguna referencia a la tabla protegida desde
-- dentro de su propia política ni de su propio trigger. Verificado en vivo
-- (mismo método de reproducción) que este patrón no dispara recursión, ni
-- para el caso "abogado alterna su propio seguimiento" ni para "cliente
-- elige a un abogado" (el UPDATE real de elegirAbogado()) ni para "cliente
-- cierra su propio caso".
--
-- Nota para seguimiento futuro: "solicitudes" (migración 036) usa el mismo
-- patrón de subconsulta autoreferenciada y hoy no reproduce el bug, pero
-- comparte la causa raíz (self-reference dentro de una política RLS) y
-- debería migrarse al mismo patrón de trigger en un cambio aparte, no
-- incluido acá para no tocar sin necesidad una tabla núcleo que hoy
-- funciona.

-- ─── aplicaciones_tablon ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon;
CREATE POLICY "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (abogado_id = auth.uid());

COMMENT ON POLICY "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon IS
  'El abogado puede actualizar su propia aplicación (fila). La restricción de qué columna puede cambiar (solo en_seguimiento_abogado) vive en el trigger fn_restringir_columnas_aplicaciones_tablon, no acá — una subconsulta autoreferenciada en el WITH CHECK, aunque tenga alias correcto, dispara "infinite recursion detected in policy" (fix 046; el intento con subconsulta aliasada de la migración 045 no fue suficiente).';

CREATE OR REPLACE FUNCTION fn_restringir_columnas_aplicaciones_tablon()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Solo se restringe cuando quien actualiza es el abogado dueño de la
  -- aplicación. El cliente (vía "cliente_elige_aplicacion_tablon") sigue sin
  -- restricción de columnas — ese comportamiento no cambia con este fix.
  IF auth.uid() = OLD.abogado_id THEN
    IF NEW.caso_id                IS DISTINCT FROM OLD.caso_id
    OR NEW.mensaje                IS DISTINCT FROM OLD.mensaje
    OR NEW.estado                 IS DISTINCT FROM OLD.estado
    OR NEW.abogado_id             IS DISTINCT FROM OLD.abogado_id
    OR NEW.en_seguimiento_cliente IS DISTINCT FROM OLD.en_seguimiento_cliente
    THEN
      RAISE EXCEPTION 'El abogado solo puede alternar en_seguimiento_abogado en su propia aplicación.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_restringir_columnas_aplicaciones_tablon() IS
  'Reemplaza la restricción de columnas que antes vivía en el WITH CHECK de abogado_actualiza_seguimiento_aplicacion (fix 046, ver comentario de la política). Usa OLD/NEW nativos del trigger — no necesita re-consultar aplicaciones_tablon, así que no puede disparar recursión de políticas.';

DROP TRIGGER IF EXISTS trg_restringir_columnas_aplicaciones_tablon ON aplicaciones_tablon;
CREATE TRIGGER trg_restringir_columnas_aplicaciones_tablon
  BEFORE UPDATE ON aplicaciones_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_restringir_columnas_aplicaciones_tablon();

-- ─── casos_tablon ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cliente_cierra_caso_tablon" ON casos_tablon;
CREATE POLICY "cliente_cierra_caso_tablon" ON casos_tablon
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (cliente_id = auth.uid());

COMMENT ON POLICY "cliente_cierra_caso_tablon" ON casos_tablon IS
  'El cliente puede actualizar su propio caso (fila). La restricción de qué transición/columnas se permiten (ACTIVO -> CERRADO, sin tocar el resto) vive en el trigger fn_restringir_cierre_caso_tablon, no acá (fix 046, mismo motivo que aplicaciones_tablon — ver comentario de esa política).';

CREATE OR REPLACE FUNCTION fn_restringir_cierre_caso_tablon()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = OLD.cliente_id THEN
    IF OLD.estado IS DISTINCT FROM 'ACTIVO'
    OR NEW.estado IS DISTINCT FROM 'CERRADO'
    OR NEW.titulo       IS DISTINCT FROM OLD.titulo
    OR NEW.descripcion  IS DISTINCT FROM OLD.descripcion
    OR NEW.especialidad IS DISTINCT FROM OLD.especialidad
    OR NEW.caso_comun   IS DISTINCT FROM OLD.caso_comun
    OR NEW.provincia    IS DISTINCT FROM OLD.provincia
    OR NEW.ciudad       IS DISTINCT FROM OLD.ciudad
    OR NEW.anonimo      IS DISTINCT FROM OLD.anonimo
    OR NEW.cliente_id   IS DISTINCT FROM OLD.cliente_id
    OR NEW.expires_at   IS DISTINCT FROM OLD.expires_at
    THEN
      RAISE EXCEPTION 'El cliente solo puede transicionar su propio caso de ACTIVO a CERRADO, sin cambiar ninguna otra columna.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_restringir_cierre_caso_tablon() IS
  'Reemplaza la restricción de transición/columnas que antes vivía en el WITH CHECK de cliente_cierra_caso_tablon (fix 046, ver comentario de la política). Usa OLD/NEW nativos del trigger — no necesita re-consultar casos_tablon.';

DROP TRIGGER IF EXISTS trg_restringir_cierre_caso_tablon ON casos_tablon;
CREATE TRIGGER trg_restringir_cierre_caso_tablon
  BEFORE UPDATE ON casos_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_restringir_cierre_caso_tablon();
