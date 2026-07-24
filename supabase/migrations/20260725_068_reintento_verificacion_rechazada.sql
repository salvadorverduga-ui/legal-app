-- 20260725_068_reintento_verificacion_rechazada.sql
-- La política "abogado_actualiza_verificacion_pendiente" (20260725_061,
-- reescrita en 20260726_066) solo permite actualizar la fila mientras el
-- estado ANTERIOR ya es PENDIENTE — así que un abogado con verificacion
-- RECHAZADO no puede reenviar documentos: cualquier UPDATE sobre su propia
-- fila RECHAZADA es rechazado por RLS antes de llegar a esa política.
-- api.abogados.enviarDocumentosVerificacion() (frontend/js/api.js) necesita
-- poder mover esa fila de RECHAZADO otra vez a PENDIENTE al reintentar.
--
-- Política nueva y separada (no se toca la existente) porque las
-- condiciones de origen son distintas: acá el estado previo debe ser
-- RECHAZADO, no PENDIENTE. Postgres evalúa varias políticas PERMISSIVE de
-- UPDATE con OR — un mismo UPDATE puede satisfacer cualquiera de las dos.
CREATE POLICY "abogado_reintenta_verificacion_rechazada" ON verificaciones
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    AND (fn_verificacion_previa(id)).estado = 'RECHAZADO'
    -- Límite de 3 intentos también a nivel RLS (defensa en profundidad —
    -- api.js ya lo valida antes de subir ningún archivo, pero esto evita
    -- que alguien lo evite llamando a PostgREST directo).
    AND (fn_verificacion_previa(id)).intentos_verificacion < 3
    AND estado = 'PENDIENTE'
    -- La revisión anterior (motivo, revisor, fecha) ya no aplica a esta
    -- nueva subida — se limpia como parte del mismo reintento.
    AND revisado_por IS NULL
    AND revisado_at IS NULL
    AND motivo_rechazo IS NULL
  );

COMMENT ON POLICY "abogado_reintenta_verificacion_rechazada" ON verificaciones IS
  'Permite al abogado reenviar documentos tras un rechazo: mueve su propia fila de RECHAZADO a PENDIENTE (máx. 3 intentos) y limpia la revisión anterior. Ver abogado_actualiza_verificacion_pendiente para el caso PENDIENTE -> PENDIENTE (edición de documentos antes de la primera revisión).';

-- fn_propagar_estado_verificacion (trigger BEFORE UPDATE OF estado) pisaba
-- NEW.revisado_por/revisado_at con auth.uid()/now() en CUALQUIER cambio de
-- estado, sin importar quién lo hiciera. Eso rompe el reintento de arriba:
-- cuando el propio abogado mueve su fila de RECHAZADO a PENDIENTE, el
-- trigger corre ANTES que el WITH CHECK de la política (los triggers BEFORE
-- ROW modifican NEW antes de que RLS evalúe la fila resultante), así que
-- pisaba revisado_por con el uid del propio abogado — la política exige que
-- quede NULL, y el UPDATE fallaba con "new row violates row-level security
-- policy" (verificado en vivo). Semánticamente además era incorrecto:
-- revisado_por debe significar "qué admin lo revisó", no "quién tocó la
-- fila por última vez". Se acota a es_admin() — sin cambios en el resto de
-- la función (incluida la entrada en admin_log, que ya solo aplica a
-- VERIFICADO/RECHAZADO, transiciones que solo puede hacer un admin).
CREATE OR REPLACE FUNCTION fn_propagar_estado_verificacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.abogado_id IS NOT NULL THEN
      UPDATE abogados
      SET verificacion = NEW.estado
      WHERE id = NEW.abogado_id;
    END IF;

    IF NEW.estudio_id IS NOT NULL THEN
      UPDATE estudios
      SET verificacion = NEW.estado
      WHERE id = NEW.estudio_id;
    END IF;

    -- Registrar al revisor solo cuando es un admin quien revisa (auth.uid()
    -- puede ser NULL si lo hace un proceso interno). Un abogado reintentando
    -- su propia verificación rechazada (RECHAZADO -> PENDIENTE) no "revisa"
    -- nada — esos campos deben quedar como los dejó el UPDATE (NULL, ver
    -- abogado_reintenta_verificacion_rechazada arriba).
    IF es_admin() THEN
      NEW.revisado_por = auth.uid();
      NEW.revisado_at  = now();
    END IF;

    -- Log de auditoría: solo para aprobar/rechazar hechos por un admin con sesión
    -- (auth.uid() IS NULL en procesos internos, que no cuentan como acción de admin).
    IF auth.uid() IS NOT NULL AND NEW.estado IN ('VERIFICADO', 'RECHAZADO') THEN
      INSERT INTO admin_log (admin_id, accion, verificacion_id)
      VALUES (auth.uid(), CASE NEW.estado WHEN 'VERIFICADO' THEN 'APROBAR' ELSE 'RECHAZAR' END, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
