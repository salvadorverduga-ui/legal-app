-- 20260714_050_contacto_tablon_caso_detalle.sql
-- Módulo 2 (datos de contacto en solicitudes del Tablón): tablon-caso.html
-- necesita mostrar una sección "Datos de contacto" al abogado elegido, pero
-- tablon_caso_detalle nunca expuso teléfono/email del cliente — solo
-- cliente_nombre (con la regla de anonimato de la migración 040/041). Ahora
-- que solicitudes.caso_tablon_id existe (migración 049), se puede resolver
-- el contacto vía la solicitud que fn_crear_solicitud_desde_tablon crea al
-- elegir a ese abogado, exactamente igual a como panel_solicitudes_abogado
-- ya lo hace para el flujo directo.
--
-- panel_solicitudes_abogado también se extiende con caso_tablon_anonimo,
-- para que solicitudes-tablon.js pueda mostrar la nota "Este cliente publicó
-- su caso de forma anónima..." sin una query aparte.
--
-- CREATE OR REPLACE VIEW exige conservar nombre/orden/tipo de las columnas
-- existentes (criterio de las migraciones 039/041/049); las columnas nuevas
-- van al final del SELECT.

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
  s.en_seguimiento_abogado,
  s.caso_tablon_id,
  (SELECT ct.anonimo FROM casos_tablon ct WHERE ct.id = s.caso_tablon_id) AS caso_tablon_anonimo
FROM solicitudes s
JOIN perfiles p ON p.id = s.cliente_id
WHERE s.abogado_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_abogado IS 'Vista del panel del abogado. cliente_telefono y cliente_email son NULL hasta estado=ACEPTADA. caso_tablon_id distingue solicitudes directas (NULL) de las originadas en El Tablón; caso_tablon_anonimo indica si ese caso se publicó de forma anónima (NULL para solicitudes directas). Cada abogado solo ve sus propias solicitudes.';

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
     WHERE ap5.caso_id = c.id AND ap5.abogado_id = auth.uid()) AS mi_aplicacion_id,
  -- Solo tiene valor cuando auth.uid() es el abogado elegido para este caso:
  -- fn_crear_solicitud_desde_tablon crea esa solicitud con caso_tablon_id = c.id
  -- y abogado_id = auth.uid(), y la deja en ACEPTADA (§17), que ya reveló el
  -- contacto vía fn_revelar_contacto_al_aceptar. Para el cliente dueño y para
  -- cualquier otro abogado no existe esa fila, así que ambas columnas son NULL.
  (SELECT s.cliente_telefono FROM solicitudes s
     WHERE s.caso_tablon_id = c.id AND s.abogado_id = auth.uid()) AS cliente_telefono,
  (SELECT s.cliente_email FROM solicitudes s
     WHERE s.caso_tablon_id = c.id AND s.abogado_id = auth.uid()) AS cliente_email
FROM casos_tablon c
JOIN perfiles p ON p.id = c.cliente_id
WHERE
  c.cliente_id = auth.uid()
  OR (c.estado = 'ACTIVO' AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO'))
  OR EXISTS (SELECT 1 FROM aplicaciones_tablon ap6 WHERE ap6.caso_id = c.id AND ap6.abogado_id = auth.uid());

COMMENT ON VIEW tablon_caso_detalle IS 'Detalle de un caso de El Tablón para tablon-caso.html (cliente dueño o abogado). mi_seguimiento es en_seguimiento_abogado de la aplicación propia del abogado y mi_aplicacion_id el id que hay que pasarle a api.seguimiento.toggleTablon() (ambos NULL si no aplicó); el cliente consulta el seguimiento por aplicación directamente en tablon_aplicaciones_cliente, no acá. cliente_telefono/cliente_email solo tienen valor para el abogado elegido (vía la solicitud creada por fn_crear_solicitud_desde_tablon), NULL para cualquier otro caso.';

-- GRANT SELECT ya existe sobre ambas vistas (migraciones 011/041); agregar
-- columnas a una vista existente no requiere volver a otorgarlo.
