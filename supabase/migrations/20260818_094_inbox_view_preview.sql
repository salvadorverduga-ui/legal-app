-- 20260818_094_inbox_view_preview.sql
-- Extiende inbox_view (migración 092) con el último mensaje de cada
-- conversación, necesario para el preview de la Parte 6 (frontend/js/mensajes.js)
-- que la definición original de inbox_view no contemplaba. CREATE OR REPLACE
-- VIEW solo agrega columnas al final -- no toca las existentes (mismo
-- criterio que las demás vistas de este proyecto, ver CLAUDE.md §17/§22).
--
-- last_message_preview reusa exactamente la misma lógica de messages_view
-- (migración 092) para resolver qué body mostrar según quién consulta: el
-- emisor ve su versión editada o el marcador de eliminado, el receptor
-- siempre ve el original -- la vista resuelve esta regla de negocio una
-- sola vez, el frontend no la reimplementa. last_message_sender_id se
-- agrega de paso (mismo LATERAL JOIN, sin costo adicional real) por si a
-- futuro hace falta distinguir "Usted: ..." del mensaje de la contraparte;
-- no se pidió explícitamente para esta ronda pero es información que ya
-- estaba disponible en la misma subconsulta.

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
  mt.source_type,
  lm.sender_id AS last_message_sender_id,
  lm.body      AS last_message_preview
FROM matters mt
JOIN conversations c ON c.matter_id = mt.id
JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = auth.uid()
JOIN perfiles pc ON pc.id = mt.client_id
JOIN perfiles pl ON pl.id = mt.lawyer_id
LEFT JOIN LATERAL (
  SELECT
    m.sender_id,
    CASE
      WHEN m.deleted_at IS NOT NULL AND m.sender_id = auth.uid() THEN 'Este mensaje fue eliminado'
      WHEN m.deleted_at IS NOT NULL THEN m.body
      WHEN m.edited_at  IS NOT NULL AND m.sender_id = auth.uid() THEN m.edited_body
      ELSE m.body
    END AS body
  FROM messages m
  WHERE m.conversation_id = c.id
  ORDER BY m.created_at DESC
  LIMIT 1
) lm ON true;

COMMENT ON VIEW inbox_view IS 'Bandeja del usuario autenticado: un asunto = una fila. title y contraparte_* se resuelven según si el usuario es el client_id o el lawyer_id del asunto. last_message_preview/last_message_sender_id vienen del mensaje más reciente de la conversación, con la misma lógica de edición/eliminación que messages_view (migración 094).';

GRANT SELECT ON inbox_view TO authenticated;
