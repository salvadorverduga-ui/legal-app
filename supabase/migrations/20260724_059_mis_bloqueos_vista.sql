-- 20260724_059_mis_bloqueos_vista.sql
-- CLAUDE.md módulo 4 de la ronda de fixes: la pestaña "Usuarios bloqueados"
-- de configuracion-cuenta.html necesita nombre y foto del usuario bloqueado,
-- que api.bloqueos.getMisBloqueos() no podía traer porque solo consultaba
-- la tabla bloqueos directamente (id, bloqueador_id, bloqueado_id,
-- created_at -- sin datos de perfil).
--
-- Mismo patrón que admin_bloqueos (migración 056): join a perfiles, filtrado
-- en el propio WHERE de la vista (no hereda el RLS de bloqueos).

CREATE OR REPLACE VIEW mis_bloqueos AS
SELECT
  b.id,
  b.bloqueado_id,
  p.nombre_completo AS bloqueado_nombre,
  p.foto_url         AS bloqueado_foto,
  p.rol               AS bloqueado_rol,
  b.created_at
FROM bloqueos b
JOIN perfiles p ON p.id = b.bloqueado_id
WHERE b.bloqueador_id = auth.uid();

COMMENT ON VIEW mis_bloqueos IS 'Bloqueos creados por el usuario autenticado (bloqueador_id = auth.uid()), con nombre/foto/rol del bloqueado. Usada por configuracion-cuenta.html.';

GRANT SELECT ON mis_bloqueos TO authenticated;
