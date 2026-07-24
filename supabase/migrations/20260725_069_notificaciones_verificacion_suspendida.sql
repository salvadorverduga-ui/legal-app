-- 20260725_069_notificaciones_verificacion_suspendida.sql
-- PARTE 6 del rediseño de verificación: notificación de suspensión
-- definitiva, y mensaje de rechazo enriquecido con motivo + intentos
-- restantes (antes solo mostraba "Motivo: ..." sin mencionar el reintento).
--
-- 'verificacion_suspendida' es un valor NUEVO del enum tipo_notificacion
-- (a diferencia de 'SUSPENDIDO' en estado_verificacion, migración 067, que
-- ya existía) — no puede usarse en la misma transacción en que se agrega
-- (restricción de Postgres para ALTER TYPE ... ADD VALUE), así que este
-- archivo se aplica en dos pasos separados.

-- Paso 1 (transacción propia)
ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'verificacion_suspendida';

-- Paso 2 (transacción separada, después de confirmado el paso 1)
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
        'Su verificación fue aprobada. Su perfil ya puede aparecer en las búsquedas.',
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
$$;
