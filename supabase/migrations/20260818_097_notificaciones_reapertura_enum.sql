-- 20260818_097_notificaciones_reapertura_enum.sql
-- Parte 10: fn_solicitar_reapertura/fn_responder_reapertura (migración 092)
-- ya validan correctamente participante + status='closed' (solicitar) y
-- participante + "no puede responder su propia solicitud" (responder), pero
-- ninguna de las dos crea notificación al resolverse. Este primer paso
-- agrega los dos valores nuevos al enum tipo_notificacion -- no se pueden
-- usar en la misma transacción en que se agregan (restricción de Postgres
-- para ALTER TYPE ... ADD VALUE), así que fn_responder_reapertura se
-- actualiza recién en la siguiente migración (098), mismo patrón de dos
-- pasos que ya usaron las migraciones 069 y 084/085.

ALTER TYPE tipo_notificacion ADD VALUE 'reapertura_aprobada';
ALTER TYPE tipo_notificacion ADD VALUE 'reapertura_rechazada';
