-- 20260818_098_notificaciones_reapertura.sql
-- Segundo paso (ver 097): fn_responder_reapertura gana la notificación al
-- solicitante original -- v_matter.reopen_requested_by ya se leyó al
-- validar "quien solicitó no puede responder su propia solicitud" (migración
-- 092), así que no hace falta una consulta extra para saber a quién avisar.
-- url_destino apunta a la conversación del propio asunto en ambos casos.

CREATE OR REPLACE FUNCTION fn_responder_reapertura(p_matter_id uuid, p_aprobar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matter          matters;
  v_conversation_id uuid;
BEGIN
  SELECT * INTO v_matter FROM matters WHERE id = p_matter_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El asunto no existe.' USING HINT = 'MATTER_NO_ENCONTRADO';
  END IF;

  IF v_matter.reopen_requested_by IS NULL THEN
    RAISE EXCEPTION 'No hay ninguna solicitud de reapertura pendiente.' USING HINT = 'SIN_SOLICITUD_REAPERTURA';
  END IF;

  IF auth.uid() <> v_matter.client_id AND auth.uid() <> v_matter.lawyer_id THEN
    RAISE EXCEPTION 'No tiene permiso sobre este asunto.' USING HINT = 'NO_AUTORIZADO';
  END IF;

  IF auth.uid() = v_matter.reopen_requested_by THEN
    RAISE EXCEPTION 'Quien solicitó la reapertura no puede responderla.' USING HINT = 'NO_PUEDE_RESPONDER_PROPIA_SOLICITUD';
  END IF;

  SELECT id INTO v_conversation_id FROM conversations WHERE matter_id = p_matter_id;

  IF p_aprobar THEN
    UPDATE matters SET status = 'active', reopen_requested_by = NULL WHERE id = p_matter_id;

    PERFORM fn_crear_notificacion(
      v_matter.reopen_requested_by,
      'reapertura_aprobada',
      'Reapertura aprobada',
      'Su solicitud de reapertura fue aprobada. Ya puede enviar mensajes.',
      '/pages/conversacion?id=' || v_conversation_id
    );
  ELSE
    UPDATE matters SET reopen_requested_by = NULL WHERE id = p_matter_id;

    PERFORM fn_crear_notificacion(
      v_matter.reopen_requested_by,
      'reapertura_rechazada',
      'Reapertura rechazada',
      'Su solicitud de reapertura fue rechazada.',
      '/pages/conversacion?id=' || v_conversation_id
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_responder_reapertura(uuid, boolean) IS
  'Aprueba o rechaza una reapertura pendiente -- solo la parte que no la solicitó puede responder. Notifica a quien la solicitó (reopen_requested_by) con el resultado. REVOKE FROM PUBLIC / GRANT a authenticated ya aplicados en la migración 092, CREATE OR REPLACE no los toca.';
