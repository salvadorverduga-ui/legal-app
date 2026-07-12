-- 20260707_033_editar_solicitud.sql
-- Feature: el cliente puede editar descripcion_caso y disponibilidad_horaria
-- de su propia solicitud mientras sigue en estado PENDIENTE (panel-cliente.html,
-- botón "Editar solicitud").
--
-- Sigue el mismo patrón WITH CHECK de las migraciones 019 y 023: valida la
-- transición/columnas contra la fila actual (subconsulta), no solo la
-- propiedad de la fila — de lo contrario, llamando directo a la REST API de
-- Supabase (sin pasar por frontend/js/api.js), el cliente podría reescribir
-- cualquier columna de su solicitud en cualquier estado, incluyendo
-- reasignarla a otro abogado o alterar los datos de contacto ya revelados.
--
-- Nota: el pedido original menciona la columna "disponibilidad"; la columna
-- real en la tabla solicitudes (migración 20260625_006_solicitudes.sql) es
-- disponibilidad_horaria — se usa ese nombre aquí.

CREATE POLICY "cliente_edita_solicitud_pendiente" ON solicitudes
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    -- Solo mientras la solicitud sigue PENDIENTE (antes y después del update)
    AND (SELECT estado FROM solicitudes WHERE id = solicitudes.id) = 'PENDIENTE'
    AND estado = 'PENDIENTE'
    -- No se permite reasignar la solicitud ni tocar datos de contacto o
    -- metadatos del ciclo de vida — únicamente descripcion_caso y
    -- disponibilidad_horaria quedan libres de restricción.
    AND abogado_id = (SELECT abogado_id FROM solicitudes WHERE id = solicitudes.id)
    AND cliente_telefono IS NOT DISTINCT FROM (SELECT cliente_telefono FROM solicitudes WHERE id = solicitudes.id)
    AND cliente_email    IS NOT DISTINCT FROM (SELECT cliente_email    FROM solicitudes WHERE id = solicitudes.id)
    AND motivo_rechazo   IS NOT DISTINCT FROM (SELECT motivo_rechazo   FROM solicitudes WHERE id = solicitudes.id)
    AND expires_at       =                    (SELECT expires_at       FROM solicitudes WHERE id = solicitudes.id)
    AND aceptada_at      IS NOT DISTINCT FROM (SELECT aceptada_at      FROM solicitudes WHERE id = solicitudes.id)
    AND rechazada_at     IS NOT DISTINCT FROM (SELECT rechazada_at     FROM solicitudes WHERE id = solicitudes.id)
    AND completada_at    IS NOT DISTINCT FROM (SELECT completada_at    FROM solicitudes WHERE id = solicitudes.id)
  );

COMMENT ON POLICY "cliente_edita_solicitud_pendiente" ON solicitudes IS
  'El cliente puede actualizar descripcion_caso y disponibilidad_horaria de su propia solicitud solo mientras está PENDIENTE. Ninguna otra columna ni transición de estado está permitida por esta política.';
