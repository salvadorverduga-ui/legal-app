-- 20260706_012_resenas_publicas.sql
-- Vista pública de reseñas para el perfil del abogado.
-- Por qué existe: las políticas RLS de `perfiles` no permiten que un cliente
-- lea el perfil de otro cliente, así que un JOIN directo entre resenas y
-- perfiles fallaría en el frontend (la fila del autor de la reseña queda
-- oculta por RLS). Esta vista corre con los permisos de su dueño y expone
-- únicamente el nombre completo del cliente (para mostrar iniciales en el
-- perfil público) — nunca teléfono, email ni cédula.

CREATE OR REPLACE VIEW resenas_publicas AS
SELECT
  r.id,
  r.abogado_id,
  r.calificacion,
  r.comentario,
  r.respuesta_abogado,
  r.respuesta_at,
  r.created_at,
  p.nombre_completo AS cliente_nombre
FROM resenas r
JOIN perfiles p ON p.id = r.cliente_id
WHERE r.oculta = false;

COMMENT ON VIEW resenas_publicas IS 'Reseñas visibles (oculta=false) con el nombre del cliente autor, para mostrar iniciales en el perfil público del abogado. No expone teléfono, email ni cédula.';

-- GRANT en la misma migración (CLAUDE.md §12). Solo authenticated: el perfil
-- público del abogado requiere sesión, igual que busqueda_abogados.
GRANT SELECT ON resenas_publicas TO authenticated;
