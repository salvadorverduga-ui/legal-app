-- 20260818_101_matter_detalle_estado_solicitud.sql
-- "Cerrar asunto" solo debe ofrecerse cuando la solicitud origen (source_id,
-- siempre solicitudes.id -- ver nota de diseño en la migración 092) está
-- COMPLETADA o RESEÑADA. En vez de que conversacion.js haga una consulta
-- aparte a `solicitudes` (RLS de esa tabla ya lo permitiría a cualquiera de
-- las dos partes, pero sería una segunda query por cada carga de la página),
-- matter_detalle_view se extiende con source_estado -- mismo criterio que el
-- resto de las vistas de este proyecto, que resuelven todo lo que su página
-- necesita en una sola consulta (CLAUDE.md §17 nota sobre panel_solicitudes_*).
--
-- Se agrega al final del SELECT para no romper el orden/tipo de columnas
-- existentes (mismo criterio que la migración 039 y las extensiones de
-- panel_solicitudes_abogado en CLAUDE.md §22/§33).

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
  s.estado AS source_estado
FROM matters mt
JOIN conversations c ON c.matter_id = mt.id
JOIN perfiles pc ON pc.id = mt.client_id
JOIN perfiles pl ON pl.id = mt.lawyer_id
JOIN solicitudes s ON s.id = mt.source_id
WHERE mt.client_id = auth.uid() OR mt.lawyer_id = auth.uid() OR es_admin();

COMMENT ON VIEW matter_detalle_view IS 'Detalle de un asunto para la página de conversación: title/contraparte_* resueltos según el lado del usuario autenticado (mismo criterio que inbox_view), client_id/lawyer_id crudos, los campos de reapertura que inbox_view no expone, y source_estado (solicitudes.estado de la solicitud origen) para condicionar la opción "Cerrar asunto" a COMPLETADA/RESEÑADA sin una consulta aparte.';

GRANT SELECT ON matter_detalle_view TO authenticated;
