-- 20260818_100_fix_messages_view.sql
-- Fix: messages_view solo mostraba edited_body al propio emisor tras editar
-- un mensaje -- la contraparte seguía viendo el body original sin enterarse
-- de la edición. A diferencia de la eliminación (donde el receptor SÍ debe
-- seguir viendo el body original, por diseño -- CLAUDE.md §46), una edición
-- debe reflejarse para ambas partes: se quita la condición
-- "AND m.sender_id = auth.uid()" de la rama de edited_at, dejando intacta la
-- de deleted_at.

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
    WHEN m.edited_at  IS NOT NULL THEN m.edited_body
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

COMMENT ON VIEW messages_view IS 'body ya resuelto según quién consulta: un mensaje editado muestra edited_body a ambas partes; uno eliminado sigue mostrando el body original al receptor y solo el emisor ve el marcador de eliminado. is_edited/is_deleted son banderas informativas basadas en las columnas reales.';

GRANT SELECT ON messages_view TO authenticated;
