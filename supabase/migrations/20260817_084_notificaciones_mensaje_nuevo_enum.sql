-- 20260817_084_notificaciones_mensaje_nuevo_enum.sql
-- Nuevo tipo de notificación para el chat interno (migración 083): mensaje
-- sin leer. ALTER TYPE ... ADD VALUE no puede usarse en la misma transacción
-- en la que se referencia el valor nuevo (restricción de Postgres) -- mismo
-- motivo por el que 'verificacion_suspendida' (migración 20260725_069) se
-- aplicó en dos pasos separados. Este es el primer paso; el trigger que usa
-- 'mensaje_nuevo' va en la migración siguiente.

ALTER TYPE tipo_notificacion ADD VALUE 'mensaje_nuevo';
