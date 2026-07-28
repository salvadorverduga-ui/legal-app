-- Fix: "duplicate key value violates unique constraint idx_solicitud_activa_unica_tablon"
-- al elegir un abogado en El Tablón.
--
-- Diagnóstico (verificado en un entorno aislado con tablas temporales, sin
-- tocar datos de producción): idx_solicitud_activa_unica_tablon YA excluye
-- los estados terminales — su condición `estado = ANY ('PENDIENTE','ACEPTADA')
-- AND caso_tablon_id IS NOT NULL` es exactamente equivalente a "caso_tablon_id
-- IS NOT NULL AND estado NOT IN (COMPLETADA, RESEÑADA, CANCELADA, EXPIRADA,
-- RECHAZADA)" (son los 7 valores del enum, sin solapamiento). El índice no es
-- la causa del error.
--
-- La causa real está en la rama EXCEPTION de fn_crear_solicitud_desde_tablon
-- (agregada en la migración 052, ver CLAUDE.md §25). Desde la migración 053
-- (§29), una solicitud DIRECTA y una del TABLON activas pueden coexistir
-- entre el mismo cliente y abogado (índices separados). Si ese cliente ya
-- tenía AMBAS activas con ese abogado y elegía un nuevo caso del Tablón con
-- él, el INSERT fallaba (ya había una solicitud del Tablón activa → dispara
-- la rama EXCEPTION), y esa rama actualizaba TODAS las solicitudes activas
-- del par cliente-abogado sin distinguir origen — incluida la directa, que
-- pasaba de caso_tablon_id NULL a no-NULL. Esa misma UPDATE, al volver
-- "tablon" a la fila directa, chocaba contra la fila del Tablón que ya
-- existía para ese mismo par (ambas activas, ambas con caso_tablon_id no
-- nulo) — un segundo unique_violation, esta vez sin ningún EXCEPTION que lo
-- capture, que se propagaba tal cual al frontend.
--
-- Fix: agregar `AND caso_tablon_id IS NOT NULL` al WHERE de esa UPDATE, para
-- que la rama EXCEPTION solo pueda tocar la solicitud del Tablón que
-- realmente causó el conflicto — nunca una solicitud directa coexistente.
-- Reproducido y verificado el fix en una tabla temporal con el mismo índice
-- parcial antes de aplicar este cambio en la función real.

CREATE OR REPLACE FUNCTION public.fn_crear_solicitud_desde_tablon()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caso casos_tablon%ROWTYPE;
  v_solicitud_id uuid;
BEGIN
  IF NEW.estado = 'ELEGIDO' AND OLD.estado IS DISTINCT FROM 'ELEGIDO' THEN
    SELECT * INTO v_caso FROM casos_tablon WHERE id = NEW.caso_id;

    BEGIN
      INSERT INTO solicitudes (cliente_id, abogado_id, descripcion_caso, caso_tablon_id)
      VALUES (v_caso.cliente_id, NEW.abogado_id, v_caso.titulo || ': ' || v_caso.descripcion, v_caso.id)
      RETURNING id INTO v_solicitud_id;

      UPDATE solicitudes SET estado = 'ACEPTADA' WHERE id = v_solicitud_id;

    EXCEPTION WHEN unique_violation THEN
      UPDATE solicitudes
      SET caso_tablon_id = COALESCE(caso_tablon_id, v_caso.id)
      WHERE cliente_id = v_caso.cliente_id
        AND abogado_id = NEW.abogado_id
        AND estado IN ('PENDIENTE', 'ACEPTADA')
        AND caso_tablon_id IS NOT NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
