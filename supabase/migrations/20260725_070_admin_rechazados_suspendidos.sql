-- 20260725_070_admin_rechazados_suspendidos.sql
-- PARTE 4 del rediseño de verificación: sub-secciones "Rechazados" y
-- "Suspendidos" en panel-admin.html, además del botón "Suspensión
-- definitiva". Mismo patrón que admin_verificaciones_pendientes (migración
-- 018/027/065): vistas SECURITY DEFINER que filtran por es_admin() porque
-- no heredan el RLS de las tablas base.

-- ────────────────────────────────────────────────
-- Vista: verificaciones RECHAZADAS
-- ────────────────────────────────────────────────
CREATE OR REPLACE VIEW admin_verificaciones_rechazadas AS
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
  v.motivo_rechazo,
  v.intentos_verificacion,
  v.revisado_at
FROM verificaciones v
LEFT JOIN perfiles p_abogado ON p_abogado.id = v.abogado_id
LEFT JOIN estudios  e        ON e.id = v.estudio_id
LEFT JOIN perfiles p_estudio ON p_estudio.id = e.representante_legal_id
WHERE v.estado = 'RECHAZADO'
  AND es_admin();

COMMENT ON VIEW admin_verificaciones_rechazadas IS 'Verificaciones rechazadas para el panel de administración (pestaña "Rechazados"). Filtra por es_admin() porque la vista no hereda el RLS de verificaciones.';

GRANT SELECT ON admin_verificaciones_rechazadas TO authenticated;

-- ────────────────────────────────────────────────
-- Vista: cuentas con suspensión definitiva
-- Se arma desde perfiles (no desde verificaciones) porque la fuente de
-- verdad de "está suspendido" es perfiles.suspendido — la fila de
-- verificaciones solo aporta motivo y fecha para mostrar en la lista.
-- ────────────────────────────────────────────────
CREATE OR REPLACE VIEW admin_cuentas_suspendidas AS
SELECT
  p.id,
  p.rol,
  p.nombre_completo,
  p.foto_url,
  v.motivo_rechazo AS motivo_suspension,
  v.revisado_at     AS suspendido_at
FROM perfiles p
LEFT JOIN LATERAL (
  SELECT ver.motivo_rechazo, ver.revisado_at
  FROM verificaciones ver
  WHERE ver.estado = 'SUSPENDIDO'
    AND (
      ver.abogado_id = p.id
      OR ver.estudio_id IN (SELECT est.id FROM estudios est WHERE est.representante_legal_id = p.id)
    )
  ORDER BY ver.revisado_at DESC NULLS LAST
  LIMIT 1
) v ON true
WHERE p.suspendido = true
  AND es_admin();

COMMENT ON VIEW admin_cuentas_suspendidas IS 'Cuentas con suspensión definitiva (perfiles.suspendido = true) para el panel de administración (pestaña "Suspendidos"). Filtra por es_admin().';

GRANT SELECT ON admin_cuentas_suspendidas TO authenticated;

-- ────────────────────────────────────────────────
-- Función: suspensión definitiva (RPC)
-- Actualiza verificaciones.estado y perfiles.suspendido en una sola
-- transacción — dos UPDATEs sueltos desde el frontend (uno por tabla)
-- correrían el riesgo de quedar a medio camino ante un corte de red entre
-- ambos. SECURITY DEFINER porque perfiles.suspendido de OTRO usuario y
-- verificaciones de otro abogado/estudio no son editables por el admin vía
-- RLS normal desde acá adentro sin repetir es_admin() — igual se revalida
-- es_admin() explícitamente al inicio, como toda función SECURITY DEFINER
-- expuesta como RPC en este proyecto (mismo patrón que otras).
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_suspender_verificacion(p_verificacion_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_abogado_id          uuid;
  v_estudio_id          uuid;
  v_perfil_a_suspender  uuid;
BEGIN
  IF NOT es_admin() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT abogado_id, estudio_id INTO v_abogado_id, v_estudio_id
  FROM verificaciones WHERE id = p_verificacion_id;

  IF v_abogado_id IS NULL AND v_estudio_id IS NULL THEN
    RAISE EXCEPTION 'Verificación no encontrada';
  END IF;

  UPDATE verificaciones
  SET estado = 'SUSPENDIDO', motivo_rechazo = NULLIF(trim(p_motivo), '')
  WHERE id = p_verificacion_id;

  v_perfil_a_suspender := COALESCE(
    v_abogado_id,
    (SELECT representante_legal_id FROM estudios WHERE id = v_estudio_id)
  );

  UPDATE perfiles SET suspendido = true WHERE id = v_perfil_a_suspender;
END;
$$;

COMMENT ON FUNCTION admin_suspender_verificacion(uuid, text) IS 'Suspensión definitiva: marca verificaciones.estado = SUSPENDIDO y perfiles.suspendido = true en una sola transacción. Solo admin (revalida es_admin() internamente). La notificación al usuario la dispara trg_notificar_estado_verificacion (migración 069), no esta función.';

GRANT EXECUTE ON FUNCTION admin_suspender_verificacion(uuid, text) TO authenticated;
