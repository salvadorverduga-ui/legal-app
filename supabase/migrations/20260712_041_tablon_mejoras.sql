-- 20260712_041_tablon_mejoras.sql
-- Rediseño de El Tablón (migración 040): ubicación en los casos, flujo de
-- contacto DIRECTO al elegir abogado, cierre manual de casos y la base para
-- "En seguimiento" (frontend, próxima migración/módulo).

-- ────────────────────────────────────────────────────────────
-- COLUMNAS NUEVAS: casos_tablon
-- ────────────────────────────────────────────────────────────
-- provincia/ciudad siguen el mismo criterio que perfiles.provincia
-- (migración 20260706_013): texto libre, opcional, sin CHECK — la lista de
-- 24 provincias se valida en el <select> del frontend, no en la BD.
ALTER TABLE casos_tablon
  ADD COLUMN provincia text,
  ADD COLUMN ciudad    text;

COMMENT ON COLUMN casos_tablon.provincia IS 'Texto libre (nombre de una de las 24 provincias del Ecuador), opcional. Mismo criterio que perfiles.provincia.';
COMMENT ON COLUMN casos_tablon.ciudad IS 'Texto libre, opcional.';

-- ────────────────────────────────────────────────────────────
-- COLUMNAS NUEVAS: aplicaciones_tablon ("En seguimiento")
-- Cada parte marca SU PROPIA aplicación como "en seguimiento": el cliente,
-- para dar prioridad a un aplicante concreto entre varios (se muestra por
-- aplicación en tablon-caso.html, no por caso completo — un caso puede
-- tener múltiples aplicantes); el abogado, sobre su propia aplicación, para
-- encontrarla rápido en su pestaña "En seguimiento".
-- ────────────────────────────────────────────────────────────
ALTER TABLE aplicaciones_tablon
  ADD COLUMN en_seguimiento_cliente  boolean NOT NULL DEFAULT false,
  ADD COLUMN en_seguimiento_abogado  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN aplicaciones_tablon.en_seguimiento_cliente IS 'El cliente dueño del caso marcó esta aplicación puntual (no el caso completo) para revisarla luego.';
COMMENT ON COLUMN aplicaciones_tablon.en_seguimiento_abogado IS 'El abogado marcó su propia aplicación para encontrarla luego en su pestaña "En seguimiento".';

-- El cliente ya puede modificar cualquier columna de las aplicaciones de
-- sus propios casos vía "cliente_elige_aplicacion_tablon" (migración 040) —
-- ese UPDATE no restringe columnas, así que ya cubre en_seguimiento_cliente
-- sin necesidad de una política nueva.
--
-- El abogado, en cambio, no tenía ningún UPDATE sobre aplicaciones_tablon
-- hasta ahora. Esta política nueva sigue el mismo patrón de columnas
-- "congeladas" que 20260707_033_editar_solicitud.sql: solo
-- en_seguimiento_abogado puede cambiar; todo lo demás (mensaje, estado,
-- caso_id, el propio flag del cliente) debe seguir igual.
CREATE POLICY "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    AND caso_id                IS NOT DISTINCT FROM (SELECT caso_id                FROM aplicaciones_tablon WHERE id = aplicaciones_tablon.id)
    AND mensaje                IS NOT DISTINCT FROM (SELECT mensaje                FROM aplicaciones_tablon WHERE id = aplicaciones_tablon.id)
    AND estado                 IS NOT DISTINCT FROM (SELECT estado                 FROM aplicaciones_tablon WHERE id = aplicaciones_tablon.id)
    AND en_seguimiento_cliente IS NOT DISTINCT FROM (SELECT en_seguimiento_cliente FROM aplicaciones_tablon WHERE id = aplicaciones_tablon.id)
  );

COMMENT ON POLICY "abogado_actualiza_seguimiento_aplicacion" ON aplicaciones_tablon IS
  'El abogado puede alternar únicamente en_seguimiento_abogado en su propia aplicación. Ninguna otra columna puede cambiar por esta política.';


-- ────────────────────────────────────────────────────────────
-- COLUMNAS NUEVAS: solicitudes ("En seguimiento")
-- Sin política nueva: abogado_responde_solicitud y cliente_completa_solicitud
-- (migración 006) ya permiten a cada parte actualizar cualquier columna de
-- sus propias solicitudes (no restringen columnas), así que ya cubren estos
-- dos flags nuevos.
-- ────────────────────────────────────────────────────────────
ALTER TABLE solicitudes
  ADD COLUMN en_seguimiento_cliente  boolean NOT NULL DEFAULT false,
  ADD COLUMN en_seguimiento_abogado  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN solicitudes.en_seguimiento_cliente IS 'El cliente marcó esta solicitud para encontrarla luego en su pestaña "En seguimiento".';
COMMENT ON COLUMN solicitudes.en_seguimiento_abogado IS 'El abogado marcó esta solicitud para encontrarla luego en su pestaña "En seguimiento".';


-- ────────────────────────────────────────────────────────────
-- Cliente puede cerrar su propio caso sin elegir a nadie más
-- (tablon-caso.html, botón "Cerrar caso"). Ninguna columna puede cambiar
-- salvo estado, y solo ACTIVO -> CERRADO.
-- ────────────────────────────────────────────────────────────
CREATE POLICY "cliente_cierra_caso_tablon" ON casos_tablon
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    AND estado = 'CERRADO'
    AND (SELECT estado FROM casos_tablon WHERE id = casos_tablon.id) = 'ACTIVO'
    AND titulo       = (SELECT titulo       FROM casos_tablon WHERE id = casos_tablon.id)
    AND descripcion  = (SELECT descripcion  FROM casos_tablon WHERE id = casos_tablon.id)
    AND especialidad = (SELECT especialidad FROM casos_tablon WHERE id = casos_tablon.id)
    AND caso_comun   IS NOT DISTINCT FROM (SELECT caso_comun FROM casos_tablon WHERE id = casos_tablon.id)
    AND provincia    IS NOT DISTINCT FROM (SELECT provincia  FROM casos_tablon WHERE id = casos_tablon.id)
    AND ciudad       IS NOT DISTINCT FROM (SELECT ciudad     FROM casos_tablon WHERE id = casos_tablon.id)
    AND anonimo      = (SELECT anonimo      FROM casos_tablon WHERE id = casos_tablon.id)
    AND expires_at   = (SELECT expires_at   FROM casos_tablon WHERE id = casos_tablon.id)
  );

COMMENT ON POLICY "cliente_cierra_caso_tablon" ON casos_tablon IS
  'El cliente puede transicionar su propio caso de ACTIVO a CERRADO, y ninguna otra columna ni transición.';


-- ────────────────────────────────────────────────────────────
-- Flujo de contacto DIRECTO al elegir abogado en El Tablón
-- (a diferencia del flujo normal de solicitudes.sql, donde el abogado debe
-- aceptar). El cliente ya comparó varios aplicantes antes de elegir, así
-- que el contacto se revela de inmediato.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_solicitud_desde_tablon()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_caso casos_tablon%ROWTYPE;
  v_solicitud_id uuid;
BEGIN
  IF NEW.estado = 'ELEGIDO' AND OLD.estado IS DISTINCT FROM 'ELEGIDO' THEN
    SELECT * INTO v_caso FROM casos_tablon WHERE id = NEW.caso_id;

    BEGIN
      INSERT INTO solicitudes (cliente_id, abogado_id, descripcion_caso)
      VALUES (v_caso.cliente_id, NEW.abogado_id, v_caso.titulo || ': ' || v_caso.descripcion)
      RETURNING id INTO v_solicitud_id;

      -- Pasa por ACEPTADA vía UPDATE (en vez de insertar directo en ese
      -- estado) para reutilizar fn_revelar_contacto_al_aceptar (migración
      -- 006), que solo corre en UPDATE OF estado, no en INSERT. Esta
      -- función no es SECURITY DEFINER, así que el UPDATE corre con los
      -- permisos de quien la disparó (el propio cliente dueño del caso);
      -- ya cumple la política "cliente_completa_solicitud", que no
      -- restringe a qué estado se puede transicionar.
      UPDATE solicitudes SET estado = 'ACEPTADA' WHERE id = v_solicitud_id;

    EXCEPTION WHEN unique_violation THEN
      -- Ya existe una solicitud activa entre este cliente y este abogado
      -- (p.ej. enviada antes desde la búsqueda normal). El caso se marca
      -- ELEGIDO igual; no se duplica la solicitud.
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- VISTAS
-- ────────────────────────────────────────────────────────────

-- tablon_casos_abogado: se agrega provincia/ciudad (para mostrar y filtrar
-- en tablon.html), al final del SELECT — CREATE OR REPLACE VIEW no permite
-- reordenar ni insertar columnas en medio de una vista existente (42P16).
-- Resto sin cambios respecto a la migración 040.
CREATE OR REPLACE VIEW tablon_casos_abogado AS
SELECT
  c.id,
  c.titulo,
  c.descripcion,
  c.especialidad,
  c.caso_comun,
  c.anonimo,
  c.estado,
  c.created_at,
  c.expires_at,
  CASE
    WHEN c.anonimo AND NOT EXISTS (
      SELECT 1 FROM aplicaciones_tablon ap
      WHERE ap.caso_id = c.id AND ap.abogado_id = auth.uid() AND ap.estado = 'ELEGIDO'
    ) THEN 'Cliente anónimo'
    ELSE p.nombre_completo
  END AS cliente_nombre,
  (SELECT count(*) FROM aplicaciones_tablon ap2 WHERE ap2.caso_id = c.id) AS total_aplicaciones,
  (SELECT ap3.estado FROM aplicaciones_tablon ap3
     WHERE ap3.caso_id = c.id AND ap3.abogado_id = auth.uid()) AS mi_aplicacion_estado,
  c.provincia,
  c.ciudad
FROM casos_tablon c
JOIN perfiles p ON p.id = c.cliente_id
WHERE c.estado = 'ACTIVO'
  AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO');

-- tablon_caso_detalle: vista única para tablon-caso.html, usada tanto por el
-- cliente dueño del caso como por un abogado (verificado, con el caso
-- activo, o que ya aplicó a él aunque haya cerrado/expirado desde entonces
-- — para que pueda seguir viendo el resultado de su propia aplicación).
-- cliente_nombre respeta el anonimato con el mismo criterio que
-- tablon_casos_abogado, salvo para el propio cliente dueño (que siempre ve
-- su nombre real, es su propio caso).
CREATE OR REPLACE VIEW tablon_caso_detalle AS
SELECT
  c.id,
  c.cliente_id,
  c.titulo,
  c.descripcion,
  c.especialidad,
  c.caso_comun,
  c.provincia,
  c.ciudad,
  c.anonimo,
  c.estado,
  c.created_at,
  c.expires_at,
  CASE
    WHEN c.cliente_id = auth.uid() THEN p.nombre_completo
    WHEN c.anonimo AND NOT EXISTS (
      SELECT 1 FROM aplicaciones_tablon ap
      WHERE ap.caso_id = c.id AND ap.abogado_id = auth.uid() AND ap.estado = 'ELEGIDO'
    ) THEN 'Cliente anónimo'
    ELSE p.nombre_completo
  END AS cliente_nombre,
  (SELECT count(*) FROM aplicaciones_tablon ap2 WHERE ap2.caso_id = c.id) AS total_aplicaciones,
  (SELECT ap3.estado FROM aplicaciones_tablon ap3
     WHERE ap3.caso_id = c.id AND ap3.abogado_id = auth.uid()) AS mi_aplicacion_estado
FROM casos_tablon c
JOIN perfiles p ON p.id = c.cliente_id
WHERE
  c.cliente_id = auth.uid()
  OR (c.estado = 'ACTIVO' AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO'))
  OR EXISTS (SELECT 1 FROM aplicaciones_tablon ap4 WHERE ap4.caso_id = c.id AND ap4.abogado_id = auth.uid());

COMMENT ON VIEW tablon_caso_detalle IS 'Detalle de un caso de El Tablón para tablon-caso.html (cliente dueño o abogado). Incluye todos los campos del caso, cliente_nombre (respeta anonimato) y total_aplicaciones. Visible para: el cliente dueño (cualquier estado), abogados verificados si el caso sigue ACTIVO, o cualquier abogado que ya haya aplicado (aunque el caso haya cerrado/expirado desde entonces).';

-- panel_solicitudes_abogado / panel_solicitudes_cliente: se agrega el flag
-- de seguimiento de cada parte (panel-abogado.js / panel-cliente.js, pestaña
-- "En seguimiento").
CREATE OR REPLACE VIEW panel_solicitudes_abogado AS
SELECT
  s.id,
  s.estado,
  s.descripcion_caso,
  s.disponibilidad_horaria,
  s.motivo_rechazo,
  s.expires_at,
  s.aceptada_at,
  s.rechazada_at,
  s.completada_at,
  s.created_at,
  p.nombre_completo AS cliente_nombre,
  p.foto_url        AS cliente_foto,
  s.cliente_telefono,
  s.cliente_email,
  s.en_seguimiento_abogado
FROM solicitudes s
JOIN perfiles p ON p.id = s.cliente_id
WHERE s.abogado_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_abogado IS 'Vista del panel del abogado. cliente_telefono y cliente_email son NULL hasta estado=ACEPTADA. Cada abogado solo ve sus propias solicitudes.';

CREATE OR REPLACE VIEW panel_solicitudes_cliente AS
SELECT
  s.id,
  s.estado,
  s.descripcion_caso,
  s.disponibilidad_horaria,
  s.motivo_rechazo,
  s.expires_at,
  s.aceptada_at,
  s.created_at,
  p.nombre_completo AS abogado_nombre,
  p.foto_url        AS abogado_foto,
  p.ciudad          AS abogado_ciudad,
  a.especialidades  AS abogado_especialidades,
  a.rating_promedio AS abogado_rating,
  EXISTS (
    SELECT 1 FROM resenas r WHERE r.solicitud_id = s.id
  ) AS tiene_resena,
  s.abogado_id,
  s.en_seguimiento_cliente
FROM solicitudes s
JOIN perfiles p ON p.id = s.abogado_id
JOIN abogados a ON a.id = s.abogado_id
WHERE s.cliente_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_cliente IS 'Vista del panel del cliente. Muestra el estado de cada solicitud, datos públicos del abogado y el flag en_seguimiento_cliente.';


-- ────────────────────────────────────────────────────────────
-- GRANTS (CLAUDE.md §12)
-- ────────────────────────────────────────────────────────────

-- casos_tablon no tenía UPDATE otorgado (migración 040: solo SELECT/INSERT,
-- el único cambio de estado post-creación era el cron). Ahora el cliente
-- también puede cerrar su propio caso.
GRANT UPDATE ON TABLE casos_tablon TO authenticated;

-- tablon_caso_detalle: mismo criterio que el resto de vistas de la 040 —
-- ya filtra por auth.uid()/rol en su propio WHERE.
GRANT SELECT ON tablon_caso_detalle TO authenticated;

-- CREATE OR REPLACE VIEW sobre vistas existentes (panel_solicitudes_*,
-- tablon_casos_abogado) no requiere volver a otorgar GRANT — ya lo tienen
-- de las migraciones 011/040 (mismo criterio que la migración 039).
