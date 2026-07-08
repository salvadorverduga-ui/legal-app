-- 20260707_027_cedula_reverso.sql
-- La cédula de identidad ahora se sube en dos fotos separadas (anverso y
-- reverso) en el registro de abogado individual. doc_cedula_url (migración
-- 008) sigue guardando el anverso; esta migración agrega la columna para
-- el reverso.

ALTER TABLE verificaciones ADD COLUMN doc_cedula_reverso_url text;

COMMENT ON COLUMN verificaciones.doc_cedula_reverso_url IS 'Path en Supabase Storage de la parte posterior de la cédula de identidad (solo abogados individuales). doc_cedula_url guarda la parte frontal.';

-- La tabla ya tiene GRANT SELECT/INSERT/UPDATE a authenticated (migración 011)
-- y RLS por fila (migración 008) — ambos son a nivel de tabla, no de columna,
-- así que no hace falta un GRANT nuevo para esta columna.

-- Actualiza la vista del panel de administración (migración 018) para que
-- el admin también vea el reverso al revisar una verificación pendiente.
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
  v.created_at
FROM verificaciones v
LEFT JOIN perfiles p_abogado ON p_abogado.id = v.abogado_id
LEFT JOIN estudios  e        ON e.id = v.estudio_id
LEFT JOIN perfiles p_estudio ON p_estudio.id = e.representante_legal_id
WHERE v.estado = 'PENDIENTE'
  AND es_admin();

COMMENT ON VIEW admin_verificaciones_pendientes IS 'Cola de verificaciones pendientes para el panel de administración. Filtra por es_admin() porque la vista no hereda el RLS de verificaciones.';
