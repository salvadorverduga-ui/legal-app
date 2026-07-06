-- 20260625_002_estudios.sql
-- Estudios jurídicos: entidades organizacionales con múltiples abogados miembros.
-- No son usuarios directos de auth.users; el representante legal sí lo es.
-- Planes: PEQUENO (hasta 3 abogados, $29.99), MEDIANO (hasta 8, $59.99), GRANDE (ilimitados, $99.99).
-- Visible en búsqueda solo si: verificado + al menos un miembro verificado + suscripción vigente.

-- Tipos compartidos entre estudios y abogados; se crean aquí porque estudios se migra primero.
CREATE TYPE plan_estudio AS ENUM ('PEQUENO', 'MEDIANO', 'GRANDE');
CREATE TYPE estado_verificacion AS ENUM ('PENDIENTE', 'VERIFICADO', 'RECHAZADO', 'SUSPENDIDO');

CREATE TABLE estudios (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  text NOT NULL,
  descripcion             text,
  logo_url                text,                          -- path en Supabase Storage
  ruc                     text NOT NULL UNIQUE,          -- RUC ecuatoriano; único por entidad
  plan                    plan_estudio NOT NULL,
  verificacion            estado_verificacion NOT NULL DEFAULT 'PENDIENTE',
  toggle_disponible       boolean NOT NULL DEFAULT true,
  suscripcion_vigente_hasta date,                        -- denormalizado desde suscripciones para RLS sin JOIN
  ciudad                  text,
  provincia               text,
  especialidades          text[] NOT NULL DEFAULT '{}',  -- GIN index para filtrado en búsqueda
  representante_legal_id  uuid NOT NULL REFERENCES perfiles(id) ON DELETE RESTRICT,
  -- RESTRICT: no se puede borrar el perfil del representante mientras gestione un estudio
  rating_promedio         numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_promedio BETWEEN 0 AND 5),
  total_resenas           integer NOT NULL DEFAULT 0 CHECK (total_resenas >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_estudios_especialidades ON estudios USING GIN (especialidades);
CREATE INDEX idx_estudios_visibilidad ON estudios (verificacion, toggle_disponible, suscripcion_vigente_hasta);

COMMENT ON TABLE estudios IS 'Entidades jurídicas organizacionales. Visible en búsqueda solo si verificado, disponible, con suscripción vigente y al menos un miembro abogado verificado.';
COMMENT ON COLUMN estudios.suscripcion_vigente_hasta IS 'Denormalizado desde suscripciones para que la política RLS no necesite un JOIN. Se actualiza vía trigger al registrar/renovar suscripción.';
COMMENT ON COLUMN estudios.plan IS 'Límite de miembros por plan. PEQUENO: 3, MEDIANO: 8, GRANDE: ilimitado. El límite se valida en Edge Function al agregar miembros.';

ALTER TABLE estudios ENABLE ROW LEVEL SECURITY;

-- El representante legal ve y edita su propio estudio
CREATE POLICY "estudio_representante_select" ON estudios
  FOR SELECT
  USING (representante_legal_id = auth.uid());

CREATE POLICY "estudio_representante_update" ON estudios
  FOR UPDATE
  USING (representante_legal_id = auth.uid())
  WITH CHECK (
    representante_legal_id = auth.uid()
    -- El representante no puede cambiar el estado de verificación ni el plan directamente
    AND verificacion = (SELECT verificacion FROM estudios WHERE id = estudios.id)
    AND plan = (SELECT plan FROM estudios WHERE id = estudios.id)
  );

-- Admin gestiona todo
CREATE POLICY "admin_select_estudios" ON estudios
  FOR SELECT USING (es_admin());

CREATE POLICY "admin_update_estudios" ON estudios
  FOR UPDATE USING (es_admin());

-- Búsqueda pública: solo estudios verificados + disponibles + suscripción vigente o en gracia de 4 días.
-- La condición "al menos un miembro verificado" se evalúa en la vista busqueda_abogados (migration 9).
CREATE POLICY "estudio_visible_busqueda" ON estudios
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

CREATE TRIGGER trg_estudios_updated_at
  BEFORE UPDATE ON estudios
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
