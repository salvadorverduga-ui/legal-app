-- 20260818_095_matter_detalle_view.sql
-- Vista de detalle de un asunto, para la página de conversación (Parte 7,
-- frontend/js/conversacion.js). Mismo motivo que inbox_view (migración 092)
-- y su extensión de preview (094): perfiles solo permite leer la fila
-- propia (perfil_propio_select, migración 001) o la de un admin -- un
-- participante no puede leer el nombre/foto de la contraparte con un SELECT
-- directo a perfiles, así que esa resolución tiene que vivir en una vista
-- SECURITY DEFINER, como el resto de las vistas de este proyecto.
--
-- A diferencia de inbox_view (una fila por asunto, pensada para listar
-- muchos), esta vista trae todo lo que la página de un asunto puntual
-- necesita en una sola consulta: el título propio ya resuelto (igual que
-- inbox_view), client_id/lawyer_id crudos (no sensibles entre las dos
-- partes -- ya se conocen mutuamente por estar en el mismo asunto) para que
-- el frontend determine su propio lado sin adivinar, y los campos de
-- reapertura (reopen_requested_by/reopen_reason) que inbox_view no expone.

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
  mt.updated_at
FROM matters mt
JOIN conversations c ON c.matter_id = mt.id
JOIN perfiles pc ON pc.id = mt.client_id
JOIN perfiles pl ON pl.id = mt.lawyer_id
WHERE mt.client_id = auth.uid() OR mt.lawyer_id = auth.uid() OR es_admin();

COMMENT ON VIEW matter_detalle_view IS 'Detalle de un asunto para la página de conversación: title/contraparte_* resueltos según el lado del usuario autenticado (mismo criterio que inbox_view), más client_id/lawyer_id crudos y los campos de reapertura que inbox_view no expone.';

GRANT SELECT ON matter_detalle_view TO authenticated;
