-- 20260706_017_vista_resenas_cliente.sql
-- Vista del panel del cliente: reseñas que el cliente ha dejado.
-- Por qué existe: las políticas RLS de `perfiles` no permiten que un cliente
-- lea el perfil de un abogado que ya no es visible (verificación retirada,
-- suscripción vencida más allá del período de gracia, etc.). Un JOIN directo
-- entre resenas y perfiles fallaría en ese caso. Esta vista corre con los
-- permisos de su dueño y filtra por cliente_id = auth.uid(), igual que
-- panel_solicitudes_cliente (migration 009).

CREATE OR REPLACE VIEW panel_resenas_cliente AS
SELECT
  r.id,
  r.abogado_id,
  r.calificacion,
  r.comentario,
  r.respuesta_abogado,
  r.respuesta_at,
  r.created_at,
  p.nombre_completo AS abogado_nombre,
  p.foto_url        AS abogado_foto
FROM resenas r
JOIN perfiles p ON p.id = r.abogado_id
WHERE r.cliente_id = auth.uid();

COMMENT ON VIEW panel_resenas_cliente IS 'Reseñas dejadas por el cliente autenticado, con datos públicos del abogado reseñado. auth.uid() en el WHERE restringe cada cliente a sus propias reseñas.';

-- GRANT en la misma migración (CLAUDE.md §12).
GRANT SELECT ON panel_resenas_cliente TO authenticated;
