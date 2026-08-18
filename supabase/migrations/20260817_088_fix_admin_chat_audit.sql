-- 20260817_088_fix_admin_chat_audit.sql
-- Fix HIGH 1 de la auditoría de Codex sobre el chat interno: el acceso admin
-- a conversaciones no era obligatoriamente auditado. mensajes_con_perfil
-- (migración 083) tenía "OR es_admin()" en su WHERE, así que cualquier admin
-- podía consultarla directo por PostgREST (GET /rest/v1/mensajes_con_perfil)
-- sin pasar nunca por admin_registrar_apertura_chat() (migración 086) — el
-- registro de auditoría dependía por completo de que el frontend decidiera
-- llamarlo, no de ninguna restricción real de acceso.
--
-- Fix: se quita el bypass de admin en la vista (vuelve a ser exclusiva de
-- participantes) y se reemplaza el flujo de dos pasos (registrar + traer)
-- por una única función SECURITY DEFINER que hace ambas cosas en la misma
-- transacción — la única forma de que un admin lea mensajes de una
-- conversación ajena es a través de esta función, así que el registro en
-- admin_log queda garantizado, no es opcional.

-- ─── mensajes_con_perfil: ya no bypassea para admin ──────────────────────────
CREATE OR REPLACE VIEW mensajes_con_perfil AS
SELECT
  m.id,
  m.solicitud_id,
  m.emisor_id,
  p.nombre_completo AS emisor_nombre,
  p.foto_url         AS emisor_foto,
  m.contenido,
  m.leido_por_receptor,
  m.created_at
FROM mensajes m
JOIN perfiles p ON p.id = m.emisor_id
WHERE fn_es_participante_solicitud(m.solicitud_id);

COMMENT ON VIEW mensajes_con_perfil IS 'Mensajes con nombre/foto del emisor, para el componente de chat (frontend/js/chat.js). Exclusiva de participantes -- el admin NO tiene bypass acá (fix 088): debe pasar por admin_ver_mensajes_chat(), que registra el acceso en admin_log antes de devolver los mensajes.';

-- ─── RPC: la única vía de acceso admin a una conversación ────────────────────
-- SECURITY DEFINER: bypassea el RLS de mensajes/perfiles a propósito, pero
-- solo después de validar es_admin() y de haber insertado en admin_log en la
-- misma transacción de función -- si el INSERT fallara (no debería, admin_log
-- no tiene más restricciones que el propio es_admin() ya validado), el
-- RETURN QUERY tampoco se ejecuta: no hay forma de leer sin que quede
-- registrado.
CREATE OR REPLACE FUNCTION admin_ver_mensajes_chat(p_solicitud_id uuid)
RETURNS TABLE (
  id                  uuid,
  solicitud_id        uuid,
  emisor_id           uuid,
  emisor_nombre       text,
  emisor_foto         text,
  contenido           text,
  leido_por_receptor  boolean,
  created_at          timestamptz
)
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

  RETURN QUERY
  SELECT m.id, m.solicitud_id, m.emisor_id, p.nombre_completo, p.foto_url, m.contenido, m.leido_por_receptor, m.created_at
  FROM mensajes m
  JOIN perfiles p ON p.id = m.emisor_id
  WHERE m.solicitud_id = p_solicitud_id
  ORDER BY m.created_at ASC;
END;
$$;

COMMENT ON FUNCTION admin_ver_mensajes_chat(uuid) IS
  'Única vía de lectura admin del historial completo de una conversación: registra en admin_log (accion=VER_CHAT) y devuelve los mensajes en la misma llamada. Reemplaza al flujo de dos pasos admin_registrar_apertura_chat() + SELECT directo a mensajes_con_perfil (migración 086), que dejaba la auditoría como opcional.';

REVOKE EXECUTE ON FUNCTION admin_ver_mensajes_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_ver_mensajes_chat(uuid) TO authenticated;

-- El RPC anterior queda obsoleto e inseguro por diseño (dos pasos, no
-- atómico) -- se elimina para no dejar un camino muerto que alguien pueda
-- volver a llamar por error.
DROP FUNCTION IF EXISTS admin_registrar_apertura_chat(uuid);

-- ─── admin_conversaciones_chat: preview truncado en vez de contenido completo ─
-- El listado de conversaciones seguía exponiendo el mensaje completo sin
-- pasar por ningún registro de auditoría -- se reemplaza por un preview de
-- 20 caracteres (suficiente para que el admin identifique de qué se trata la
-- conversación sin poder leerla completa desde el listado). La vista sigue
-- gateada por es_admin() en el WHERE, mismo patrón que el resto de vistas
-- admin_* de este proyecto (admin_suscripciones, admin_bloqueos, etc.) --
-- a diferencia del historial completo, este preview mínimo no amerita pasar
-- por el RPC auditado.
-- CREATE OR REPLACE VIEW no permite renombrar una columna existente
-- (ultimo_mensaje_contenido -> ultimo_mensaje_preview no es un simple
-- agregado al final, cambia identidad de columna) -- a diferencia del resto
-- de vistas de este proyecto, acá hace falta DROP + CREATE. Sin otras vistas
-- dependientes de admin_conversaciones_chat, así que es seguro.
DROP VIEW IF EXISTS admin_conversaciones_chat;
CREATE VIEW admin_conversaciones_chat AS
SELECT
  s.id AS solicitud_id,
  s.cliente_id,
  p_cliente.nombre_completo AS cliente_nombre,
  s.abogado_id,
  p_abogado.nombre_completo AS abogado_nombre,
  COUNT(m.id) AS total_mensajes,
  MAX(m.created_at) AS ultimo_mensaje_at,
  LEFT((ARRAY_AGG(m.contenido ORDER BY m.created_at DESC))[1], 20)
    || (CASE WHEN char_length((ARRAY_AGG(m.contenido ORDER BY m.created_at DESC))[1]) > 20 THEN '...' ELSE '' END)
    AS ultimo_mensaje_preview
FROM mensajes m
JOIN solicitudes s      ON s.id = m.solicitud_id
JOIN perfiles p_cliente ON p_cliente.id = s.cliente_id
JOIN perfiles p_abogado ON p_abogado.id = s.abogado_id
WHERE es_admin()
GROUP BY s.id, s.cliente_id, p_cliente.nombre_completo, s.abogado_id, p_abogado.nombre_completo
ORDER BY MAX(m.created_at) DESC;

COMMENT ON VIEW admin_conversaciones_chat IS 'Solicitudes con al menos un mensaje de chat, para la pestaña "Mensajes" del panel de administración. ultimo_mensaje_preview trunca a 20 caracteres (fix 088, antes exponía el mensaje completo sin auditoría) -- el historial completo solo se obtiene vía admin_ver_mensajes_chat(), que sí queda registrado.';

GRANT SELECT ON admin_conversaciones_chat TO authenticated;
