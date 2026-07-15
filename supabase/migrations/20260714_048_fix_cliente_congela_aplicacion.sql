-- 20260714_048_fix_cliente_congela_aplicacion.sql
-- Gap detectado al verificar el fix 047: "cliente_elige_aplicacion_tablon" (migración 040)
-- solo valida que el caso pertenezca al cliente en su WITH CHECK — no restringe qué
-- columnas puede cambiar. El trigger fn_restringir_columnas_aplicaciones_tablon (046)
-- solo congela columnas cuando quien actualiza es el ABOGADO (auth.uid() = OLD.abogado_id);
-- del lado del cliente no había ninguna restricción equivalente.
--
-- Verificado en vivo (transacción con ROLLBACK): un cliente podía tomar la fila de
-- aplicaciones_tablon de un caso propio, reasignar abogado_id a un abogado que NUNCA
-- aplicó a ese caso (ni siquiera necesitaba estar verificado, el FK solo exige que el
-- id exista en abogados) y poner estado = 'ELEGIDO' en el mismo UPDATE — eso disparaba
-- fn_crear_solicitud_desde_tablon (047) y creaba una solicitud ACEPTADA hacia ese
-- abogado arbitrario, saltándose la regla de negocio "solo se elige entre quienes
-- aplicaron" (CLAUDE.md §17).
--
-- FIX: mismo patrón que el trigger de la 046, pero para el cliente. Como
-- aplicaciones_tablon no guarda cliente_id directamente, se resuelve vía el caso
-- relacionado (casos_tablon.cliente_id, usando OLD.caso_id — no requiere SECURITY
-- DEFINER porque el cliente siempre tiene SELECT sobre sus propios casos vía
-- "cliente_ve_propios_casos_tablon", sin restricción de estado). Se congelan
-- caso_id, abogado_id y mensaje; estado y en_seguimiento_cliente siguen editables
-- (son exactamente las columnas que el cliente legítimamente puede cambiar: elegir/
-- rechazar y marcar seguimiento).
--
-- Verificado en vivo: el ataque de reasignar abogado_id ahora lanza 42501; el flujo
-- legítimo de elegirAbogado() (sin tocar abogado_id/caso_id/mensaje) sigue funcionando
-- y sigue creando la solicitud ACEPTADA (fix 047); el toggle de en_seguimiento_cliente
-- y en_seguimiento_abogado (protegido por el trigger de la 046) siguen intactos.

CREATE OR REPLACE FUNCTION fn_restringir_columnas_cliente_aplicaciones_tablon()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid;
BEGIN
  SELECT cliente_id INTO v_cliente_id FROM casos_tablon WHERE id = OLD.caso_id;

  IF auth.uid() = v_cliente_id THEN
    IF NEW.caso_id    IS DISTINCT FROM OLD.caso_id
    OR NEW.abogado_id IS DISTINCT FROM OLD.abogado_id
    OR NEW.mensaje     IS DISTINCT FROM OLD.mensaje
    THEN
      RAISE EXCEPTION 'El cliente solo puede cambiar el estado y su propio seguimiento de una aplicación existente, sin reasignarla a otro caso ni cambiar el abogado o el mensaje.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_restringir_columnas_cliente_aplicaciones_tablon() IS
  'Congela caso_id/abogado_id/mensaje cuando quien actualiza aplicaciones_tablon es el cliente dueño del caso relacionado (fix 048). Complementa fn_restringir_columnas_aplicaciones_tablon (046), que hace lo mismo del lado del abogado. Sin esto, cliente_elige_aplicacion_tablon (040) permitía elegir a un abogado que nunca aplicó al caso.';

DROP TRIGGER IF EXISTS trg_restringir_columnas_cliente_aplicaciones_tablon ON aplicaciones_tablon;
CREATE TRIGGER trg_restringir_columnas_cliente_aplicaciones_tablon
  BEFORE UPDATE ON aplicaciones_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_restringir_columnas_cliente_aplicaciones_tablon();
