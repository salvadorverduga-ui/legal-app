-- 20260707_034_abogados_contactados.sql
-- Feature: pestaña "Mis abogados" en panel-cliente.html — historial de
-- abogados con quienes el cliente tuvo una solicitud ACEPTADA, COMPLETADA o
-- RESEÑADA (es decir, cualquier solicitud que llegó a un match real, más
-- allá de PENDIENTE/RECHAZADA/EXPIRADA/CANCELADA).
--
-- Nota: el pedido original menciona solo "ACEPTADA o COMPLETADA", pero se
-- incluye también RESEÑADA porque es el estado siguiente a COMPLETADA
-- (transición COMPLETADA -> RESEÑADA en api.resenas.crearResena) — excluirla
-- haría que un abogado desaparezca de "Mis abogados" justo cuando el
-- cliente termina de dejarle una reseña, lo cual no tiene sentido de producto.
--
-- Una fila por abogado (agrupado), no por solicitud: un mismo cliente puede
-- tener varias solicitudes históricas con el mismo abogado. tiene_solicitud_activa
-- distingue "relación en curso" (alguna solicitud ACEPTADA) de "historial
-- cerrado" (solo COMPLETADA/RESEÑADA), para que el frontend pueda ordenar
-- primero las activas. Sin ORDER BY embebido en la vista — el orden final lo
-- aplica el frontend con .order(), igual que panel_solicitudes_cliente.

CREATE OR REPLACE VIEW panel_abogados_contactados AS
SELECT
  s.abogado_id,
  p.nombre_completo              AS abogado_nombre,
  p.foto_url                     AS abogado_foto,
  a.especialidades               AS abogado_especialidades,
  prov.nombre                    AS abogado_provincia,
  MAX(s.created_at)              AS ultima_interaccion,
  BOOL_OR(s.estado = 'ACEPTADA') AS tiene_solicitud_activa
FROM solicitudes s
JOIN perfiles   p    ON p.id = s.abogado_id
JOIN abogados   a    ON a.id = s.abogado_id
LEFT JOIN provincias prov ON prov.id = a.provincia_id
WHERE s.cliente_id = auth.uid()
  AND s.estado IN ('ACEPTADA', 'COMPLETADA', 'RESEÑADA')
GROUP BY s.abogado_id, p.nombre_completo, p.foto_url, a.especialidades, prov.nombre;

COMMENT ON VIEW panel_abogados_contactados IS 'Una fila por abogado con el que el cliente autenticado tuvo una solicitud ACEPTADA/COMPLETADA/RESEÑADA. tiene_solicitud_activa=true si alguna de esas solicitudes sigue ACEPTADA. Filtra por auth.uid() en su propio WHERE, igual que panel_solicitudes_cliente.';

-- GRANT en la misma migración (CLAUDE.md §12).
GRANT SELECT ON panel_abogados_contactados TO authenticated;
