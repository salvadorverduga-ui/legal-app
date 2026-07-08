-- 20260707_023_cliente_cancela_solicitud.sql
-- Permite que el cliente cancele su propia solicitud mientras está PENDIENTE
-- (CLAUDE.md módulo 2). Sigue el mismo patrón WITH CHECK de la migración 019:
-- valida la transición exacta contra la fila actual, no solo la propiedad de la fila.
--
-- El índice parcial idx_solicitud_activa_unica (migración 006) ya excluye
-- CANCELADA, así que el cliente puede volver a solicitar al mismo abogado
-- después de cancelar.

CREATE POLICY "cliente_cancela_solicitud" ON solicitudes
  FOR UPDATE
  USING (cliente_id = auth.uid())
  WITH CHECK (
    cliente_id = auth.uid()
    AND (SELECT estado FROM solicitudes WHERE id = solicitudes.id) = 'PENDIENTE'
    AND estado = 'CANCELADA'
  );

COMMENT ON POLICY "cliente_cancela_solicitud" ON solicitudes IS
  'El cliente solo puede mover PENDIENTE -> CANCELADA en solicitudes propias.';
