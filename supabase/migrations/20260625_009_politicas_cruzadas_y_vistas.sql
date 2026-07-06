-- 20260625_009_politicas_cruzadas_y_vistas.sql
-- Políticas RLS que referencian más de una tabla (requieren que todas existan previamente)
-- y vistas de seguridad para el frontend.
-- Se ejecuta al final porque depende de perfiles, abogados, estudios, solicitudes y redes.

-- ────────────────────────────────────────────────
-- Políticas adicionales sobre perfiles
-- ────────────────────────────────────────────────

-- Los perfiles de abogados verificados/disponibles/con suscripción vigente son visibles
-- para usuarios autenticados. Solo expone los campos no sensibles (el teléfono
-- del abogado no se incluye en la vista busqueda_abogados definida más abajo).
CREATE POLICY "abogado_perfil_visible_busqueda" ON perfiles
  FOR SELECT
  TO authenticated
  USING (
    rol = 'abogado'
    AND EXISTS (
      SELECT 1 FROM abogados a
      WHERE a.id = perfiles.id
        AND a.verificacion = 'VERIFICADO'
        AND a.toggle_disponible = true
        AND a.suscripcion_vigente_hasta IS NOT NULL
        AND (
          a.suscripcion_vigente_hasta >= CURRENT_DATE
          OR a.suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
        )
    )
  );

-- El abogado puede ver los datos básicos (nombre, foto) del cliente que le envió una solicitud.
-- El teléfono del cliente está en solicitudes.cliente_telefono, no en perfiles directamente.
CREATE POLICY "abogado_ve_cliente_en_solicitud" ON perfiles
  FOR SELECT
  USING (
    rol = 'cliente'
    AND EXISTS (
      SELECT 1 FROM solicitudes s
      WHERE s.cliente_id = perfiles.id
        AND s.abogado_id = auth.uid()
        AND s.estado IN ('PENDIENTE', 'ACEPTADA', 'COMPLETADA', 'RESEÑADA')
    )
  );

-- ────────────────────────────────────────────────
-- Vista: búsqueda pública de abogados
-- No expone datos de contacto (teléfono, email, documentos de verificación).
-- El frontend usa esta vista para listar resultados; aplica filtros por
-- especialidades, casos_frecuentes, ciudad sobre ella.
-- ────────────────────────────────────────────────
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
  -- Badge visual para el listado mixto (PRD sección 4.2)
  CASE
    WHEN a.estudio_id IS NOT NULL THEN 'estudio'
    WHEN a.red_id IS NOT NULL     THEN 'red'
    ELSE                               'individual'
  END AS tipo_badge
FROM abogados a
JOIN perfiles p ON p.id = a.id
WHERE
  a.verificacion = 'VERIFICADO'
  AND a.toggle_disponible = true
  AND a.suscripcion_vigente_hasta IS NOT NULL
  AND (
    a.suscripcion_vigente_hasta >= CURRENT_DATE
    OR a.suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
  );

COMMENT ON VIEW busqueda_abogados IS 'Vista segura para búsqueda pública. Excluye teléfono, email, documentos y suscripcion_vigente_hasta. Filtrar por especialidades, casos_frecuentes o ciudad directamente sobre esta vista.';

-- ────────────────────────────────────────────────
-- Vista: panel de solicitudes del abogado
-- Muestra datos del cliente según el estado de la solicitud.
-- cliente_telefono y cliente_email son NULL hasta que el estado es ACEPTADA.
-- ────────────────────────────────────────────────
CREATE OR REPLACE VIEW panel_solicitudes_abogado AS
SELECT
  s.id,
  s.estado,
  s.descripcion_caso,
  s.disponibilidad_horaria,
  s.motivo_rechazo,
  s.expires_at,
  s.aceptada_at,
  s.rechazada_at,
  s.completada_at,
  s.created_at,
  -- Datos básicos del cliente (siempre visibles una vez enviada la solicitud)
  p.nombre_completo AS cliente_nombre,
  p.foto_url        AS cliente_foto,
  -- Datos de contacto: NULL hasta ACEPTADA (trigger fn_revelar_contacto_al_aceptar)
  s.cliente_telefono,
  s.cliente_email
FROM solicitudes s
JOIN perfiles p ON p.id = s.cliente_id
WHERE s.abogado_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_abogado IS 'Vista del panel del abogado. cliente_telefono y cliente_email son NULL hasta estado=ACEPTADA. Cada abogado solo ve sus propias solicitudes.';

-- ────────────────────────────────────────────────
-- Vista: panel de solicitudes del cliente
-- ────────────────────────────────────────────────
CREATE OR REPLACE VIEW panel_solicitudes_cliente AS
SELECT
  s.id,
  s.estado,
  s.descripcion_caso,
  s.disponibilidad_horaria,
  s.motivo_rechazo,
  s.expires_at,
  s.aceptada_at,
  s.created_at,
  -- Datos públicos del abogado (nombre, foto, ciudad)
  p.nombre_completo AS abogado_nombre,
  p.foto_url        AS abogado_foto,
  p.ciudad          AS abogado_ciudad,
  a.especialidades  AS abogado_especialidades,
  a.rating_promedio AS abogado_rating,
  -- El cliente nunca ve el teléfono privado del abogado; la consulta es offline
  -- El contacto se da cuando el abogado acepta y el abogado se comunica
  EXISTS (
    SELECT 1 FROM resenas r WHERE r.solicitud_id = s.id
  ) AS tiene_resena
FROM solicitudes s
JOIN perfiles p ON p.id = s.abogado_id
JOIN abogados a ON a.id = s.abogado_id
WHERE s.cliente_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_cliente IS 'Vista del panel del cliente. Muestra el estado de cada solicitud y datos públicos del abogado.';
