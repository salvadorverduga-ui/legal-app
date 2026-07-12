-- 20260712_039_abogado_id_solicitudes_cliente.sql
-- Feature: nombre del abogado clickeable en las tarjetas de "Mis solicitudes"
-- del panel del cliente (frontend/js/panel-cliente.js), enlazando a
-- /pages/perfil-abogado?id=[abogado_id].
--
-- panel_solicitudes_cliente (migración 20260625_009) no exponía abogado_id
-- en su SELECT, solo datos derivados (nombre, foto, etc.) — el frontend no
-- tenía cómo armar ese link. Se agrega la columna al final del SELECT
-- (CREATE OR REPLACE VIEW exige que las columnas existentes conserven
-- nombre, orden y tipo; las nuevas van al final).
--
-- panel_abogados_contactados (migración 034) ya expone abogado_id, no
-- requiere cambios.

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
  -- Datos públicos del abogado (nombre, foto, ciudad)
  p.nombre_completo AS abogado_nombre,
  p.foto_url        AS abogado_foto,
  p.ciudad          AS abogado_ciudad,
  a.especialidades  AS abogado_especialidades,
  a.rating_promedio AS abogado_rating,
  -- El cliente nunca ve el teléfono privado del abogado; la consulta es offline
  -- El contacto se da cuando el abogado acepta y el abogado se comunica
  EXISTS (
    SELECT 1 FROM resenas r WHERE r.solicitud_id = s.id
  ) AS tiene_resena,
  s.abogado_id
FROM solicitudes s
JOIN perfiles p ON p.id = s.abogado_id
JOIN abogados a ON a.id = s.abogado_id
WHERE s.cliente_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_cliente IS 'Vista del panel del cliente. Muestra el estado de cada solicitud y datos públicos del abogado, incluyendo abogado_id para enlazar a su perfil público.';

-- GRANT SELECT ya existe sobre esta vista (migración 011); agregar una
-- columna a una vista existente no requiere volver a otorgarlo.
