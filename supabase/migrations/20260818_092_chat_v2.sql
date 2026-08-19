-- 20260818_092_chat_v2.sql
-- Rediseño completo del chat interno (reemplaza el sistema de la migración
-- 083 y sus fixes 084-091, que dejan de referenciarse desde el frontend en
-- esta misma rama pero NO se eliminan — conservan su historial de datos).
--
-- Principio rector: asunto (matter) → conversación (conversation) →
-- mensajes (messages). Un asunto es la relación cliente-abogado nacida de
-- una solicitud ya ACEPTADA (directa o de El Tablón); tiene exactamente una
-- conversación; la conversación tiene sus mensajes y sus dos participantes.
--
-- Decisión de diseño (validada explícitamente, no asumida): CLAUDE.md §17
-- permite que un cliente elija a MÁS DE UN abogado en el mismo caso de El
-- Tablón — cada elección crea su propia fila en `solicitudes`
-- (fn_crear_solicitud_desde_tablon), todas con el mismo caso_tablon_id.
-- Si `matters.source_id` fuera caso_tablon_id para origen 'tablon', el
-- UNIQUE(source_type, source_id) permitiría un solo asunto por caso aunque
-- haya 2+ abogados elegidos, rompiendo la relación 1 asunto = 1 par
-- cliente-abogado. Por eso `source_id` es SIEMPRE solicitudes.id, para
-- ambos orígenes — `source_type` queda como metadato informativo de origen
-- (se deriva de solicitudes.caso_tablon_id, no se confía ciegamente en el
-- parámetro del RPC).

-- ────────────────────────────────────────────────────────────
-- TABLA: matters (asuntos)
-- ────────────────────────────────────────────────────────────
CREATE TABLE matters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES auth.users(id),
  lawyer_id             uuid NOT NULL REFERENCES auth.users(id),
  source_type           text NOT NULL CHECK (source_type IN ('directa', 'tablon')),
  source_id             uuid NOT NULL REFERENCES solicitudes(id),
  title_client          text NOT NULL,
  title_lawyer          text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  reopen_requested_by   uuid REFERENCES auth.users(id),
  reopen_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX idx_matters_client ON matters (client_id);
CREATE INDEX idx_matters_lawyer ON matters (lawyer_id);

COMMENT ON TABLE matters IS 'Asunto (relación cliente-abogado) nacido de una solicitud ACEPTADA. source_id siempre referencia solicitudes.id, tanto para origen directa como tablon — ver nota de diseño al inicio del archivo. status solo cambia vía RPC (fn_cerrar_matter / fn_responder_reapertura).';
COMMENT ON COLUMN matters.source_type IS 'Metadato informativo del origen (derivado de solicitudes.caso_tablon_id al crear el asunto), no una clave alternativa de búsqueda.';

ALTER TABLE matters ENABLE ROW LEVEL SECURITY;

-- Helper "fila previa": evita la recursión de RLS documentada en CLAUDE.md
-- §41/§43 (una subconsulta correlacionada contra la misma tabla dentro de su
-- propia política puede disparar "infinite recursion detected in policy",
-- 42P17, de forma no determinística). Mismo patrón que fn_verificacion_previa.
CREATE OR REPLACE FUNCTION fn_matter_previo(p_id uuid)
RETURNS matters
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT * FROM matters WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION fn_matter_previo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_matter_previo(uuid) TO authenticated;

-- ─── RLS: matters ────────────────────────────────────────────────────────
CREATE POLICY "participantes_ven_matter" ON matters
  FOR SELECT
  USING (client_id = auth.uid() OR lawyer_id = auth.uid() OR es_admin());

-- El cliente edita title_client, reopen_requested_by, reopen_reason. Todo lo
-- demás (incluido status, que solo cambia vía RPC) queda congelado.
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
    AND created_at     IS NOT DISTINCT FROM (fn_matter_previo(id)).created_at
  );

-- El abogado edita title_lawyer, reopen_requested_by, reopen_reason.
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
    AND created_at     IS NOT DISTINCT FROM (fn_matter_previo(id)).created_at
  );

-- INSERT: sin política ni GRANT — solo fn_crear_matter (SECURITY DEFINER).
-- DELETE: sin política para ningún rol.

GRANT SELECT, UPDATE ON TABLE matters TO authenticated;

CREATE TRIGGER trg_matters_updated_at
  BEFORE UPDATE ON matters
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- ────────────────────────────────────────────────────────────
-- TABLA: conversations
-- ────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id        uuid NOT NULL UNIQUE REFERENCES matters(id) ON DELETE CASCADE,
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversations IS 'Una conversación por asunto (UNIQUE matter_id) — coherente con el principio asunto → conversación → mensajes. Se crea únicamente dentro de fn_crear_matter.';

-- ────────────────────────────────────────────────────────────
-- TABLA: conversation_participants
-- (creada acá, antes del RLS de conversations, porque la política de
-- conversations la referencia)
-- ────────────────────────────────────────────────────────────
CREATE TABLE conversation_participants (
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id),
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  muted_until      timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conversation_participants_user ON conversation_participants (user_id);

-- ─── RLS: conversations ──────────────────────────────────────────────────
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participantes_ven_conversation" ON conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
    )
    OR es_admin()
  );

-- INSERT/UPDATE/DELETE: sin política ni GRANT — solo vía RPC.

GRANT SELECT ON TABLE conversations TO authenticated;

-- ─── RLS: conversation_participants ──────────────────────────────────────
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fn_participante_previo(p_conversation_id uuid, p_user_id uuid)
RETURNS conversation_participants
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT * FROM conversation_participants
  WHERE conversation_id = p_conversation_id AND user_id = p_user_id;
$$;

REVOKE EXECUTE ON FUNCTION fn_participante_previo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_participante_previo(uuid, uuid) TO authenticated;

CREATE POLICY "propio_ve_participacion" ON conversation_participants
  FOR SELECT
  USING (user_id = auth.uid() OR es_admin());

-- Solo last_read_at y muted_until son editables; conversation_id/user_id
-- (la identidad de la fila) quedan congelados vía fn_participante_previo.
CREATE POLICY "propio_actualiza_participacion" ON conversation_participants
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND conversation_id = (fn_participante_previo(conversation_id, user_id)).conversation_id
  );

-- INSERT/DELETE: sin política ni GRANT — solo vía RPC.

GRANT SELECT, UPDATE ON TABLE conversation_participants TO authenticated;

-- ────────────────────────────────────────────────────────────
-- TABLA: messages
-- ────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES auth.users(id),
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  edited_at        timestamptz,
  edited_body      text,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at DESC);

COMMENT ON TABLE messages IS 'Mensajes permanentes: no hay política de DELETE. edited_body/deleted_at controlan qué ve cada parte (ver messages_view) — la lógica de presentación vive en la vista, no en RLS.';

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fn_message_previo(p_id uuid)
RETURNS messages
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT * FROM messages WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION fn_message_previo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_message_previo(uuid) TO authenticated;

CREATE POLICY "participantes_ven_mensajes" ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "admin_ve_mensajes" ON messages
  FOR SELECT USING (es_admin());

-- INSERT: participante de la conversación, y el matter del que cuelga debe
-- seguir 'active' (conversations/matters no son messages -- sin riesgo de
-- recursión, no hace falta el helper acá).
CREATE POLICY "participantes_envian_mensaje" ON messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id AND cp.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM conversations c
      JOIN matters mt ON mt.id = c.matter_id
      WHERE c.id = messages.conversation_id AND mt.status = 'active'
    )
  );

-- UPDATE: el emisor puede (a) editar edited_body/edited_at dentro de los
-- primeros 5 minutos sin tocar deleted_at, o (b) eliminar (deleted_at) en
-- cualquier momento sin tocar edited_at/edited_body -- dos modos exclusivos
-- vía OR, resto de columnas siempre congelado.
CREATE POLICY "emisor_edita_o_elimina_mensaje" ON messages
  FOR UPDATE
  USING (sender_id = auth.uid())
  WITH CHECK (
    sender_id = auth.uid()
    AND conversation_id IS NOT DISTINCT FROM (fn_message_previo(id)).conversation_id
    AND body            IS NOT DISTINCT FROM (fn_message_previo(id)).body
    AND created_at      IS NOT DISTINCT FROM (fn_message_previo(id)).created_at
    AND (
      (
        deleted_at IS NOT DISTINCT FROM (fn_message_previo(id)).deleted_at
        AND created_at > now() - interval '5 minutes'
      )
      OR
      (
        edited_at    IS NOT DISTINCT FROM (fn_message_previo(id)).edited_at
        AND edited_body IS NOT DISTINCT FROM (fn_message_previo(id)).edited_body
      )
    )
  );

-- DELETE: sin política para ningún rol -- mensajes permanentes.

GRANT SELECT, INSERT, UPDATE ON TABLE messages TO authenticated;

-- ─── Trigger: last_message_at ────────────────────────────────────────────
-- SECURITY DEFINER: conversations no tiene GRANT UPDATE a authenticated
-- (solo vía RPC) -- el trigger necesita bypassear eso para esta única
-- escritura derivada.
CREATE OR REPLACE FUNCTION fn_actualizar_last_message_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_messages_actualiza_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_last_message_at();

-- ─── Realtime ────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- ────────────────────────────────────────────────────────────
-- RPCs (todas SECURITY DEFINER, REVOKE FROM PUBLIC — únicas vías de
-- escritura para matters/conversations/conversation_participants más allá
-- de las columnas RLS ya habilita directamente).
-- ────────────────────────────────────────────────────────────

-- fn_crear_matter: crea matter + conversation + los dos participantes a
-- partir de una solicitud ya ACEPTADA. Idempotente vía ON CONFLICT DO
-- NOTHING + fallback SELECT (mismo criterio que fn_verificar_rate_limit,
-- §16, y actualizar_zonas_servicio_abogado, §12/migración 079, para
-- llamadas concurrentes). source_type se deriva de la propia solicitud
-- (caso_tablon_id NULL/no NULL) y se valida contra el parámetro recibido,
-- en vez de confiar ciegamente en lo que mande el cliente.
CREATE OR REPLACE FUNCTION fn_crear_matter(p_source_type text, p_source_id uuid, p_title text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solicitud       solicitudes;
  v_source_type     text;
  v_matter_id       uuid;
  v_conversation_id uuid;
BEGIN
  SELECT * INTO v_solicitud FROM solicitudes WHERE id = p_source_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe.' USING HINT = 'SOLICITUD_NO_ENCONTRADA';
  END IF;

  IF v_solicitud.cliente_id <> auth.uid() AND v_solicitud.abogado_id <> auth.uid() THEN
    RAISE EXCEPTION 'No tiene permiso para crear un asunto sobre esta solicitud.' USING HINT = 'NO_AUTORIZADO';
  END IF;

  IF v_solicitud.estado <> 'ACEPTADA' THEN
    RAISE EXCEPTION 'Solo se puede crear un asunto para una solicitud ACEPTADA.' USING HINT = 'SOLICITUD_NO_ACEPTADA';
  END IF;

  v_source_type := CASE WHEN v_solicitud.caso_tablon_id IS NULL THEN 'directa' ELSE 'tablon' END;

  IF p_source_type <> v_source_type THEN
    RAISE EXCEPTION 'source_type no coincide con el origen real de la solicitud.' USING HINT = 'SOURCE_TYPE_INVALIDO';
  END IF;

  INSERT INTO matters (client_id, lawyer_id, source_type, source_id, title_client, title_lawyer)
  VALUES (v_solicitud.cliente_id, v_solicitud.abogado_id, v_source_type, p_source_id, p_title, p_title)
  ON CONFLICT (source_type, source_id) DO NOTHING
  RETURNING id INTO v_matter_id;

  IF v_matter_id IS NULL THEN
    SELECT id INTO v_matter_id FROM matters WHERE source_type = v_source_type AND source_id = p_source_id;
    RETURN v_matter_id;
  END IF;

  INSERT INTO conversations (matter_id) VALUES (v_matter_id) RETURNING id INTO v_conversation_id;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conversation_id, v_solicitud.cliente_id), (v_conversation_id, v_solicitud.abogado_id);

  RETURN v_matter_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_crear_matter(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_crear_matter(text, uuid, text) TO authenticated;

-- fn_solicitar_reapertura
CREATE OR REPLACE FUNCTION fn_solicitar_reapertura(p_matter_id uuid, p_reason text)
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

  IF v_matter.client_id <> auth.uid() AND v_matter.lawyer_id <> auth.uid() THEN
    RAISE EXCEPTION 'No tiene permiso sobre este asunto.' USING HINT = 'NO_AUTORIZADO';
  END IF;

  IF v_matter.status <> 'closed' THEN
    RAISE EXCEPTION 'Solo se puede solicitar la reapertura de un asunto cerrado.' USING HINT = 'MATTER_NO_CERRADO';
  END IF;

  UPDATE matters
  SET reopen_requested_by = auth.uid(),
      reopen_reason = p_reason
  WHERE id = p_matter_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_solicitar_reapertura(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_solicitar_reapertura(uuid, text) TO authenticated;

-- fn_responder_reapertura
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
    UPDATE matters SET status = 'active', reopen_requested_by = NULL WHERE id = p_matter_id;
  ELSE
    UPDATE matters SET reopen_requested_by = NULL WHERE id = p_matter_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_responder_reapertura(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_responder_reapertura(uuid, boolean) TO authenticated;

-- fn_cerrar_matter
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

  UPDATE matters SET status = 'closed' WHERE id = p_matter_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_cerrar_matter(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_cerrar_matter(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- VISTAS
-- ────────────────────────────────────────────────────────────

-- inbox_view: bandeja personal del usuario autenticado (no expone un
-- listado admin -- eso, si hace falta, es una vista aparte con su propio
-- criterio de auditoría, mismo patrón que admin_conversaciones_chat del
-- chat anterior). Como toda vista de este proyecto, filtra explícitamente
-- en vez de heredar RLS: el JOIN a conversation_participants con
-- user_id = auth.uid() es lo que acota el resultado a la bandeja propia.
CREATE OR REPLACE VIEW inbox_view AS
SELECT
  mt.id AS matter_id,
  c.id  AS conversation_id,
  CASE WHEN mt.client_id = auth.uid() THEN pl.nombre_completo ELSE pc.nombre_completo END AS contraparte_nombre,
  CASE WHEN mt.client_id = auth.uid() THEN pl.foto_url         ELSE pc.foto_url         END AS contraparte_foto,
  CASE WHEN mt.client_id = auth.uid() THEN mt.title_client     ELSE mt.title_lawyer     END AS title,
  c.last_message_at,
  (
    SELECT count(*) FROM messages m
    WHERE m.conversation_id = c.id
      AND m.created_at > cp.last_read_at
      AND m.sender_id <> auth.uid()
  ) AS unread_count,
  mt.status,
  mt.source_type
FROM matters mt
JOIN conversations c ON c.matter_id = mt.id
JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = auth.uid()
JOIN perfiles pc ON pc.id = mt.client_id
JOIN perfiles pl ON pl.id = mt.lawyer_id;

COMMENT ON VIEW inbox_view IS 'Bandeja del usuario autenticado: un asunto = una fila. title y contraparte_* se resuelven según si el usuario es el client_id o el lawyer_id del asunto.';

GRANT SELECT ON inbox_view TO authenticated;

-- messages_view: encapsula la lógica de edición/eliminación descrita en la
-- tarea -- el emisor que editó/eliminó ve su propia versión (edited_body o
-- el marcador de eliminado); el receptor sigue viendo siempre el body
-- original, sin importar lo que haya hecho el emisor después de enviarlo.
CREATE OR REPLACE VIEW messages_view AS
SELECT
  m.id,
  m.conversation_id,
  m.sender_id,
  p.nombre_completo AS sender_name,
  p.foto_url         AS sender_photo,
  CASE
    WHEN m.deleted_at IS NOT NULL AND m.sender_id = auth.uid() THEN 'Este mensaje fue eliminado'
    WHEN m.deleted_at IS NOT NULL THEN m.body
    WHEN m.edited_at  IS NOT NULL AND m.sender_id = auth.uid() THEN m.edited_body
    ELSE m.body
  END AS body,
  (m.edited_at  IS NOT NULL) AS is_edited,
  (m.deleted_at IS NOT NULL) AS is_deleted,
  m.created_at
FROM messages m
JOIN perfiles p ON p.id = m.sender_id
WHERE
  EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = m.conversation_id AND cp.user_id = auth.uid()
  )
  OR es_admin();

COMMENT ON VIEW messages_view IS 'body ya resuelto según quién consulta: el emisor ve edited_body/el marcador de eliminado tras editar o eliminar su propio mensaje; el receptor (y el admin) siempre ve el body original. is_edited/is_deleted son banderas informativas basadas en las columnas reales.';

GRANT SELECT ON messages_view TO authenticated;
