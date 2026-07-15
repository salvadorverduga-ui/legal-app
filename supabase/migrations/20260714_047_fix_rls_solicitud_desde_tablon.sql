-- 20260714_047_fix_rls_solicitud_desde_tablon.sql
-- Bug: elegirAbogado() (frontend/js/api.js) fallaba con "new row violates row-level
-- security policy for table solicitudes" al elegir un aplicante de El Tablón.
--
-- DIAGNÓSTICO (reproducido en vivo con SET LOCAL ROLE authenticated + request.jwt.claims,
-- dentro de una transacción con ROLLBACK, mismo método que la migración 046):
-- el error NO ocurre en el INSERT INTO solicitudes (ese sí cumple la política
-- "cliente_crea_solicitud": cliente_id = auth.uid() y rol = 'cliente'). Ocurre en el
-- UPDATE solicitudes SET estado = 'ACEPTADA' que hace fn_crear_solicitud_desde_tablon()
-- justo después (CLAUDE.md §17: se reutiliza el UPDATE para disparar
-- fn_revelar_contacto_al_aceptar, que solo corre en UPDATE OF estado).
--
-- Esa función no es SECURITY DEFINER, así que el UPDATE corre con los permisos de
-- quien ejecutó el UPDATE original sobre aplicaciones_tablon: el CLIENTE. Pero ninguna
-- política UPDATE de solicitudes permite que un cliente mueva PENDIENTE -> ACEPTADA:
--   - abogado_responde_solicitud permite esa transición, pero exige abogado_id = auth.uid()
--     (USING falla para el cliente).
--   - cliente_completa_solicitud sí matchea USING (cliente_id = auth.uid()), pero su
--     WITH CHECK solo permite ACEPTADA -> COMPLETADA o COMPLETADA -> RESEÑADA, no
--     PENDIENTE -> ACEPTADA (migración 019).
-- Resultado: el UPDATE entra en la política equivocada y su WITH CHECK lo rechaza.
--
-- FIX: marcar fn_crear_solicitud_desde_tablon() como SECURITY DEFINER (mismo patrón que
-- fn_revelar_contacto_al_aceptar en 006 y los triggers de notificaciones en 044) para que
-- el INSERT + UPDATE corran con los permisos del dueño de la función, no de auth.uid().
-- Es seguro: la autorización real ya ocurrió una capa antes, en la política
-- "cliente_elige_aplicacion_tablon" de aplicaciones_tablon (040), que ya garantiza que
-- solo el cliente dueño del caso pudo poner la aplicación en ELEGIDO y disparar este
-- trigger. Verificado en vivo (mismo método de reproducción) que con este cambio el
-- flujo completo de elegirAbogado() crea la solicitud y la deja en ACEPTADA sin error.

CREATE OR REPLACE FUNCTION fn_crear_solicitud_desde_tablon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caso casos_tablon%ROWTYPE;
  v_solicitud_id uuid;
BEGIN
  IF NEW.estado = 'ELEGIDO' AND OLD.estado IS DISTINCT FROM 'ELEGIDO' THEN
    SELECT * INTO v_caso FROM casos_tablon WHERE id = NEW.caso_id;

    BEGIN
      INSERT INTO solicitudes (cliente_id, abogado_id, descripcion_caso)
      VALUES (v_caso.cliente_id, NEW.abogado_id, v_caso.titulo || ': ' || v_caso.descripcion)
      RETURNING id INTO v_solicitud_id;

      UPDATE solicitudes SET estado = 'ACEPTADA' WHERE id = v_solicitud_id;

    EXCEPTION WHEN unique_violation THEN
      -- Ya existe una solicitud activa entre este cliente y este abogado
      -- (p.ej. enviada antes desde la búsqueda normal). El caso se marca
      -- ELEGIDO igual; no se duplica la solicitud.
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_crear_solicitud_desde_tablon() IS
  'SECURITY DEFINER (fix 047): el INSERT+UPDATE sobre solicitudes debe correr con los permisos del dueño de la función, no del cliente que disparó el trigger vía aplicaciones_tablon.cliente_elige_aplicacion_tablon — ninguna política UPDATE de solicitudes permite que un cliente mueva PENDIENTE -> ACEPTADA directamente (esa transición es del abogado). La autorización ya se validó una capa antes, en la política de aplicaciones_tablon.';
