-- 20260625_004_abogados.sql
-- Extiende perfiles para usuarios con rol='abogado'.
-- Contiene datos profesionales y el estado operativo.
-- LA REGLA CENTRAL: un perfil solo aparece en búsquedas si cumple simultáneamente
--   verificacion='VERIFICADO' AND toggle_disponible=true AND suscripción vigente (o en gracia de 4 días).
-- Esta regla se aplica como política RLS — nunca solo en el frontend.

CREATE TABLE abogados (
  id                        uuid PRIMARY KEY REFERENCES perfiles(id) ON DELETE CASCADE,
  -- Datos profesionales
  especialidades            text[] NOT NULL DEFAULT '{}',   -- ["Derecho de familia", "Laboral", ...]
  casos_frecuentes          text[] NOT NULL DEFAULT '{}',   -- ["Divorcio", "Herencia", "Despido", ...]
  descripcion               text,
  precio_consulta           numeric(10,2),    -- referencial; tarifa real se pacta offline
  numero_registro           text,             -- número en el registro del foro de abogados
  -- Documentos de verificación (paths en Supabase Storage; acceso controlado por Storage policies)
  doc_carnet_url            text,
  doc_cedula_url            text,
  -- Estado operativo — los tres determinan visibilidad en búsqueda
  verificacion              estado_verificacion NOT NULL DEFAULT 'PENDIENTE',
  toggle_disponible         boolean NOT NULL DEFAULT true,
  suscripcion_vigente_hasta date,             -- denormalizado desde suscripciones para RLS sin JOIN
  -- Estructura: un abogado puede pertenecer a un estudio O a una red, no ambos simultáneamente
  estudio_id                uuid REFERENCES estudios(id) ON DELETE SET NULL,
  red_id                    uuid REFERENCES redes_colaboradores(id) ON DELETE SET NULL,
  -- Métricas de reseñas (actualizadas por trigger en resenas.sql)
  rating_promedio           numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_promedio BETWEEN 0 AND 5),
  total_resenas             integer NOT NULL DEFAULT 0 CHECK (total_resenas >= 0),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- GIN indexes para filtrado eficiente por especialidad y caso frecuente en búsqueda
CREATE INDEX idx_abogados_especialidades ON abogados USING GIN (especialidades);
CREATE INDEX idx_abogados_casos_frecuentes ON abogados USING GIN (casos_frecuentes);
-- Índice compuesto para la condición de visibilidad (las tres columnas que usa el RLS de búsqueda)
CREATE INDEX idx_abogados_visibilidad ON abogados (verificacion, toggle_disponible, suscripcion_vigente_hasta);

COMMENT ON TABLE abogados IS 'Datos profesionales de abogados. RLS garantiza que solo los verificados, disponibles y con suscripción vigente (o en gracia) aparecen en búsqueda pública.';
COMMENT ON COLUMN abogados.suscripcion_vigente_hasta IS 'Denormalizado desde suscripciones para que la política RLS no necesite JOIN. El trigger en suscripciones lo mantiene sincronizado.';
COMMENT ON COLUMN abogados.doc_carnet_url IS 'Path en Supabase Storage. Visible solo para el propio abogado y admins mediante Storage policies.';

ALTER TABLE abogados ENABLE ROW LEVEL SECURITY;

-- El abogado ve su propio perfil completo sin importar su estado de verificación/suscripción
CREATE POLICY "abogado_ve_propio" ON abogados
  FOR SELECT
  USING (id = auth.uid());

-- El abogado puede actualizar sus propios datos profesionales.
-- No puede cambiar verificacion (solo admin) ni suscripcion_vigente_hasta (solo trigger).
CREATE POLICY "abogado_update_propio" ON abogados
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND verificacion = (SELECT verificacion FROM abogados WHERE id = auth.uid())
    AND suscripcion_vigente_hasta IS NOT DISTINCT FROM (SELECT suscripcion_vigente_hasta FROM abogados WHERE id = auth.uid())
  );

-- Admin puede ver y modificar todos los perfiles
CREATE POLICY "admin_select_abogados" ON abogados
  FOR SELECT USING (es_admin());

CREATE POLICY "admin_update_abogados" ON abogados
  FOR UPDATE USING (es_admin());

-- POLÍTICA CRÍTICA: búsqueda pública.
-- Las tres condiciones son obligatorias y simultáneas (AND, no OR).
-- Período de gracia de 4 días: suscripción vencida hace <= 4 días sigue siendo visible.
-- Esta política actúa sobre la tabla directamente; la vista busqueda_abogados (migration 9)
-- la complementa excluyendo columnas sensibles.
CREATE POLICY "busqueda_publica_abogados" ON abogados
  FOR SELECT
  USING (
    verificacion = 'VERIFICADO'
    AND toggle_disponible = true
    AND suscripcion_vigente_hasta IS NOT NULL
    AND (
      suscripcion_vigente_hasta >= CURRENT_DATE
      OR suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
    )
  );

CREATE TRIGGER trg_abogados_updated_at
  BEFORE UPDATE ON abogados
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- Trigger: al insertar un perfil con rol='abogado', crear automáticamente la fila en abogados.
CREATE OR REPLACE FUNCTION fn_crear_fila_abogado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rol = 'abogado' THEN
    INSERT INTO abogados (id) VALUES (NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crear_fila_abogado
  AFTER INSERT ON perfiles
  FOR EACH ROW EXECUTE FUNCTION fn_crear_fila_abogado();
