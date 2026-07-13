-- 20260712_044_notificaciones_tablon.sql
-- Notificaciones de El Tablón y de solicitud cancelada. Mismo patrón que
-- 20260707_025_notificaciones.sql: triggers SECURITY DEFINER que llaman a
-- fn_crear_notificacion(), nunca INSERT directo desde el frontend.
--
-- Los destinos pedidos originalmente para tablon_caso_cerrado y
-- tablon_caso_expirado eran /pages/tablon?tab=aplicaciones y
-- /pages/tablon?tab=mis-casos — tabs que existían en el tablon.html previo
-- al rediseño de El Tablón (migración 041/PR de El Tablón). Ese rediseño
-- separó tablon.html (listado) de tablon-caso.html (detalle de un caso) y
-- tablon.html ya no tiene ese concepto de tabs internas, así que ambos
-- destinos apuntan simplemente a /pages/tablon (el listado correspondiente
-- al rol de cada destinatario).

-- ────────────────────────────────────────────────────────────
-- tipo_notificacion: nuevos valores (deben declararse antes de usarse en
-- las funciones de abajo — mismo criterio que metodo_pago en la 043).
-- ────────────────────────────────────────────────────────────
ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'tablon_nueva_aplicacion';
ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'tablon_elegido';
ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'tablon_caso_cerrado';
ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'tablon_caso_expirado';
ALTER TYPE tipo_notificacion ADD VALUE IF NOT EXISTS 'solicitud_cancelada';


-- ────────────────────────────────────────────────────────────
-- Trigger: nueva aplicación a un caso -> notifica al cliente dueño.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notificar_nueva_aplicacion_tablon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid;
  v_titulo     text;
BEGIN
  SELECT cliente_id, titulo INTO v_cliente_id, v_titulo FROM casos_tablon WHERE id = NEW.caso_id;

  PERFORM fn_crear_notificacion(
    v_cliente_id,
    'tablon_nueva_aplicacion',
    'Nueva aplicación a su caso',
    'Un abogado aplicó a su caso "' || v_titulo || '" en El Tablón.',
    '/pages/tablon-caso?id=' || NEW.caso_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_nueva_aplicacion_tablon
  AFTER INSERT ON aplicaciones_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_nueva_aplicacion_tablon();


-- ────────────────────────────────────────────────────────────
-- Trigger: el cliente elige a un abogado -> notifica al elegido.
-- Separado del trigger fn_crear_solicitud_desde_tablon (mismo evento,
-- AFTER UPDATE OF estado ON aplicaciones_tablon — Postgres soporta varios
-- triggers independientes sobre el mismo evento, igual que
-- trg_revelar_contacto y trg_solicitudes_updated_at en solicitudes).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notificar_elegido_tablon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_titulo text;
BEGIN
  IF NEW.estado = 'ELEGIDO' AND OLD.estado IS DISTINCT FROM 'ELEGIDO' THEN
    SELECT titulo INTO v_titulo FROM casos_tablon WHERE id = NEW.caso_id;

    PERFORM fn_crear_notificacion(
      NEW.abogado_id,
      'tablon_elegido',
      'Fue elegido para un caso',
      'El cliente lo eligió para atender el caso "' || v_titulo || '". Sus datos de contacto ya fueron revelados.',
      '/pages/tablon-caso?id=' || NEW.caso_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_elegido_tablon
  AFTER UPDATE OF estado ON aplicaciones_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_elegido_tablon();


-- ────────────────────────────────────────────────────────────
-- Trigger: cambio de estado de un caso -> notifica según el nuevo estado.
--
-- tablon_caso_cerrado va atado al CIERRE REAL del caso (estado = CERRADO,
-- botón "Cerrar caso" de tablon-caso.html), no al momento en que un
-- aplicante puntual pasa a ELEGIDO: CLAUDE.md §17 documenta que el cliente
-- puede elegir a más de un aplicante para el mismo caso, así que un
-- aplicante PENDIENTE no necesariamente perdió su oportunidad solo porque
-- otro fue elegido. Recién al cerrar el caso se sabe que ya no habrá más
-- elecciones, y ahí se notifica a todos los que seguían PENDIENTE.
--
-- tablon_caso_expirado notifica al cliente cuando su caso pasa a EXPIRADO
-- (incluye la expiración automática por pg_cron, fn_expirar_casos_tablon —
-- dispara el trigger por fila igual que en un UPDATE manual, mismo patrón
-- que fn_notificar_estado_solicitud con fn_expirar_solicitudes_pendientes).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notificar_estado_caso_tablon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_abogado_id uuid;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.estado = 'CERRADO' THEN
      FOR v_abogado_id IN
        SELECT abogado_id FROM aplicaciones_tablon
        WHERE caso_id = NEW.id AND estado = 'PENDIENTE'
      LOOP
        PERFORM fn_crear_notificacion(
          v_abogado_id,
          'tablon_caso_cerrado',
          'Caso atendido',
          'El caso "' || NEW.titulo || '" ya fue atendido. Gracias por su interés.',
          '/pages/tablon'
        );
      END LOOP;
    ELSIF NEW.estado = 'EXPIRADO' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id,
        'tablon_caso_expirado',
        'Su caso expiró',
        'Su caso "' || NEW.titulo || '" en El Tablón expiró sin que usted eligiera a un abogado.',
        '/pages/tablon'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_estado_caso_tablon
  AFTER UPDATE OF estado ON casos_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_notificar_estado_caso_tablon();


-- ────────────────────────────────────────────────────────────
-- solicitud_cancelada: se agrega como una rama más de la función existente
-- fn_notificar_estado_solicitud (no un trigger nuevo — ya está enganchada a
-- AFTER UPDATE OF estado ON solicitudes desde la migración 025/037).
-- ────────────────────────────────────────────────────────────
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
        '/pages/panel-cliente?tab=solicitudes'
      );
    ELSIF NEW.estado = 'RECHAZADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_rechazada',
        'Su solicitud fue rechazada',
        'El abogado no está disponible para esta consulta en este momento.',
        '/pages/panel-cliente?tab=solicitudes'
      );
    ELSIF NEW.estado = 'EXPIRADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.cliente_id, 'solicitud_expirada',
        'Su solicitud expiró',
        'El abogado no respondió a tiempo. Puede buscar otro abogado disponible.',
        '/pages/panel-cliente?tab=solicitudes'
      );
    ELSIF NEW.estado = 'CANCELADA' THEN
      PERFORM fn_crear_notificacion(
        NEW.abogado_id, 'solicitud_cancelada',
        'Solicitud cancelada',
        'El cliente canceló su solicitud de consulta.',
        '/pages/panel-abogado?tab=solicitudes'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- GRANTS (CLAUDE.md §12)
-- Ninguno: los triggers son SECURITY DEFINER e invocados por el motor de
-- PostgreSQL, no por el cliente. fn_crear_notificacion ya existe (migración
-- 025) y no requiere GRANT (mismo motivo). La tabla notificaciones ya tiene
-- GRANT SELECT, UPDATE a authenticated desde la 025 — sin cambios acá.
-- ────────────────────────────────────────────────────────────
