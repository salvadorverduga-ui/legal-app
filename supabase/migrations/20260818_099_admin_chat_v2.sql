-- 20260818_099_admin_chat_v2.sql
-- Parte 11: acceso admin auditado a chat v2. admin_registrar_apertura_chat
-- (mencionada en CLAUDE.md §46 como la RPC original) ya no existe en la
-- base -- fue reemplazada en su momento por admin_ver_mensajes_chat
-- (migración 088), que registra y lee en una sola operación atómica. Se
-- repite ese mismo patrón acá para la tabla messages, no la RPC vieja
-- (que sigue atada a la tabla mensajes/solicitud_id del chat anterior y no
-- se toca).
--
-- admin_log necesita una tercera columna de referencia (matter_id) porque
-- la unidad auditable de chat v2 es el asunto, no una solicitud -- el CHECK
-- de "exactamente una referencia según accion" (migración 086) se extiende
-- con un tercer caso en vez de reutilizar solicitud_id para no mezclar el
-- significado de esa columna entre chat v1 y v2.

ALTER TABLE admin_log ADD COLUMN matter_id uuid REFERENCES matters(id) ON DELETE SET NULL;

ALTER TABLE admin_log DROP CONSTRAINT admin_log_accion_check;
ALTER TABLE admin_log ADD CONSTRAINT admin_log_accion_check
  CHECK (accion = ANY (ARRAY['APROBAR'::text, 'RECHAZAR'::text, 'VER_CHAT'::text, 'VER_MENSAJES_V2'::text]));

ALTER TABLE admin_log DROP CONSTRAINT admin_log_referencia_unica_check;
ALTER TABLE admin_log ADD CONSTRAINT admin_log_referencia_unica_check
  CHECK (
    (accion = ANY (ARRAY['APROBAR'::text, 'RECHAZAR'::text]) AND verificacion_id IS NOT NULL AND solicitud_id IS NULL AND matter_id IS NULL)
    OR (accion = 'VER_CHAT'::text AND verificacion_id IS NULL AND matter_id IS NULL)
    OR (accion = 'VER_MENSAJES_V2'::text AND verificacion_id IS NULL AND solicitud_id IS NULL AND matter_id IS NOT NULL)
  );

COMMENT ON COLUMN admin_log.matter_id IS 'Referencia para accion=VER_MENSAJES_V2 (chat v2, migración 092) -- distinta de solicitud_id, que sigue siendo exclusiva de VER_CHAT (chat v1, migración 083).';

-- ─── RPC: registra la apertura y devuelve el historial completo en una sola
-- operación atómica, mismo criterio que admin_ver_mensajes_chat (088). Sin
-- el límite de 25 de api.mensajes.getConversacion() y sin resolver
-- body/edited_body/deleted_at como messages_view -- el admin ve las
-- columnas crudas tal cual están en la tabla.
CREATE OR REPLACE FUNCTION admin_ver_mensajes_v2(p_matter_id uuid)
RETURNS TABLE(
  id               uuid,
  conversation_id  uuid,
  sender_id        uuid,
  sender_nombre    text,
  sender_foto      text,
  body             text,
  edited_at        timestamptz,
  edited_body      text,
  deleted_at       timestamptz,
  created_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF NOT es_admin() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;

  SELECT c.id INTO v_conversation_id FROM conversations c WHERE c.matter_id = p_matter_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'El asunto no existe.' USING HINT = 'MATTER_NO_ENCONTRADO';
  END IF;

  INSERT INTO admin_log (admin_id, accion, matter_id)
  VALUES (auth.uid(), 'VER_MENSAJES_V2', p_matter_id);

  RETURN QUERY
  SELECT m.id, m.conversation_id, m.sender_id, p.nombre_completo, p.foto_url,
         m.body, m.edited_at, m.edited_body, m.deleted_at, m.created_at
  FROM messages m
  JOIN perfiles p ON p.id = m.sender_id
  WHERE m.conversation_id = v_conversation_id
  ORDER BY m.created_at ASC;
END;
$$;

COMMENT ON FUNCTION admin_ver_mensajes_v2(uuid) IS
  'Registra la apertura en admin_log (accion=VER_MENSAJES_V2) y devuelve el historial completo de un asunto sin límite ni máscara de edición/eliminación -- solo admin, revalida es_admin() internamente.';

REVOKE EXECUTE ON FUNCTION admin_ver_mensajes_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_ver_mensajes_v2(uuid) TO authenticated;

-- ─── Vista: listado de asuntos para la pestaña "Mensajes" del panel admin ──
CREATE OR REPLACE VIEW admin_matters_chat_v2 AS
SELECT
  mt.id AS matter_id,
  c.id  AS conversation_id,
  mt.client_id,
  pc.nombre_completo AS cliente_nombre,
  mt.lawyer_id,
  pl.nombre_completo AS abogado_nombre,
  mt.title_client,
  mt.title_lawyer,
  mt.status,
  mt.source_type,
  mt.created_at,
  (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS total_mensajes,
  c.last_message_at,
  lm.body AS ultimo_mensaje_preview
FROM matters mt
JOIN conversations c ON c.matter_id = mt.id
JOIN perfiles pc ON pc.id = mt.client_id
JOIN perfiles pl ON pl.id = mt.lawyer_id
LEFT JOIN LATERAL (
  SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
) lm ON true
WHERE es_admin()
ORDER BY c.last_message_at DESC NULLS LAST;

COMMENT ON VIEW admin_matters_chat_v2 IS 'Listado de todos los asuntos de chat v2 para la pestaña "Mensajes" del panel admin -- ultimo_mensaje_preview es el body crudo del último mensaje (sin resolver edición/eliminación, el admin ve la tabla tal cual).';

GRANT SELECT ON admin_matters_chat_v2 TO authenticated;

-- ─── admin_log_detalle (migración 024, extendida en 086): agrega el caso
-- VER_MENSAJES_V2 sin tocar el shape de columnas existente (CREATE OR
-- REPLACE VIEW no admite quitar/reordenar columnas, mismo criterio que el
-- resto de las vistas de este proyecto).
CREATE OR REPLACE VIEW admin_log_detalle AS
SELECT
  al.id,
  al.accion,
  al.created_at,
  p_admin.nombre_completo AS admin_nombre,
  CASE
    WHEN al.verificacion_id IS NOT NULL THEN
      CASE WHEN v.abogado_id IS NOT NULL THEN 'abogado' ELSE 'estudio' END
    WHEN al.matter_id IS NOT NULL THEN 'mensajes'
    ELSE 'chat'
  END AS tipo,
  COALESCE(
    p_abogado.nombre_completo,
    e.nombre,
    s_cliente.nombre_completo || ' / ' || s_abogado.nombre_completo,
    mt_cliente.nombre_completo || ' / ' || mt_abogado.nombre_completo
  ) AS nombre_afectado
FROM admin_log al
JOIN perfiles p_admin ON p_admin.id = al.admin_id
LEFT JOIN verificaciones v ON v.id = al.verificacion_id
LEFT JOIN perfiles p_abogado ON p_abogado.id = v.abogado_id
LEFT JOIN estudios e ON e.id = v.estudio_id
LEFT JOIN solicitudes s ON s.id = al.solicitud_id
LEFT JOIN perfiles s_cliente ON s_cliente.id = s.cliente_id
LEFT JOIN perfiles s_abogado ON s_abogado.id = s.abogado_id
LEFT JOIN matters mt ON mt.id = al.matter_id
LEFT JOIN perfiles mt_cliente ON mt_cliente.id = mt.client_id
LEFT JOIN perfiles mt_abogado ON mt_abogado.id = mt.lawyer_id
WHERE es_admin();

GRANT SELECT ON admin_log_detalle TO authenticated;
