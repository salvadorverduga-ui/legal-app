-- 20260818_096_notificaciones_chat_v2.sql
-- Notificación de mensaje nuevo para chat v2 (tabla messages, migración 092)
-- -- reemplaza en la práctica a fn_notificar_mensaje_nuevo (migración 085,
-- tabla mensajes del chat anterior), que sigue existiendo pero ya no se
-- dispara para nada nuevo desde que el frontend dejó de escribir en esa
-- tabla (Parte 3). No se toca ni se elimina esa migración vieja.
--
-- A diferencia de fn_notificar_mensaje_nuevo, acá SÍ hay información para
-- decidir si conviene notificar: el destinatario puede haber silenciado la
-- conversación (conversation_participants.muted_until) y el asunto puede
-- haberse cerrado entre que se insertó el mensaje... aunque en la práctica
-- la política RLS "participantes_envian_mensaje" ya exige matter.status =
-- 'active' para que el INSERT llegue a ocurrir -- se revalida igual acá
-- como defensa en profundidad, mismo criterio que el resto de este
-- proyecto (ej. el trigger de URLs valida lo que el cliente ya valida).

CREATE OR REPLACE FUNCTION fn_notificar_mensaje_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matter        matters%ROWTYPE;
  v_destinatario  uuid;
  v_emisor_nombre text;
  v_titulo_asunto text;
  v_muted_until   timestamptz;
BEGIN
  SELECT mt.* INTO v_matter
  FROM matters mt
  JOIN conversations c ON c.matter_id = mt.id
  WHERE c.id = NEW.conversation_id;

  -- Defensa en profundidad: la RLS de INSERT en messages ya exige
  -- status = 'active', esto no debería poder fallar en la práctica.
  IF v_matter.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  v_destinatario := CASE
    WHEN v_matter.client_id = NEW.sender_id THEN v_matter.lawyer_id
    ELSE v_matter.client_id
  END;

  -- El receptor nunca debería ser el propio emisor (client_id <> lawyer_id
  -- por construcción del asunto), pero se guarda como pidió la tarea.
  IF v_destinatario = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  SELECT muted_until INTO v_muted_until
  FROM conversation_participants
  WHERE conversation_id = NEW.conversation_id AND user_id = v_destinatario;

  IF v_muted_until IS NOT NULL AND now() < v_muted_until THEN
    RETURN NEW;
  END IF;

  SELECT nombre_completo INTO v_emisor_nombre FROM perfiles WHERE id = NEW.sender_id;

  -- Título propio del destinatario -- mismo criterio que inbox_view/
  -- matter_detalle_view: title_client si el destinatario es el cliente,
  -- title_lawyer si es el abogado.
  v_titulo_asunto := CASE
    WHEN v_destinatario = v_matter.client_id THEN v_matter.title_client
    ELSE v_matter.title_lawyer
  END;

  PERFORM fn_crear_notificacion(
    v_destinatario,
    'mensaje_nuevo',
    'Nuevo mensaje',
    COALESCE(v_emisor_nombre, 'Un usuario') || ' le envió un mensaje en "' || COALESCE(v_titulo_asunto, 'un asunto') || '".',
    '/pages/conversacion?id=' || NEW.conversation_id
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_notificar_mensaje_v2() IS
  'Notifica al participante que no envió el mensaje (chat v2, tabla messages). No notifica si el destinatario silenció la conversación (muted_until) o si el asunto no está active. url_destino siempre /pages/conversacion?id=<conversation_id>.';

CREATE TRIGGER trg_notificar_mensaje_v2
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_mensaje_v2();
