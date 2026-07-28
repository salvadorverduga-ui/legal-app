-- Vista mi_perfil_publico: mismas columnas que busqueda_abogados, pero
-- filtrada solo por id = auth.uid() (sin las condiciones de visibilidad de
-- verificacion/toggle_disponible/suscripcion/bloqueo/visible_publico). Un
-- abogado siempre debe poder ver la vista previa de su propio perfil público
-- desde perfil-abogado.js, incluso si por cualquier motivo (suscripción
-- vencida, toggle apagado, etc.) ese mismo perfil no aparecería hoy para
-- terceros — ver CLAUDE.md §44 módulo 6.
--
-- No enmascara campos_publicos (a diferencia de busqueda_abogados cuando
-- auth.uid() IS NULL): el dueño del perfil siempre ve sus propios datos
-- completos, igual que api.abogados.getPerfilPropio() sobre la tabla base.

CREATE VIEW mi_perfil_publico AS
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
    WHEN a.red_id IS NOT NULL THEN 'red'
    ELSE 'individual'
  END AS tipo_badge,
  a.provincia_id,
  prov.nombre AS provincia_nombre,
  a.canton_id,
  cant.nombre AS canton_nombre,
  COALESCE(zonas.provincia_ids, '{}'::integer[]) AS zonas_servicio_ids,
  COALESCE(zonas.nombres, '{}'::text[]) AS zonas_servicio_nombres,
  est.nombre AS estudio_nombre
FROM abogados a
JOIN perfiles p ON p.id = a.id
LEFT JOIN provincias prov ON prov.id = a.provincia_id
LEFT JOIN cantones cant ON cant.id = a.canton_id
LEFT JOIN estudios est ON est.id = a.estudio_id
LEFT JOIN LATERAL (
  SELECT array_agg(z.provincia_id) AS provincia_ids, array_agg(zp.nombre) AS nombres
  FROM abogado_zonas_servicio z
  JOIN provincias zp ON zp.id = z.provincia_id
  WHERE z.abogado_id = a.id
) zonas ON true
WHERE a.id = auth.uid();

GRANT SELECT ON mi_perfil_publico TO authenticated;
