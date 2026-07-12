-- 20260707_035_busqueda_por_nombre.sql
-- Feature: campo "Buscar por nombre" en busqueda.html — filtra por el
-- nombre del abogado (perfiles.nombre_completo, ya expuesto como
-- busqueda_abogados.nombre_completo) y por el nombre del estudio al que
-- pertenece (estudios.nombre), que la vista todavía no exponía.
--
-- CREATE OR REPLACE VIEW: se agrega estudio_nombre como columna nueva al
-- final del SELECT list — no se modifica ni reordena ninguna columna
-- existente, así que los GRANT ya otorgados (authenticated y anon, ver
-- migraciones 011 y 032) se conservan sin necesidad de volver a otorgarlos.

CREATE OR REPLACE VIEW busqueda_abogados AS
SELECT
  a.id,
  p.nombre_completo,
  p.foto_url,
  p.ciudad,
  p.provincia,
  a.especialidades,
  a.casos_frecuentes,
  a.descripcion,
  a.precio_consulta,
  a.rating_promedio,
  a.total_resenas,
  a.toggle_disponible,
  a.red_id,
  a.estudio_id,
  CASE
    WHEN a.estudio_id IS NOT NULL THEN 'estudio'
    WHEN a.red_id IS NOT NULL     THEN 'red'
    ELSE                               'individual'
  END AS tipo_badge,
  a.provincia_id,
  prov.nombre AS provincia_nombre,
  a.canton_id,
  cant.nombre AS canton_nombre,
  COALESCE(zonas.provincia_ids, '{}') AS zonas_servicio_ids,
  COALESCE(zonas.nombres, '{}')       AS zonas_servicio_nombres,
  est.nombre AS estudio_nombre
FROM abogados a
JOIN perfiles p ON p.id = a.id
LEFT JOIN provincias prov ON prov.id = a.provincia_id
LEFT JOIN cantones   cant ON cant.id = a.canton_id
LEFT JOIN estudios   est  ON est.id = a.estudio_id
LEFT JOIN LATERAL (
  SELECT
    array_agg(z.provincia_id) AS provincia_ids,
    array_agg(zp.nombre)      AS nombres
  FROM abogado_zonas_servicio z
  JOIN provincias zp ON zp.id = z.provincia_id
  WHERE z.abogado_id = a.id
) zonas ON true
WHERE
  a.verificacion = 'VERIFICADO'
  AND a.toggle_disponible = true
  AND a.suscripcion_vigente_hasta IS NOT NULL
  AND (
    a.suscripcion_vigente_hasta >= CURRENT_DATE
    OR a.suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
  );

COMMENT ON VIEW busqueda_abogados IS 'Vista segura para búsqueda pública. Excluye teléfono, email, documentos y suscripcion_vigente_hasta. provincia_id/provincia_nombre y canton_id/canton_nombre son la ubicación principal; zonas_servicio_ids/zonas_servicio_nombres son provincias adicionales donde el abogado también atiende. estudio_nombre es NULL para abogados individuales o en red.';
