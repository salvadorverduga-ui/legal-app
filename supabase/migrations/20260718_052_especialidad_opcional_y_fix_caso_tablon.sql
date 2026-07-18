-- 20260718_052_especialidad_opcional_y_fix_caso_tablon.sql
-- Dos cambios independientes a El Tablón, agrupados en una sola migración
-- porque ambos tocan casos_tablon/fn_crear_solicitud_desde_tablon.

-- ────────────────────────────────────────────────────────────
-- 1. Especialidad opcional al publicar un caso
-- ────────────────────────────────────────────────────────────
-- casos_tablon.especialidad era NOT NULL (migración 040). El formulario de
-- publicación (ahora tablon-publicar.html) deja de exigirla: el cliente no
-- siempre sabe a qué especialidad corresponde su caso. El CHECK de valores
-- permitidos ya admite NULL sin cambios (una expresión IN con NULL evalúa a
-- NULL, que un CHECK trata como válido) — basta con quitar el NOT NULL.
ALTER TABLE casos_tablon ALTER COLUMN especialidad DROP NOT NULL;

COMMENT ON COLUMN casos_tablon.especialidad IS
  'Opcional desde la 052: el cliente puede publicar sin seleccionar especialidad si no la conoce.';

-- ────────────────────────────────────────────────────────────
-- 2. Fix: solicitudes originadas en El Tablón no aparecían en
--    solicitudes-tablon.html (vista cliente)
-- ────────────────────────────────────────────────────────────
-- Causa raíz: idx_solicitud_activa_unica exige una única solicitud activa
-- (PENDIENTE/ACEPTADA) por par (cliente_id, abogado_id). Si el cliente ya
-- tenía una solicitud activa con ese abogado (de una consulta directa
-- anterior, o de otro caso del Tablón) cuando elige un aplicante nuevo, el
-- INSERT de fn_crear_solicitud_desde_tablon choca contra ese índice y cae en
-- la rama EXCEPTION, que (desde 047/049) no hacía nada más que tragarse el
-- error: la aplicación quedaba ELEGIDO pero ninguna fila de solicitudes
-- terminaba con ese caso_tablon_id, así que nunca aparecía en
-- solicitudes-tablon.html aunque el cliente sí hubiera elegido a alguien.
--
-- Fix: en ese mismo bloque EXCEPTION, vincular el caso recién elegido a la
-- solicitud activa existente entre ese cliente y abogado, siempre que esa
-- solicitud todavía no tenga caso_tablon_id (COALESCE — no se pisa el
-- vínculo de una elección anterior). Esto reemplaza la política previa
-- (documentada en CLAUDE.md §22) de dejar la solicitud "directa" en su
-- origen: ahora el cliente siempre puede encontrar el resultado de haber
-- elegido a alguien en El Tablón, sin duplicar la fila de solicitudes.
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
      INSERT INTO solicitudes (cliente_id, abogado_id, descripcion_caso, caso_tablon_id)
      VALUES (v_caso.cliente_id, NEW.abogado_id, v_caso.titulo || ': ' || v_caso.descripcion, v_caso.id)
      RETURNING id INTO v_solicitud_id;

      UPDATE solicitudes SET estado = 'ACEPTADA' WHERE id = v_solicitud_id;

    EXCEPTION WHEN unique_violation THEN
      -- Ya existe una solicitud activa entre este cliente y este abogado.
      -- No se duplica la solicitud; se vincula caso_tablon_id a este caso
      -- solo si la solicitud activa todavía no venía de otro caso del
      -- Tablón (COALESCE), para que igual aparezca en "Solicitudes del
      -- Tablón" del lado del cliente.
      UPDATE solicitudes
      SET caso_tablon_id = COALESCE(caso_tablon_id, v_caso.id)
      WHERE cliente_id = v_caso.cliente_id
        AND abogado_id = NEW.abogado_id
        AND estado IN ('PENDIENTE', 'ACEPTADA');
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_crear_solicitud_desde_tablon() IS
  'SECURITY DEFINER (fix 047). Completa caso_tablon_id al insertar (049). Desde 052, si ya existía una solicitud activa con ese abogado (unique_violation), vincula caso_tablon_id a esa solicitud existente en vez de descartar el vínculo — así el cliente siempre ve en solicitudes-tablon.html el resultado de haber elegido a alguien en El Tablón.';
