-- 20260725_063_visibilidad_publica_abogado.sql
-- Feature (smoke test): el abogado controla si aparece en la búsqueda pública
-- accesible sin cuenta (busqueda.html/perfil-abogado.html para visitantes
-- anónimos, ver migración 20260707_032) y qué campos de su tarjeta se
-- muestran a esos visitantes. No afecta a clientes con sesión activa: para
-- ellos la búsqueda sigue mostrando todos los abogados verificados con
-- suscripción vigente, sin restricción adicional — visible_publico solo
-- aplica a la navegación "sin necesidad de cuenta".

ALTER TABLE abogados
  ADD COLUMN visible_publico boolean NOT NULL DEFAULT false,
  ADD COLUMN campos_publicos jsonb NOT NULL DEFAULT
    '{"foto":true,"especialidades":true,"provincia":true,"precio":false,"rating":true,"zonas_servicio":false}'::jsonb;

COMMENT ON COLUMN abogados.visible_publico IS 'Si es true, el abogado aparece en busqueda.html/perfil-abogado.html para visitantes sin sesión. No afecta la visibilidad para clientes autenticados (ver busqueda_publica_abogados/busqueda_abogados, que ya filtran por verificacion/toggle_disponible/suscripción para todos).';
COMMENT ON COLUMN abogados.campos_publicos IS 'Qué campos de la tarjeta pública se muestran a visitantes sin sesión (foto, especialidades, provincia, precio, rating, zonas_servicio). Solo aplica cuando visible_publico=true; clientes autenticados siempre ven todos los campos.';

-- No hace falta ningún GRANT nuevo (CLAUDE.md §12): el GRANT sobre la tabla
-- abogados ya es a nivel de tabla completa, no por columna, y las columnas
-- nuevas heredan los mismos permisos que el resto. abogado_update_propio
-- (migración 004, extendida en 020260712_043_referidos.sql para
-- codigo_referido) no necesita tocarse: solo congela verificacion,
-- suscripcion_vigente_hasta y codigo_referido — visible_publico y
-- campos_publicos ya son libremente editables por el propio abogado bajo
-- esa política, sin cambios.

-- busqueda_abogados (vista SECURITY DEFINER, única superficie de lectura de
-- anon sobre datos de abogados — anon no tiene GRANT directo sobre la tabla,
-- ver migración 032) gana:
--   1. En el WHERE: sin sesión (auth.uid() IS NULL), solo entran los
--      abogados con visible_publico=true. Con sesión, sin cambios.
--   2. En el SELECT: foto/especialidades/provincia-cantón/precio/rating/
--      zonas_servicio se enmascaran a NULL para visitantes sin sesión según
--      campos_publicos — con sesión, siempre se devuelven completos (nunca
--      se restringe a un cliente autenticado por esta configuración).
CREATE OR REPLACE VIEW busqueda_abogados AS
SELECT
  a.id,
  p.nombre_completo,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'foto')::boolean
    THEN p.foto_url ELSE NULL::text END AS foto_url,
  p.ciudad,
  p.provincia,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'especialidades')::boolean
    THEN a.especialidades ELSE NULL::text[] END AS especialidades,
  a.casos_frecuentes,
  a.descripcion,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'precio')::boolean
    THEN a.precio_consulta ELSE NULL::numeric(10,2) END AS precio_consulta,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'rating')::boolean
    THEN a.rating_promedio ELSE NULL::numeric(3,2) END AS rating_promedio,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'rating')::boolean
    THEN a.total_resenas ELSE 0 END AS total_resenas,
  a.toggle_disponible,
  a.red_id,
  a.estudio_id,
  CASE
    WHEN a.estudio_id IS NOT NULL THEN 'estudio'::text
    WHEN a.red_id IS NOT NULL THEN 'red'::text
    ELSE 'individual'::text
  END AS tipo_badge,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'provincia')::boolean
    THEN a.provincia_id ELSE NULL::integer END AS provincia_id,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'provincia')::boolean
    THEN prov.nombre ELSE NULL::text END AS provincia_nombre,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'provincia')::boolean
    THEN a.canton_id ELSE NULL::integer END AS canton_id,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'provincia')::boolean
    THEN cant.nombre ELSE NULL::text END AS canton_nombre,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'zonas_servicio')::boolean
    THEN COALESCE(zonas.provincia_ids, '{}'::integer[]) ELSE '{}'::integer[] END AS zonas_servicio_ids,
  CASE WHEN auth.uid() IS NOT NULL OR (a.campos_publicos->>'zonas_servicio')::boolean
    THEN COALESCE(zonas.nombres, '{}'::text[]) ELSE '{}'::text[] END AS zonas_servicio_nombres,
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
WHERE a.verificacion = 'VERIFICADO'::estado_verificacion
  AND a.toggle_disponible = true
  AND a.suscripcion_vigente_hasta IS NOT NULL
  AND (a.suscripcion_vigente_hasta >= CURRENT_DATE OR a.suscripcion_vigente_hasta >= (CURRENT_DATE - '4 days'::interval))
  AND NOT fn_existe_bloqueo(auth.uid(), a.id)
  AND (auth.uid() IS NOT NULL OR a.visible_publico = true);

COMMENT ON VIEW busqueda_abogados IS 'Vista de búsqueda pública de abogados. Filtra por verificacion=VERIFICADO AND toggle_disponible=true AND suscripción vigente/gracia. Sin sesión (anon), exige además visible_publico=true y enmascara a NULL los campos que abogados.campos_publicos marque como ocultos. Con sesión, sin restricciones adicionales. No expone teléfono ni email.';
