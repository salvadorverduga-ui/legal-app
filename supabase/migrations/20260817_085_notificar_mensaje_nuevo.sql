-- 20260817_085_notificar_mensaje_nuevo.sql
-- Segundo paso (ver 084): trigger que notifica al receptor de un mensaje de
-- chat nuevo (mensajes, migración 083). No hay forma de saber desde acá si
-- el receptor tiene el chat abierto en este momento -- se crea la
-- notificación siempre; el frontend la descarta implícitamente (si el chat
-- está abierto, marcarLeidos() ya deja la notificación sin efecto práctico
-- sobre el badge, y el usuario ya está viendo el mensaje en pantalla).
--
-- url_destino se resuelve según si la solicitud es directa o de El Tablón --
-- mismo criterio que fn_notificar_nueva_solicitud (migración 20260725_062):
-- ambas páginas de solicitudes (frontend/js/solicitudes-directas.js y
-- solicitudes-tablon.js) soportan abrir un chat puntual vía
-- ?solicitud=<id>&chat=true.

CREATE OR REPLACE FUNCTION fn_notificar_mensaje_nuevo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solicitud     solicitudes%ROWTYPE;
  v_destinatario  uuid;
  v_emisor_nombre text;
  v_url           text;
BEGIN
  SELECT * INTO v_solicitud FROM solicitudes WHERE id = NEW.solicitud_id;

  v_destinatario := CASE
    WHEN v_solicitud.cliente_id = NEW.emisor_id THEN v_solicitud.abogado_id
    ELSE v_solicitud.cliente_id
  END;

  SELECT nombre_completo INTO v_emisor_nombre FROM perfiles WHERE id = NEW.emisor_id;

  v_url := CASE
    WHEN v_solicitud.caso_tablon_id IS NULL
      THEN '/pages/solicitudes-directas?solicitud=' || NEW.solicitud_id || '&chat=true'
    ELSE '/pages/solicitudes-tablon?solicitud=' || NEW.solicitud_id || '&chat=true'
  END;

  PERFORM fn_crear_notificacion(
    v_destinatario,
    'mensaje_nuevo',
    'Nuevo mensaje',
    COALESCE(v_emisor_nombre, 'Un usuario') || ' le envió un mensaje.',
    v_url
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_notificar_mensaje_nuevo() IS
  'Notifica al participante que no envió el mensaje. url_destino apunta a solicitudes-directas o solicitudes-tablon según el origen de la solicitud (caso_tablon_id), ambas con ?chat=true para abrir el chat directamente.';

CREATE TRIGGER trg_notificar_mensaje_nuevo
  AFTER INSERT ON mensajes
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_mensaje_nuevo();
