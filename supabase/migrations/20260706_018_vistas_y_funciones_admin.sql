-- 20260706_018_vistas_y_funciones_admin.sql
-- Vistas y función RPC para el panel de administración.
-- Las vistas se ejecutan con los permisos de su dueño (postgres) y por lo
-- tanto NO heredan el RLS de las tablas subyacentes (ver comentario en
-- 20260625_011_grants.sql). Por eso cada vista filtra explícitamente con
-- es_admin() en su propio WHERE — es el único blindaje real de estos datos.

-- ────────────────────────────────────────────────
-- Vista: cola de verificaciones pendientes
-- Resuelve el nombre del solicitante (abogado o representante del estudio)
-- y expone los paths de los documentos subidos para que el admin los revise.
-- ────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────
-- Vista: suscripciones con nombre del abogado/estudio resuelto
-- ────────────────────────────────────────────────
CREATE OR REPLACE VIEW admin_suscripciones AS
SELECT
  s.id,
  s.tipo,
  s.estado,
  s.monto,
  s.fecha_inicio,
  s.fecha_vencimiento,
  s.metodo_pago,
  CASE WHEN s.abogado_id IS NOT NULL THEN 'abogado' ELSE 'estudio' END AS tipo_suscriptor,
  COALESCE(p.nombre_completo, e.nombre) AS nombre
FROM suscripciones s
LEFT JOIN perfiles p ON p.id = s.abogado_id
LEFT JOIN estudios  e ON e.id = s.estudio_id
WHERE es_admin();

COMMENT ON VIEW admin_suscripciones IS 'Listado de suscripciones para el panel de administración. Filtra por es_admin() porque la vista no hereda el RLS de suscripciones.';

-- ────────────────────────────────────────────────
-- Función: métricas agregadas del panel de administración
-- SECURITY DEFINER porque agrega sobre tablas cuyo RLS impediría a un
-- no-admin ver los conteos totales. El chequeo de es_admin() interno
-- reemplaza al RLS que una función no puede tener.
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_obtener_metricas()
RETURNS TABLE (
  total_abogados_verificados integer,
  total_clientes             integer,
  total_solicitudes_mes      integer,
  tasa_aceptacion            numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT es_admin() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::integer FROM abogados WHERE verificacion = 'VERIFICADO'),
    (SELECT COUNT(*)::integer FROM perfiles WHERE rol = 'cliente'),
    (SELECT COUNT(*)::integer FROM solicitudes
       WHERE created_at >= date_trunc('month', CURRENT_DATE)),
    (SELECT CASE
       WHEN COUNT(*) FILTER (WHERE estado IN ('ACEPTADA', 'COMPLETADA', 'RESEÑADA', 'RECHAZADA')) = 0 THEN 0
       ELSE ROUND(
         100.0 * COUNT(*) FILTER (WHERE estado IN ('ACEPTADA', 'COMPLETADA', 'RESEÑADA'))
         / COUNT(*) FILTER (WHERE estado IN ('ACEPTADA', 'COMPLETADA', 'RESEÑADA', 'RECHAZADA'))
       , 1)
     END
     FROM solicitudes);
END;
$$;

COMMENT ON FUNCTION admin_obtener_metricas() IS 'Métricas agregadas del panel de administración. tasa_aceptacion excluye PENDIENTE/EXPIRADA del denominador (solo cuenta solicitudes ya decididas). Lanza excepción si quien llama no es admin.';

-- ────────────────────────────────────────────────
-- GRANTs (CLAUDE.md §12: en el mismo PR donde se crea el objeto)
-- Solo authenticated: anon nunca debería llegar al panel de administración.
-- El acceso real está acotado por es_admin() dentro de cada vista/función,
-- no por este GRANT (que es el mismo para todo authenticated).
-- ────────────────────────────────────────────────
GRANT SELECT ON admin_verificaciones_pendientes TO authenticated;
GRANT SELECT ON admin_suscripciones TO authenticated;
GRANT EXECUTE ON FUNCTION admin_obtener_metricas() TO authenticated;
