-- 20260625_006_solicitudes.sql
-- Núcleo del flujo mediado. El cliente solicita; el abogado acepta o rechaza.
-- Regla crítica de privacidad: los datos de contacto del cliente (teléfono, email)
-- se copian en esta tabla SOLO cuando el estado transiciona a ACEPTADA.
-- Esto garantiza que el abogado nunca puede acceder al teléfono antes del match,
-- incluso consultando la tabla directamente con su token.

CREATE TYPE estado_solicitud AS ENUM (
  'PENDIENTE',    -- esperando respuesta del abogado (max 48h)
  'ACEPTADA',     -- abogado aceptó; datos de contacto revelados
  'COMPLETADA',   -- consulta realizada (marcado por el cliente)
  'RESEÑADA',     -- el cliente dejó una reseña
  'RECHAZADA',    -- abogado rechazó
  'EXPIRADA'      -- sin respuesta en 48h; pasa a este estado vía cron
);

CREATE TABLE solicitudes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id              uuid NOT NULL REFERENCES perfiles(id) ON DELETE RESTRICT,
  abogado_id              uuid NOT NULL REFERENCES abogados(id) ON DELETE RESTRICT,
  estado                  estado_solicitud NOT NULL DEFAULT 'PENDIENTE',
  -- Datos que el abogado ve desde que recibe la solicitud
  descripcion_caso        text,              -- descripción opcional; el cliente puede omitirla
  disponibilidad_horaria  text,              -- texto libre: "tardes entre semana", "fines de semana"
  -- Datos de contacto del cliente: NULL hasta que el estado sea ACEPTADA.
  -- Se copian desde perfiles y auth.users vía trigger fn_revelar_contacto_al_aceptar.
  -- El abogado no puede acceder a estos datos antes del match.
  cliente_telefono        text,
  cliente_email           text,
  -- Metadatos del ciclo de vida
  motivo_rechazo          text,              -- razón opcional que el abogado puede escribir al rechazar
  expires_at              timestamptz NOT NULL,  -- calculado al insertar: created_at + 48h
  aceptada_at             timestamptz,
  rechazada_at            timestamptz,
  completada_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Índice parcial: garantiza que no existan dos solicitudes activas simultáneas
-- entre el mismo par cliente-abogado. Las completadas/rechazadas/expiradas no cuentan.
CREATE UNIQUE INDEX idx_solicitud_activa_unica
  ON solicitudes (cliente_id, abogado_id)
  WHERE estado IN ('PENDIENTE', 'ACEPTADA');

CREATE INDEX idx_solicitudes_abogado ON solicitudes (abogado_id, estado, created_at DESC);
CREATE INDEX idx_solicitudes_cliente ON solicitudes (cliente_id, estado, created_at DESC);
-- Índice para el cron de expiración: solo filas PENDIENTE próximas a vencer
CREATE INDEX idx_solicitudes_expiracion ON solicitudes (expires_at)
  WHERE estado = 'PENDIENTE';

COMMENT ON TABLE solicitudes IS 'Flujo mediado: cliente solicita, abogado acepta/rechaza. Los datos de contacto del cliente se revelan solo al transicionar a ACEPTADA.';
COMMENT ON COLUMN solicitudes.cliente_telefono IS 'NULL hasta que el abogado acepta. Copiado desde perfiles por trigger. No existe forma de acceder a este dato antes del match.';
COMMENT ON COLUMN solicitudes.expires_at IS 'Calculado al crear: created_at + 48h. Un cron externo o función programada cambia el estado a EXPIRADA cuando now() > expires_at.';

ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY;

-- El cliente ve todas sus propias solicitudes (todos los estados)
CREATE POLICY "cliente_ve_propias_solicitudes" ON solicitudes
  FOR SELECT
  USING (cliente_id = auth.uid());

-- El abogado ve solicitudes dirigidas a él.
-- cliente_telefono y cliente_email serán NULL en estado PENDIENTE (ver trigger abajo).
CREATE POLICY "abogado_ve_propias_solicitudes" ON solicitudes
  FOR SELECT
  USING (abogado_id = auth.uid());

-- Admin ve todo
CREATE POLICY "admin_ve_solicitudes" ON solicitudes
  FOR SELECT USING (es_admin());

-- Solo clientes con rol='cliente' pueden crear solicitudes
CREATE POLICY "cliente_crea_solicitud" ON solicitudes
  FOR INSERT
  WITH CHECK (
    cliente_id = auth.uid()
    AND EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'cliente')
  );

-- El abogado puede actualizar el estado de las solicitudes dirigidas a él (aceptar/rechazar)
CREATE POLICY "abogado_responde_solicitud" ON solicitudes
  FOR UPDATE
  USING (abogado_id = auth.uid());

-- El cliente puede marcar como COMPLETADA (cuando ya tuvo la consulta)
CREATE POLICY "cliente_completa_solicitud" ON solicitudes
  FOR UPDATE
  USING (cliente_id = auth.uid());

-- Trigger: calcula expires_at al insertar (now() es más seguro que NEW.created_at en BEFORE trigger)
CREATE OR REPLACE FUNCTION fn_set_expires_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.expires_at = now() + INTERVAL '48 hours';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_solicitud_expires_at
  BEFORE INSERT ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION fn_set_expires_at();

-- Trigger: al transicionar a ACEPTADA, copiar datos de contacto del cliente.
-- Al transicionar a RECHAZADA (desde cualquier estado), limpiar esos datos.
-- SECURITY DEFINER para acceder a auth.users sin que el abogado pueda hacerlo directamente.
CREATE OR REPLACE FUNCTION fn_revelar_contacto_al_aceptar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.estado = 'PENDIENTE' AND NEW.estado = 'ACEPTADA' THEN
    -- Copiar teléfono desde perfiles y email desde auth.users
    SELECT p.telefono, u.email
    INTO   NEW.cliente_telefono, NEW.cliente_email
    FROM   perfiles p
    JOIN   auth.users u ON u.id = p.id
    WHERE  p.id = NEW.cliente_id;

    NEW.aceptada_at = now();
  END IF;

  IF NEW.estado = 'RECHAZADA' THEN
    -- Limpiar datos de contacto en todos los casos de rechazo (incluyendo post-aceptación por error)
    NEW.cliente_telefono = NULL;
    NEW.cliente_email    = NULL;
    NEW.rechazada_at     = now();
  END IF;

  IF OLD.estado = 'ACEPTADA' AND NEW.estado = 'COMPLETADA' THEN
    NEW.completada_at = now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_revelar_contacto
  BEFORE UPDATE OF estado ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION fn_revelar_contacto_al_aceptar();

CREATE TRIGGER trg_solicitudes_updated_at
  BEFORE UPDATE ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
