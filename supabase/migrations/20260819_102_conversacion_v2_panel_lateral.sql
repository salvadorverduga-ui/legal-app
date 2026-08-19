-- 20260819_102_conversacion_v2_panel_lateral.sql
-- Rediseño visual de conversacion.html (chat v2, feature/chat-v2): agrega los
-- datos que el nuevo header y el panel lateral "Sobre este asunto" necesitan,
-- todos resueltos en la misma consulta que ya hace la página (matter_detalle_view)
-- -- mismo criterio que el resto de las vistas del proyecto (CLAUDE.md §17 nota
-- sobre panel_solicitudes_*, y la propia migración 101 de este archivo).

-- ────────────────────────────────────────────────────────────
-- 1. matters.closed_at -- "Fecha de cierre" del panel lateral. matters no
--    tenía ninguna columna que registrara cuándo se cerró un asunto --
--    updated_at no sirve porque cualquier UPDATE (ej. editar el título)
--    también lo pisa. Se completa en fn_cerrar_matter y se limpia al
--    reabrir vía fn_responder_reapertura(aprobar=true).
-- ────────────────────────────────────────────────────────────
ALTER TABLE matters ADD COLUMN closed_at timestamptz;

COMMENT ON COLUMN matters.closed_at IS 'Momento en que el asunto pasó a closed (fn_cerrar_matter). Se limpia al reabrir (fn_responder_reapertura, aprobar=true). NULL si el asunto nunca se cerró.';

-- Se agrega a la lista de columnas congeladas de ambas políticas de UPDATE
-- directo -- sin esto, cliente_edita_matter/abogado_edita_matter permitirían
-- a cualquiera de las dos partes fijar closed_at a mano en el mismo UPDATE
-- que edita su título, igual que ya se protege status/created_at/etc.
DROP POLICY IF EXISTS "cliente_edita_matter" ON matters;
CREATE POLICY "cliente_edita_matter" ON matters
  FOR UPDATE
  USING (client_id = auth.uid())
  WITH CHECK (
    client_id     = auth.uid()
    AND lawyer_id      IS NOT DISTINCT FROM (fn_matter_previo(id)).lawyer_id
    AND source_type    IS NOT DISTINCT FROM (fn_matter_previo(id)).source_type
    AND source_id      IS NOT DISTINCT FROM (fn_matter_previo(id)).source_id
    AND title_lawyer   IS NOT DISTINCT FROM (fn_matter_previo(id)).title_lawyer
    AND status         IS NOT DISTINCT FROM (fn_matter_previo(id)).status
    AND closed_at      IS NOT DISTINCT FROM (fn_matter_previo(id)).closed_at
    AND created_at     IS NOT DISTINCT FROM (fn_matter_previo(id)).created_at
  );

DROP POLICY IF EXISTS "abogado_edita_matter" ON matters;
CREATE POLICY "abogado_edita_matter" ON matters
  FOR UPDATE
  USING (lawyer_id = auth.uid())
  WITH CHECK (
    lawyer_id     = auth.uid()
    AND client_id      IS NOT DISTINCT FROM (fn_matter_previo(id)).client_id
    AND source_type    IS NOT DISTINCT FROM (fn_matter_previo(id)).source_type
    AND source_id      IS NOT DISTINCT FROM (fn_matter_previo(id)).source_id
    AND title_client   IS NOT DISTINCT FROM (fn_matter_previo(id)).title_client
    AND status         IS NOT DISTINCT FROM (fn_matter_previo(id)).status
    AND closed_at      IS NOT DISTINCT FROM (fn_matter_previo(id)).closed_at
    AND created_at     IS NOT DISTINCT FROM (fn_matter_previo(id)).created_at
  );

-- fn_cerrar_matter: registra closed_at al cerrar.
CREATE OR REPLACE FUNCTION fn_cerrar_matter(p_matter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matter matters;
BEGIN
  SELECT * INTO v_matter FROM matters WHERE id = p_matter_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El asunto no existe.' USING HINT = 'MATTER_NO_ENCONTRADO';
  END IF;

  IF auth.uid() <> v_matter.client_id AND auth.uid() <> v_matter.lawyer_id THEN
    RAISE EXCEPTION 'No tiene permiso sobre este asunto.' USING HINT = 'NO_AUTORIZADO';
  END IF;

  UPDATE matters SET status = 'closed', closed_at = now() WHERE id = p_matter_id;
END;
$$;

-- fn_responder_reapertura: limpia closed_at al aprobar la reapertura (el
-- asunto vuelve a estar activo, ya no tiene una fecha de cierre vigente).
CREATE OR REPLACE FUNCTION fn_responder_reapertura(p_matter_id uuid, p_aprobar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matter matters;
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

  IF p_aprobar THEN
    UPDATE matters SET status = 'active', reopen_requested_by = NULL, closed_at = NULL WHERE id = p_matter_id;
  ELSE
    UPDATE matters SET reopen_requested_by = NULL WHERE id = p_matter_id;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. matter_detalle_view -- las columnas nuevas (closed_at, descripcion_caso,
--    contraparte_especialidades, contraparte_verificacion) se agregan
--    DESPUÉS de source_estado, respetando exactamente el orden de columnas
--    ya existente (migración 101) -- CREATE OR REPLACE VIEW no admite
--    insertar una columna en medio del SELECT (42P16), solo agregar al
--    final. contraparte_especialidades/contraparte_verificacion solo tienen
--    valor cuando quien consulta es el cliente (la contraparte es el
--    abogado); para el propio abogado consultando su asunto, la contraparte
--    es el cliente y ambas quedan NULL (un cliente no tiene fila en
--    `abogados`).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW matter_detalle_view AS
SELECT
  mt.id AS matter_id,
  c.id  AS conversation_id,
  mt.client_id,
  mt.lawyer_id,
  CASE WHEN mt.client_id = auth.uid() THEN pl.id             ELSE pc.id             END AS contraparte_id,
  CASE WHEN mt.client_id = auth.uid() THEN pl.nombre_completo ELSE pc.nombre_completo END AS contraparte_nombre,
  CASE WHEN mt.client_id = auth.uid() THEN pl.foto_url        ELSE pc.foto_url        END AS contraparte_foto,
  CASE WHEN mt.client_id = auth.uid() THEN mt.title_client    ELSE mt.title_lawyer    END AS title,
  mt.status,
  mt.source_type,
  mt.source_id,
  mt.reopen_requested_by,
  mt.reopen_reason,
  mt.created_at,
  mt.updated_at,
  s.estado AS source_estado,
  mt.closed_at,
  s.descripcion_caso,
  CASE WHEN mt.client_id = auth.uid() THEN ab.especialidades ELSE NULL END AS contraparte_especialidades,
  CASE WHEN mt.client_id = auth.uid() THEN ab.verificacion   ELSE NULL END AS contraparte_verificacion
FROM matters mt
JOIN conversations c ON c.matter_id = mt.id
JOIN perfiles pc ON pc.id = mt.client_id
JOIN perfiles pl ON pl.id = mt.lawyer_id
JOIN solicitudes s ON s.id = mt.source_id
LEFT JOIN abogados ab ON ab.id = mt.lawyer_id
WHERE mt.client_id = auth.uid() OR mt.lawyer_id = auth.uid() OR es_admin();

COMMENT ON VIEW matter_detalle_view IS 'Detalle de un asunto para la página de conversación: title/contraparte_* resueltos según el lado del usuario autenticado, client_id/lawyer_id crudos, campos de reapertura, source_estado, closed_at, descripcion_caso de la solicitud origen, y especialidades/verificacion del abogado del asunto (contraparte_especialidades/contraparte_verificacion, NULL cuando quien consulta es el abogado -- su contraparte es un cliente, sin fila en abogados).';

GRANT SELECT ON matter_detalle_view TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. conversation_participants: ampliar SELECT a "cualquier participante de
--    la misma conversación" (antes solo la fila propia, "propio_ve_participacion")
--    -- necesario para que el panel lateral y los indicadores de lectura
--    (checkmarks ✓/✓✓/✓✓ azul de las burbujas propias) puedan leer el
--    last_read_at de la CONTRAPARTE, tanto en una consulta normal como vía
--    Realtime (que respeta RLS al igual que cualquier SELECT). Se resuelve
--    con el mismo patrón fn_*_previo/fn_existe_bloqueo/fn_cliente_dueno_caso_tablon
--    ya usado en todo el proyecto (CLAUDE.md §33/§34/§41/§43) para evitar la
--    recursión de RLS: una subconsulta correlacionada contra la misma tabla
--    dentro de su propia política puede disparar "infinite recursion
--    detected in policy" (42P17) de forma no determinística.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_es_participante_conversacion(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conversation_id AND user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION fn_es_participante_conversacion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_es_participante_conversacion(uuid) TO authenticated;

DROP POLICY IF EXISTS "propio_ve_participacion" ON conversation_participants;
CREATE POLICY "participantes_ven_participacion_conversacion" ON conversation_participants
  FOR SELECT
  USING (fn_es_participante_conversacion(conversation_id) OR es_admin());

-- conversation_participants no estaba agregada a la publicación
-- supabase_realtime (solo messages/conversations lo estaban, migración 092)
-- -- sin esto, la suscripción Realtime de api.mensajes.escucharMatter a
-- cambios de esta tabla (arriba, en api.js, para los checkmarks de lectura)
-- nunca dispararía ningún evento, sin importar que RLS ya lo permita.
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;
