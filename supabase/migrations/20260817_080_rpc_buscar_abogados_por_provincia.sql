-- 20260817_080_rpc_buscar_abogados_por_provincia.sql
-- Fix (auditoría de seguridad Codex, MEDIUM 1): api.abogados.buscar() omitía
-- el .limit(100) cuando había filtro de provincia_id, porque el orden
-- "provincia principal primero" se calculaba en el cliente después de traer
-- los resultados (una vista no recibe parámetros, así que su propio ORDER BY
-- no puede saber qué provincia se está buscando) — eso descargaba la tabla
-- completa de abogados visibles antes de recortar a 100.
--
-- Esta función mueve el ordenamiento y el límite a la base de datos: recibe
-- la provincia como parámetro, así que su ORDER BY sí puede priorizar
-- coincidencia por provincia principal sobre zona de servicio adicional
-- (misma regla que tenía el sort en el cliente) y aplicar LIMIT 100 antes de
-- devolver filas, no después.
--
-- SECURITY INVOKER, LANGUAGE sql: solo reenvuelve un SELECT sobre la vista
-- busqueda_abogados (ya filtrada por verificación/disponibilidad/suscripción/
-- bloqueos/visibilidad pública, migración 20260725_063) — no necesita
-- privilegios elevados, y al ser INVOKER preserva auth.uid() para que la
-- vista siga enmascarando campos a visitantes sin sesión exactamente igual
-- que si el frontend consultara la vista directamente.
CREATE OR REPLACE FUNCTION buscar_abogados_por_provincia(
  p_provincia_id integer,
  p_especialidad text DEFAULT NULL,
  p_caso_frecuente text DEFAULT NULL,
  p_nombre text DEFAULT NULL,
  p_tipo text DEFAULT NULL
)
RETURNS SETOF busqueda_abogados
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
  FROM busqueda_abogados
  WHERE (provincia_id = p_provincia_id OR p_provincia_id = ANY(zonas_servicio_ids))
    AND (p_especialidad IS NULL OR especialidades @> ARRAY[p_especialidad])
    AND (p_caso_frecuente IS NULL OR casos_frecuentes @> ARRAY[p_caso_frecuente])
    AND (
      p_nombre IS NULL
      OR nombre_completo ILIKE '%' || p_nombre || '%'
      OR estudio_nombre ILIKE '%' || p_nombre || '%'
    )
    AND (p_tipo IS NULL OR tipo_badge = p_tipo)
  ORDER BY
    (provincia_id = p_provincia_id) DESC,
    rating_promedio DESC NULLS LAST,
    total_resenas DESC NULLS LAST
  LIMIT 100;
$$;

COMMENT ON FUNCTION buscar_abogados_por_provincia(integer, text, text, text, text) IS 'Búsqueda de abogados filtrada por provincia (principal o zona de servicio adicional), ordenada con la provincia principal primero y limitada a 100 resultados en la base de datos — reemplaza el sort+slice en el cliente de api.abogados.buscar().';

-- anon: busqueda.html es accesible sin sesión (migración 20260707_032 /
-- 20260725_063) y ya consulta busqueda_abogados directamente sin login;
-- esta función debe poder llamarse desde ese mismo flujo.
GRANT EXECUTE ON FUNCTION buscar_abogados_por_provincia(integer, text, text, text, text) TO anon, authenticated;
