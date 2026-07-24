-- 20260726_071_verificaciones_admin_intentos_y_datos_registro.sql
-- Dos mejoras en la tarjeta de verificaciones pendientes del panel de
-- administración (CLAUDE.md §43 documenta el ciclo de vida completo de
-- estado_verificacion, incluyendo intentos_verificacion desde la 067/068):
--
-- 1. admin_verificaciones_pendientes no exponía intentos_verificacion
--    (existe en la tabla desde la 067) — el admin no podía saber si una
--    verificación PENDIENTE es la primera solicitud o un reintento tras
--    rechazo.
-- 2. La tarjeta solo mostraba nombre y documentos, sin ningún dato de
--    registro contra el cual cotejar los documentos (cédula, número de
--    carné, RUC, provincia, especialidades) — el admin tenía que abrir
--    cada documento a ciegas.
--
-- Mismo patrón que 065 (agregar columnas al final, CREATE OR REPLACE
-- conserva los GRANTs existentes de la vista).

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
  COALESCE(p_abogado.foto_url, p_estudio.foto_url) AS foto_url,
  v.intentos_verificacion,
  -- Datos de registro para cotejar contra los documentos subidos.
  p_abogado.cedula AS cedula_solicitante,
  ab.numero_registro,
  ab.especialidades,
  COALESCE(prov.nombre, e.provincia) AS provincia,
  e.ruc AS ruc_estudio
FROM verificaciones v
LEFT JOIN perfiles p_abogado ON p_abogado.id = v.abogado_id
LEFT JOIN estudios  e        ON e.id = v.estudio_id
LEFT JOIN perfiles p_estudio ON p_estudio.id = e.representante_legal_id
LEFT JOIN abogados  ab       ON ab.id = v.abogado_id
LEFT JOIN provincias prov    ON prov.id = ab.provincia_id
WHERE v.estado = 'PENDIENTE'
  AND es_admin();

COMMENT ON VIEW admin_verificaciones_pendientes IS 'Cola de verificaciones pendientes para el panel de administración. Filtra por es_admin() porque la vista no hereda el RLS de verificaciones. Incluye intentos_verificacion y los datos de registro (cédula, número de carné, especialidades, provincia, RUC) para que el admin coteje contra los documentos subidos.';
