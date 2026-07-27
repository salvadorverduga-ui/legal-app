-- Mensaje destacado para la notificación de verificación aprobada.
-- Reemplaza el texto genérico de fn_notificar_estado_verificacion() (migración
-- 20260707_025, rama VERIFICADO) por uno que celebra el evento explícitamente
-- y detalla qué puede hacer el abogado ahora — es el disparador del modal de
-- bienvenida que panel-abogado.js muestra una sola vez (ver CLAUDE.md §44).
-- Las ramas RECHAZADO/SUSPENDIDO no cambian.

CREATE OR REPLACE FUNCTION public.fn_notificar_estado_verificacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_destinatario uuid;
  v_url          text;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('VERIFICADO', 'RECHAZADO', 'SUSPENDIDO') THEN
    IF NEW.abogado_id IS NOT NULL THEN
      v_destinatario := NEW.abogado_id;
      v_url := '/pages/panel-abogado';
    ELSE
      SELECT representante_legal_id INTO v_destinatario FROM estudios WHERE id = NEW.estudio_id;
      v_url := '/pages/panel-estudio';
    END IF;

    IF NEW.estado = 'VERIFICADO' THEN
      PERFORM fn_crear_notificacion(
        v_destinatario, 'verificacion_aprobada',
        'Verificación aprobada',
        '¡Su cuenta fue verificada y aprobada! Ya puede empezar a recibir solicitudes, aparecer en búsquedas y aplicar a casos en El Tablón. ¡Bienvenido a LegalEC!',
        v_url
      );
    ELSIF NEW.estado = 'RECHAZADO' THEN
      PERFORM fn_crear_notificacion(
        v_destinatario, 'verificacion_rechazada',
        'Verificación rechazada',
        'Su verificación fue rechazada. Motivo: ' || COALESCE(NEW.motivo_rechazo, 'no especificado')
          || '. Puede corregir y volver a subir sus documentos. Le quedan ' || GREATEST(3 - NEW.intentos_verificacion, 0) || ' intentos.',
        v_url
      );
    ELSE
      -- SUSPENDIDO: v_url apunta a '/' porque app.js cierra la sesión del
      -- usuario suspendido apenas detecta perfiles.suspendido = true (ver
      -- PARTE 5) — cualquier otra ruta lo rebotaría igual a la landing.
      PERFORM fn_crear_notificacion(
        v_destinatario, 'verificacion_suspendida',
        'Suspensión definitiva',
        'Su cuenta ha recibido una suspensión definitiva. Si cree que esto es un error, contáctenos en [EMAIL_SOPORTE_PENDIENTE].',
        '/'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
