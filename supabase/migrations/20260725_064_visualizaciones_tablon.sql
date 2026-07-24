-- 20260725_064_visualizaciones_tablon.sql
-- Feature (smoke test): contador de visualizaciones por caso de El Tablón.
-- Se muestra en tablon.html (tarjeta), tablon-caso.html (cabecera del caso)
-- y solicitudes-tablon.html (tarjeta del cliente, vía tablon_casos_cliente —
-- sin cambios en solicitudes-tablon.js, ya consume esa vista completa).

ALTER TABLE casos_tablon ADD COLUMN visualizaciones integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN casos_tablon.visualizaciones IS 'Cuenta cada carga de tablon-caso.html para este caso (sin deduplicar por visitante), incrementada vía registrar_visualizacion_caso_tablon().';

-- RPC en vez de UPDATE directo desde el frontend: ni el cliente dueño ni un
-- abogado tienen hoy ningún permiso de UPDATE sobre casos_tablon salvo
-- cliente_cierra_caso_tablon (migración 041, que solo permite la transición
-- ACTIVO→CERRADO) — incrementar el contador necesita su propio mecanismo,
-- mismo criterio que otras funciones SECURITY DEFINER de utilidad acotada
-- (fn_existe_bloqueo, validar_codigo_referido): hace una sola cosa muy
-- específica y no expone ni modifica nada más de la fila.
CREATE OR REPLACE FUNCTION registrar_visualizacion_caso_tablon(p_caso_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE casos_tablon SET visualizaciones = visualizaciones + 1 WHERE id = p_caso_id;
$$;

GRANT EXECUTE ON FUNCTION registrar_visualizacion_caso_tablon(uuid) TO authenticated;

-- Las tres vistas de El Tablón que alimentan cada superficie ganan
-- visualizaciones al final del SELECT (CREATE OR REPLACE VIEW no admite
-- reordenar ni quitar columnas existentes, mismo criterio que la migración
-- 039/057 para columnas agregadas después).
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
    WHEN c.anonimo AND NOT (EXISTS (
      SELECT 1 FROM aplicaciones_tablon ap
      WHERE ap.caso_id = c.id AND ap.abogado_id = auth.uid() AND ap.estado = 'ELEGIDO'::estado_aplicacion_tablon
    )) THEN 'Cliente anónimo'::text
    ELSE p.nombre_completo
  END AS cliente_nombre,
  (SELECT count(*) FROM aplicaciones_tablon ap2 WHERE ap2.caso_id = c.id) AS total_aplicaciones,
  (SELECT ap3.estado FROM aplicaciones_tablon ap3 WHERE ap3.caso_id = c.id AND ap3.abogado_id = auth.uid()) AS mi_aplicacion_estado,
  c.provincia,
  c.ciudad,
  (SELECT ap4.en_seguimiento_abogado FROM aplicaciones_tablon ap4 WHERE ap4.caso_id = c.id AND ap4.abogado_id = auth.uid()) AS mi_seguimiento,
  (SELECT ap6.id FROM aplicaciones_tablon ap6 WHERE ap6.caso_id = c.id AND ap6.abogado_id = auth.uid()) AS mi_aplicacion_id,
  c.visualizaciones
FROM casos_tablon c
  JOIN perfiles p ON p.id = c.cliente_id
WHERE c.estado = 'ACTIVO'::estado_caso_tablon
  AND (EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO'::estado_verificacion));

CREATE OR REPLACE VIEW tablon_casos_cliente AS
SELECT
  id,
  cliente_id,
  titulo,
  descripcion,
  especialidad,
  caso_comun,
  anonimo,
  estado,
  created_at,
  expires_at,
  (SELECT count(*) FROM aplicaciones_tablon ap WHERE ap.caso_id = c.id) AS total_aplicaciones,
  visualizaciones
FROM casos_tablon c
WHERE cliente_id = auth.uid();

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
    WHEN c.anonimo AND NOT (EXISTS (
      SELECT 1 FROM aplicaciones_tablon ap
      WHERE ap.caso_id = c.id AND ap.abogado_id = auth.uid() AND ap.estado = 'ELEGIDO'::estado_aplicacion_tablon
    )) THEN 'Cliente anónimo'::text
    ELSE p.nombre_completo
  END AS cliente_nombre,
  (SELECT count(*) FROM aplicaciones_tablon ap2 WHERE ap2.caso_id = c.id) AS total_aplicaciones,
  (SELECT ap3.estado FROM aplicaciones_tablon ap3 WHERE ap3.caso_id = c.id AND ap3.abogado_id = auth.uid()) AS mi_aplicacion_estado,
  (SELECT ap4.en_seguimiento_abogado FROM aplicaciones_tablon ap4 WHERE ap4.caso_id = c.id AND ap4.abogado_id = auth.uid()) AS mi_seguimiento,
  (SELECT ap5.id FROM aplicaciones_tablon ap5 WHERE ap5.caso_id = c.id AND ap5.abogado_id = auth.uid()) AS mi_aplicacion_id,
  (SELECT s.cliente_telefono FROM solicitudes s WHERE s.caso_tablon_id = c.id AND s.abogado_id = auth.uid()) AS cliente_telefono,
  (SELECT s.cliente_email FROM solicitudes s WHERE s.caso_tablon_id = c.id AND s.abogado_id = auth.uid()) AS cliente_email,
  c.visualizaciones
FROM casos_tablon c
  JOIN perfiles p ON p.id = c.cliente_id
WHERE c.cliente_id = auth.uid()
  OR c.estado = 'ACTIVO'::estado_caso_tablon AND (EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO'::estado_verificacion))
  OR (EXISTS (SELECT 1 FROM aplicaciones_tablon ap6 WHERE ap6.caso_id = c.id AND ap6.abogado_id = auth.uid()));
