-- 20260722_057_cliente_id_panel_solicitudes_abogado.sql
-- CLAUDE.md módulo 8: para que el abogado pueda bloquear a un cliente desde
-- la tarjeta de solicitud, el frontend necesita el id del cliente -- solo
-- tenía cliente_nombre/cliente_foto. Se agrega cliente_id al final del
-- SELECT (CREATE OR REPLACE VIEW exige conservar nombre/orden/tipo de las
-- columnas existentes, mismo criterio que la migración 039).

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
  (SELECT ct.anonimo FROM casos_tablon ct WHERE ct.id = s.caso_tablon_id) AS caso_tablon_anonimo,
  s.cliente_id
FROM solicitudes s
JOIN perfiles p ON p.id = s.cliente_id
WHERE s.abogado_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_abogado IS 'Vista del panel del abogado. cliente_telefono y cliente_email son NULL hasta estado=ACEPTADA. cliente_id agregado en la 057 para poder bloquear al cliente desde la tarjeta de solicitud.';
