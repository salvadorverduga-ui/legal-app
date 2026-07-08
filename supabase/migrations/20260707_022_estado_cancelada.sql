-- 20260707_022_estado_cancelada.sql
-- Agrega el estado CANCELADA al enum estado_solicitud (CLAUDE.md módulo 2:
-- el cliente puede cancelar una solicitud propia mientras está PENDIENTE).
--
-- En un archivo separado de la política que lo usa (023_cliente_cancela_solicitud.sql)
-- porque PostgreSQL no permite usar un valor de enum recién agregado con
-- ALTER TYPE ... ADD VALUE dentro de la misma transacción en la que se agrega.

ALTER TYPE estado_solicitud ADD VALUE 'CANCELADA';
