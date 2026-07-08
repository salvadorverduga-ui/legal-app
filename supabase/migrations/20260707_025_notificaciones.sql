-- 20260707_025_notificaciones.sql
-- Sistema de notificaciones internas (CLAUDE.md módulo 5): cada usuario ve
-- únicamente sus propias notificaciones. Se insertan exclusivamente desde
-- triggers en solicitudes y verificaciones — nunca desde el frontend — para
-- que el evento notificado siempre corresponda a un cambio real de estado.
-- El frontend (frontend/js/notificaciones.js) las lee, las marca como
-- leídas y se suscribe a Supabase Realtime para actualizar el badge sin
-- recargar la página.

CREATE TYPE tipo_notificacion AS ENUM (
  'nueva_solicitud',
  'solicitud_aceptada',
  'solicitud_rechazada',
  'solicitud_expirada',
  'verificacion_aprobada',
  'verificacion_rechazada',
  'suscripcion_inactiva'
);

CREATE TABLE notificaciones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   uuid NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  tipo         tipo_notificacion NOT NULL,
  titulo       text NOT NULL,
  mensaje      text NOT NULL,
  leida        boolean NOT NULL DEFAULT false,
  url_destino  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Cubre tanto "traer las no leídas" (dropdown/badge) como el orden por fecha.
CREATE INDEX idx_notificaciones_no_leidas ON notificaciones (usuario_id, created_at DESC)
  WHERE leida = false;

COMMENT ON TABLE notificaciones IS 'Notificaciones internas por usuario (CLAUDE.md módulo 5). Se insertan únicamente desde fn_notificar_* (triggers), nunca desde el frontend.';

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario_ve_propias_notificaciones" ON notificaciones
  FOR SELECT
  USING (usuario_id = auth.uid());

-- El usuario solo puede marcar sus propias notificaciones como leídas.
-- WITH CHECK impide "desmarcarlas" o alterar tipo/titulo/mensaje/url_destino
-- (mismo patrón que "cliente_cancela_solicitud", migración 023).
CREATE POLICY "usuario_marca_leida" ON notificaciones
  FOR UPDATE
  USING (usuario_id = auth.uid())
  WITH CHECK (
    usuario_id = auth.uid()
    AND leida = true
    AND tipo        IS NOT DISTINCT FROM (SELECT tipo        FROM notificaciones WHERE id = notificaciones.id)
    AND titulo       IS NOT DISTINCT FROM (SELECT titulo      FROM notificaciones WHERE id = notificaciones.id)
    AND mensaje      IS NOT DISTINCT FROM (SELECT mensaje     FROM notificaciones WHERE id = notificaciones.id)
    AND url_destino  IS NOT DISTINCT FROM (SELECT url_destino FROM notificaciones WHERE id = notificaciones.id)
  );

-- Sin política de INSERT/DELETE para authenticated: la única vía de escritura
-- es fn_crear_notificacion(), invocada desde los triggers SECURITY DEFINER
-- de abajo (igual que admin_log en la migración 024).
COMMENT ON POLICY "usuario_marca_leida" ON notificaciones IS
  'El usuario solo puede transicionar leida de false a true en notificaciones propias, sin alterar el resto de columnas.';

GRANT SELECT, UPDATE ON TABLE notificaciones TO authenticated;

-- Habilita Realtime sobre notificaciones para que el badge se actualice sin
-- recargar (frontend/js/notificaciones.js se suscribe con postgres_changes).
-- Realtime respeta el RLS de la tabla: cada cliente solo recibe eventos de
-- sus propias filas, igual que con SELECT vía PostgREST.
ALTER PUBLICATION supabase_realtime ADD TABLE notificaciones;


-- ────────────────────────────────────────────────
-- Helper: inserta una notificación.
-- SECURITY DEFINER porque quien dispara el evento (el abogado que acepta,
-- el admin que aprueba) casi nunca es el destinatario de la notificación,
-- y el destinatario no tiene GRANT INSERT sobre la tabla.
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_notificacion(
  p_usuario_id  uuid,
  p_tipo        tipo_notificacion,
  p_titulo      text,
  p_mensaje     text,
  p_url_destino text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, url_destino)
  VALUES (p_usuario_id, p_tipo, p_titulo, p_mensaje, p_url_destino);
$$;

COMMENT ON FUNCTION fn_crear_notificacion(uuid, tipo_notificacion, text, text, text) IS
  'Inserta una notificación para p_usuario_id. Invocada únicamente desde los triggers fn_notificar_*; no se otorga GRANT a authenticated porque no se llama vía RPC desde el frontend.';


-- ────────────────────────────────────────────────
-- Trigger: nueva solicitud -> notifica al abogado destinatario.
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notificar_nueva_solicitud()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_crear_notificacion(
    NEW.abogado_id,
    'nueva_solicitud',
    'Nueva solicitud de consulta',
    'Tiene una nueva solicitud de consulta pendiente de respuesta.',
    '/pages/panel-abogado'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_nueva_solicitud
  AFTER INSERT ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_nueva_solicitud();


-- ────────────────────────────────────────────────
-- Trigger: cambio de estado de solicitud -> notifica al cliente.
-- AFTER UPDATE: corre después de fn_revelar_contacto_al_aceptar (BEFORE
-- UPDATE, migración 006), así que NEW ya trae el estado final de la fila.
-- Cubre tanto la transición hecha por el abogado (ACEPTADA/RECHAZADA) como
-- la expiración automática por pg_cron (fn_expirar_solicitudes_pendientes,
-- migración 020), que también dispara triggers por fila en su UPDATE masivo.
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notificar_estado_solicitud()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.estado = 'ACEPTADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_aceptada',
        'Su solicitud fue aceptada',
        'El abogado aceptó su solicitud de consulta. Ya puede ver sus datos de contacto.',
        '/pages/panel-cliente'
      );
    ELSIF NEW.estado = 'RECHAZADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_rechazada',
        'Su solicitud fue rechazada',
        'El abogado no está disponible para esta consulta en este momento.',
        '/pages/panel-cliente'
      );
    ELSIF NEW.estado = 'EXPIRADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_expirada',
        'Su solicitud expiró',
        'El abogado no respondió a tiempo. Puede buscar otro abogado disponible.',
        '/pages/panel-cliente'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_estado_solicitud
  AFTER UPDATE OF estado ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_estado_solicitud();


-- ────────────────────────────────────────────────
-- Trigger: cambio de estado de verificación -> notifica al solicitante.
-- El destinatario es el abogado (abogado_id) o, si la verificación es de
-- un estudio, el representante legal (estudios.representante_legal_id) —
-- misma resolución de entidad que fn_propagar_estado_verificacion.
-- AFTER UPDATE: corre después de esa función (BEFORE UPDATE, migración 008),
-- así que NEW ya trae motivo_rechazo y el estado final.
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notificar_estado_verificacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_destinatario uuid;
  v_url          text;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('VERIFICADO', 'RECHAZADO') THEN
    IF NEW.abogado_id IS NOT NULL THEN
      v_destinatario := NEW.abogado_id;
      v_url := '/pages/panel-abogado';
    ELSE
      SELECT representante_legal_id INTO v_destinatario FROM estudios WHERE id = NEW.estudio_id;
      v_url := '/pages/panel-estudio';
    END IF;

    IF NEW.estado = 'VERIFICADO' THEN
      PERFORM fn_crear_notificacion(
        v_destinatario, 'verificacion_aprobada',
        'Verificación aprobada',
        'Su verificación fue aprobada. Su perfil ya puede aparecer en las búsquedas.',
        v_url
      );
    ELSE
      PERFORM fn_crear_notificacion(
        v_destinatario, 'verificacion_rechazada',
        'Verificación rechazada',
        COALESCE('Motivo: ' || NEW.motivo_rechazo, 'Su verificación fue rechazada. Revise los documentos enviados.'),
        v_url
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_estado_verificacion
  AFTER UPDATE OF estado ON verificaciones
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_estado_verificacion();
