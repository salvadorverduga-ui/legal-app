-- 20260817_086_admin_chat.sql
-- Parte 6 del chat interno (migración 083): acceso admin a conversaciones,
-- restringido y auditado. admin_log (migración 024) nacía acoplado
-- exclusivamente a verificaciones (accion CHECK IN ('APROBAR','RECHAZAR'),
-- verificacion_id NOT NULL) -- se generaliza para poder registrar también
-- "un admin abrió una conversación privada de chat".

ALTER TABLE admin_log ALTER COLUMN verificacion_id DROP NOT NULL;

ALTER TABLE admin_log ADD COLUMN solicitud_id uuid REFERENCES solicitudes(id) ON DELETE CASCADE;

ALTER TABLE admin_log DROP CONSTRAINT admin_log_accion_check;
ALTER TABLE admin_log ADD CONSTRAINT admin_log_accion_check
  CHECK (accion IN ('APROBAR', 'RECHAZAR', 'VER_CHAT'));

-- Exactamente una referencia según el tipo de acción -- evita una fila
-- ambigua (ninguna referencia, o las dos a la vez) que admin_log_detalle no
-- sabría a qué caso atribuir.
ALTER TABLE admin_log ADD CONSTRAINT admin_log_referencia_unica_check
  CHECK (
    (accion IN ('APROBAR', 'RECHAZAR') AND verificacion_id IS NOT NULL AND solicitud_id IS NULL)
    OR (accion = 'VER_CHAT' AND solicitud_id IS NOT NULL AND verificacion_id IS NULL)
  );

COMMENT ON COLUMN admin_log.solicitud_id IS 'Solo se completa cuando accion = VER_CHAT (RPC admin_registrar_apertura_chat) -- registra qué conversación de chat abrió el admin.';

-- ─── RPC: registrar apertura de un chat por el admin ─────────────────────────
-- SECURITY DEFINER porque admin_log no tiene (ni debe tener) GRANT INSERT a
-- authenticated -- mismo criterio que admin_suspender_verificacion (migración
-- 070): la única vía de escritura es una función auditada que revalida
-- es_admin() internamente, nunca un INSERT directo desde el frontend.
CREATE OR REPLACE FUNCTION admin_registrar_apertura_chat(p_solicitud_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT es_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO admin_log (admin_id, accion, solicitud_id)
  VALUES (auth.uid(), 'VER_CHAT', p_solicitud_id);
END;
$$;

COMMENT ON FUNCTION admin_registrar_apertura_chat(uuid) IS
  'Registra en admin_log que el admin autenticado abrió el chat de una solicitud. Llamada desde panel-admin.js (api.admin.registrarAperturaChat) cada vez que se abre una conversación, antes de traer el historial completo de mensajes.';

REVOKE EXECUTE ON FUNCTION admin_registrar_apertura_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_registrar_apertura_chat(uuid) TO authenticated;

-- ─── Vista: listado de conversaciones para la pestaña "Mensajes" ─────────────
-- SECURITY DEFINER (como toda vista de este proyecto): bypassea el RLS de
-- mensajes/solicitudes/perfiles, así que filtra explícitamente con es_admin()
-- en el WHERE. cliente_id/abogado_id se exponen (además de los nombres) para
-- que el frontend pueda diferenciar el lado de cada burbuja al renderizar el
-- historial completo, sin otra consulta.
CREATE OR REPLACE VIEW admin_conversaciones_chat AS
SELECT
  s.id AS solicitud_id,
  s.cliente_id,
  p_cliente.nombre_completo AS cliente_nombre,
  s.abogado_id,
  p_abogado.nombre_completo AS abogado_nombre,
  COUNT(m.id) AS total_mensajes,
  MAX(m.created_at) AS ultimo_mensaje_at,
  (ARRAY_AGG(m.contenido ORDER BY m.created_at DESC))[1] AS ultimo_mensaje_contenido
FROM mensajes m
JOIN solicitudes s      ON s.id = m.solicitud_id
JOIN perfiles p_cliente ON p_cliente.id = s.cliente_id
JOIN perfiles p_abogado ON p_abogado.id = s.abogado_id
WHERE es_admin()
GROUP BY s.id, s.cliente_id, p_cliente.nombre_completo, s.abogado_id, p_abogado.nombre_completo
ORDER BY MAX(m.created_at) DESC;

COMMENT ON VIEW admin_conversaciones_chat IS 'Solicitudes con al menos un mensaje de chat, para la pestaña "Mensajes" del panel de administración. Filtra por es_admin() porque la vista es SECURITY DEFINER y no hereda el RLS de mensajes. El historial completo de cada conversación se trae aparte desde mensajes_con_perfil (ya admite es_admin() desde la migración 083).';

GRANT SELECT ON admin_conversaciones_chat TO authenticated;

-- ─── admin_log_detalle: extender para mostrar también aperturas de chat ──────
-- CREATE OR REPLACE VIEW no admite reordenar/quitar columnas existentes
-- (CLAUDE.md §12) -- se conservan las mismas 5 columnas, solo se generaliza
-- el cálculo de "tipo"/"nombre_afectado" para cubrir accion = VER_CHAT.
CREATE OR REPLACE VIEW admin_log_detalle AS
SELECT
  al.id,
  al.accion,
  al.created_at,
  p_admin.nombre_completo AS admin_nombre,
  CASE
    WHEN al.verificacion_id IS NOT NULL THEN (CASE WHEN v.abogado_id IS NOT NULL THEN 'abogado' ELSE 'estudio' END)
    ELSE 'chat'
  END AS tipo,
  COALESCE(
    p_abogado.nombre_completo,
    e.nombre,
    s_cliente.nombre_completo || ' / ' || s_abogado.nombre_completo
  ) AS nombre_afectado
FROM admin_log al
JOIN perfiles p_admin         ON p_admin.id = al.admin_id
LEFT JOIN verificaciones v    ON v.id = al.verificacion_id
LEFT JOIN perfiles p_abogado  ON p_abogado.id = v.abogado_id
LEFT JOIN estudios  e         ON e.id = v.estudio_id
LEFT JOIN solicitudes s       ON s.id = al.solicitud_id
LEFT JOIN perfiles s_cliente  ON s_cliente.id = s.cliente_id
LEFT JOIN perfiles s_abogado  ON s_abogado.id = s.abogado_id
WHERE es_admin();

COMMENT ON VIEW admin_log_detalle IS 'Log de acciones del admin para el panel de administración. Filtra por es_admin() porque la vista no hereda el RLS de admin_log. Cubre aprobaciones/rechazos de verificaciones y, desde la migración 086, aperturas de chat (accion=VER_CHAT).';
