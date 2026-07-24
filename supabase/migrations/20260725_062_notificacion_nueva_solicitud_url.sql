-- 20260725_062_notificacion_nueva_solicitud_url.sql
-- Fix (smoke test): la notificación "Nueva solicitud de consulta" llevaba al
-- abogado a /pages/panel-abogado?tab=solicitudes (la portada de la pestaña,
-- ver migración 025), sin ubicar la solicitud concreta que la generó — con
-- varias solicitudes pendientes, el abogado tenía que buscarla a mano.
--
-- fn_notificar_nueva_solicitud() ahora arma la URL con el id de la solicitud
-- y, según el origen, apunta a solicitudes-directas.html o
-- solicitudes-tablon.html (CLAUDE.md §22: son páginas independientes, cada
-- una filtra por caso_tablon_id — un link a solicitudes-directas para una
-- solicitud de origen Tablón nunca la mostraría, porque esa página filtra
-- .is('caso_tablon_id', null)).
CREATE OR REPLACE FUNCTION fn_notificar_nueva_solicitud()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  v_url := CASE
    WHEN NEW.caso_tablon_id IS NULL THEN '/pages/solicitudes-directas?solicitud=' || NEW.id
    ELSE '/pages/solicitudes-tablon?solicitud=' || NEW.id
  END;

  PERFORM fn_crear_notificacion(
    NEW.abogado_id,
    'nueva_solicitud',
    'Nueva solicitud de consulta',
    'Tiene una nueva solicitud de consulta pendiente de respuesta.',
    v_url
  );
  RETURN NEW;
END;
$$;
