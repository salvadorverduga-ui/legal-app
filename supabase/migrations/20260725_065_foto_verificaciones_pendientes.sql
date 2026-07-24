-- admin_verificaciones_pendientes no exponía ninguna foto de perfil, así que
-- el panel de administración no podía mostrarla en la tarjeta de verificación
-- (CLAUDE.md §39, módulo pendiente de smoke test). Se agrega foto_url, resuelta
-- igual que nombre_solicitante: la del abogado si es individual, o la del
-- representante legal si es un estudio (los estudios no tienen foto propia,
-- solo logo_url, que no es lo que pide esta tarjeta).
--
-- CREATE OR REPLACE (no DROP) conserva los GRANTs existentes de la vista.
CREATE OR REPLACE VIEW admin_verificaciones_pendientes AS
SELECT
  v.id,
  v.estado,
  v.abogado_id,
  v.estudio_id,
  CASE WHEN v.abogado_id IS NOT NULL THEN 'abogado' ELSE 'estudio' END AS tipo,
  COALESCE(p_abogado.nombre_completo, p_estudio.nombre_completo) AS nombre_solicitante,
  e.nombre AS nombre_estudio,
  v.doc_carnet_url,
  v.doc_cedula_url,
  v.doc_cedula_reverso_url,
  v.doc_ruc_url,
  v.doc_nombramiento_url,
  v.created_at,
  COALESCE(p_abogado.foto_url, p_estudio.foto_url) AS foto_url
FROM verificaciones v
LEFT JOIN perfiles p_abogado ON p_abogado.id = v.abogado_id
LEFT JOIN estudios  e        ON e.id = v.estudio_id
LEFT JOIN perfiles p_estudio ON p_estudio.id = e.representante_legal_id
WHERE v.estado = 'PENDIENTE'
  AND es_admin();

COMMENT ON VIEW admin_verificaciones_pendientes IS 'Cola de verificaciones pendientes para el panel de administración. Filtra por es_admin() porque la vista no hereda el RLS de verificaciones.';
