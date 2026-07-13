-- 20260712_042_tablon_seguimiento_vistas.sql
-- Falta detectada al implementar el frontend de "En seguimiento" (módulo D):
-- las columnas en_seguimiento_cliente/en_seguimiento_abogado se agregaron a
-- aplicaciones_tablon en la migración 041, pero las vistas que el frontend
-- usa para listar aplicaciones y casos no las exponían, así que la UI no
-- podía saber si una aplicación ya estaba marcada. Mismo criterio que
-- CLAUDE.md §12 para un GRANT faltante: se corrige en un archivo aparte con
-- timestamp del día, no se reabre la migración 041 ya aplicada.
--
-- Todas las columnas nuevas van al final del SELECT: CREATE OR REPLACE VIEW
-- no permite reordenar ni insertar columnas en medio de una vista existente.

-- El cliente necesita ver en_seguimiento_cliente de cada aplicación
-- recibida para saber si ya la marcó (tablon-caso.html, vista cliente).
CREATE OR REPLACE VIEW tablon_aplicaciones_cliente AS
SELECT
  ap.id,
  ap.caso_id,
  ap.abogado_id,
  ap.mensaje,
  ap.estado,
  ap.created_at,
  p.nombre_completo AS abogado_nombre,
  p.foto_url        AS abogado_foto,
  a.especialidades  AS abogado_especialidades,
  a.rating_promedio AS abogado_rating,
  a.total_resenas   AS abogado_total_resenas,
  ap.en_seguimiento_cliente
FROM aplicaciones_tablon ap
JOIN casos_tablon c ON c.id = ap.caso_id
JOIN perfiles     p ON p.id = ap.abogado_id
JOIN abogados     a ON a.id = ap.abogado_id
WHERE c.cliente_id = auth.uid();

-- El abogado necesita ver en_seguimiento_abogado de su propia aplicación al
-- caso (tablon.html listado, tablon-caso.html vista abogado). mi_seguimiento
-- y mi_aplicacion_id son NULL si el abogado aún no aplicó, igual que
-- mi_aplicacion_estado. mi_aplicacion_id es el id que hay que pasarle a
-- api.seguimiento.toggleTablon() — el seguimiento se guarda por aplicación,
-- no por caso (ver comentario en api.js).
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
  c.ciudad,
  (SELECT ap4.en_seguimiento_abogado FROM aplicaciones_tablon ap4
     WHERE ap4.caso_id = c.id AND ap4.abogado_id = auth.uid()) AS mi_seguimiento,
  (SELECT ap6.id FROM aplicaciones_tablon ap6
     WHERE ap6.caso_id = c.id AND ap6.abogado_id = auth.uid()) AS mi_aplicacion_id
FROM casos_tablon c
JOIN perfiles p ON p.id = c.cliente_id
WHERE c.estado = 'ACTIVO'
  AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO');

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
     WHERE ap3.caso_id = c.id AND ap3.abogado_id = auth.uid()) AS mi_aplicacion_estado,
  (SELECT ap4.en_seguimiento_abogado FROM aplicaciones_tablon ap4
     WHERE ap4.caso_id = c.id AND ap4.abogado_id = auth.uid()) AS mi_seguimiento,
  (SELECT ap5.id FROM aplicaciones_tablon ap5
     WHERE ap5.caso_id = c.id AND ap5.abogado_id = auth.uid()) AS mi_aplicacion_id
FROM casos_tablon c
JOIN perfiles p ON p.id = c.cliente_id
WHERE
  c.cliente_id = auth.uid()
  OR (c.estado = 'ACTIVO' AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO'))
  OR EXISTS (SELECT 1 FROM aplicaciones_tablon ap6 WHERE ap6.caso_id = c.id AND ap6.abogado_id = auth.uid());

COMMENT ON VIEW tablon_caso_detalle IS 'Detalle de un caso de El Tablón para tablon-caso.html (cliente dueño o abogado). mi_seguimiento es en_seguimiento_abogado de la aplicación propia del abogado y mi_aplicacion_id el id que hay que pasarle a api.seguimiento.toggleTablon() (ambos NULL si no aplicó); el cliente consulta el seguimiento por aplicación directamente en tablon_aplicaciones_cliente, no acá.';

-- CREATE OR REPLACE VIEW sobre vistas existentes no requiere volver a
-- otorgar GRANT (mismo criterio que las migraciones 039/041).
