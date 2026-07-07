-- 20260707_020_expiracion_automatica_solicitudes.sql
-- Expira automáticamente las solicitudes en PENDIENTE que superaron las 48h
-- (CLAUDE.md §6, PRD §3.2) usando pg_cron: corre cada 15 minutos y
-- transiciona PENDIENTE -> EXPIRADA cuando now() > expires_at.
--
-- Por qué pg_cron y no un endpoint programado externo (Vercel cron /
-- cron-job.org llamando una Edge Function): la transición es una sola
-- sentencia UPDATE sin dependencias externas (no envía email ni llama APIs
-- de terceros — ver 20260707_ notificar-solicitud en §13, que deliberadamente
-- no cubre EXPIRADA porque el PRD lo deja para V2). Mantenerla en la base de
-- datos evita un punto de fallo adicional (servicio externo caído, endpoint
-- sin autenticar) para una operación puramente de datos.
--
-- SECURITY DEFINER: la función corre con los privilegios de su dueño
-- (postgres), que no está sujeto a RLS. pg_cron en Supabase ejecuta los
-- jobs con el rol que los programó (normalmente postgres al correr esta
-- migración desde el SQL Editor), así que ya bypassea RLS de todas formas;
-- SECURITY DEFINER lo deja explícito y a prueba de que el job se reprograme
-- con otro rol en el futuro.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION fn_expirar_solicitudes_pendientes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE solicitudes
  SET estado = 'EXPIRADA'
  WHERE estado = 'PENDIENTE'
    AND expires_at < now();
$$;

COMMENT ON FUNCTION fn_expirar_solicitudes_pendientes() IS
  'Transiciona PENDIENTE -> EXPIRADA cuando expires_at < now(). Programada vía pg_cron cada 15 minutos (job "expirar-solicitudes-pendientes"). Sin GRANT a authenticated/anon: solo la invoca el scheduler interno de pg_cron, nunca un usuario vía PostgREST.';

-- Elimina el job si ya existía, para que esta migración se pueda re-aplicar
-- sin duplicar el cron (pg_cron no tiene "CREATE OR REPLACE" para jobs).
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'expirar-solicitudes-pendientes';

SELECT cron.schedule(
  'expirar-solicitudes-pendientes',
  '*/15 * * * *',
  $$SELECT fn_expirar_solicitudes_pendientes();$$
);
