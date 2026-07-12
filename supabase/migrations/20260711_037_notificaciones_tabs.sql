-- 20260711_037_notificaciones_tabs.sql
-- Bug reportado: al hacer clic en una notificación, el destino no llevaba
-- a la pestaña correcta del panel (frontend/js/notificaciones.js redirige a
-- notificaciones.url_destino tal cual, sin pestaña activa). Se agrega
-- ?tab=<seccion> a cada url_destino generado por los triggers de
-- notificaciones (migración 025), y panel-abogado.js / panel-cliente.js
-- (mismo PR) leen ese parámetro al cargar para activar la pestaña.
--
-- suscripcion_inactiva no se toca: el tipo existe en el enum tipo_notificacion
-- pero ningún trigger lo inserta todavía (pendiente técnico, CLAUDE.md §11).
-- panel-estudio no se toca: la página no existe todavía en frontend/pages/.

CREATE OR REPLACE FUNCTION fn_notificar_nueva_solicitud()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_crear_notificacion(
    NEW.abogado_id,
    'nueva_solicitud',
    'Nueva solicitud de consulta',
    'Tiene una nueva solicitud de consulta pendiente de respuesta.',
    '/pages/panel-abogado?tab=solicitudes'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_notificar_estado_solicitud()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.estado = 'ACEPTADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_aceptada',
        'Su solicitud fue aceptada',
        'El abogado aceptó su solicitud de consulta. Ya puede ver sus datos de contacto.',
        '/pages/panel-cliente?tab=solicitudes'
      );
    ELSIF NEW.estado = 'RECHAZADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_rechazada',
        'Su solicitud fue rechazada',
        'El abogado no está disponible para esta consulta en este momento.',
        '/pages/panel-cliente?tab=solicitudes'
      );
    ELSIF NEW.estado = 'EXPIRADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_expirada',
        'Su solicitud expiró',
        'El abogado no respondió a tiempo. Puede buscar otro abogado disponible.',
        '/pages/panel-cliente?tab=solicitudes'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_notificar_estado_verificacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_destinatario uuid;
  v_url          text;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('VERIFICADO', 'RECHAZADO') THEN
    IF NEW.abogado_id IS NOT NULL THEN
      v_destinatario := NEW.abogado_id;
      v_url := '/pages/panel-abogado?tab=perfil';
    ELSE
      SELECT representante_legal_id INTO v_destinatario FROM estudios WHERE id = NEW.estudio_id;
      v_url := '/pages/panel-estudio';
    END IF;

    IF NEW.estado = 'VERIFICADO' THEN
      PERFORM fn_crear_notificacion(
        v_destinatario, 'verificacion_aprobada',
        'Verificación aprobada',
        'Su verificación fue aprobada. Su perfil ya puede aparecer en las búsquedas.',
        v_url
      );
    ELSE
      PERFORM fn_crear_notificacion(
        v_destinatario, 'verificacion_rechazada',
        'Verificación rechazada',
        COALESCE('Motivo: ' || NEW.motivo_rechazo, 'Su verificación fue rechazada. Revise los documentos enviados.'),
        v_url
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
