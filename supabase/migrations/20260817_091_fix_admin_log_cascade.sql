-- 20260817_091_fix_admin_log_cascade.sql
-- Fix LOW 1 de la auditoría de Codex: admin_log.solicitud_id (migración 086)
-- usa ON DELETE CASCADE -- si alguna vez se borrara una solicitud, se
-- borrarían con ella las entradas de auditoría "un admin abrió este chat",
-- justo el tipo de evidencia que un log de auditoría no debería poder
-- perder por una acción sobre la tabla referenciada. Las solicitudes no se
-- borran hoy en la práctica (siempre se transicionan de estado), pero la FK
-- debería reflejar la intención real igual.
--
-- Fix: ON DELETE SET NULL en vez de CASCADE. admin_log_referencia_unica_check
-- (086) exigía solicitud_id IS NOT NULL para accion='VER_CHAT' -- se relaja
-- para permitir NULL ahí también, porque si no, el propio SET NULL de la FK
-- dejaría esa fila violando el CHECK en el momento de la baja. Con el fix,
-- una fila VER_CHAT con solicitud_id NULL sigue siendo evidencia válida de
-- "el admin X vio un chat el día Y", aunque ya no se sepa cuál solicitud
-- puntual era.

ALTER TABLE admin_log DROP CONSTRAINT admin_log_solicitud_id_fkey;
ALTER TABLE admin_log ADD CONSTRAINT admin_log_solicitud_id_fkey
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE SET NULL;

ALTER TABLE admin_log DROP CONSTRAINT admin_log_referencia_unica_check;
ALTER TABLE admin_log ADD CONSTRAINT admin_log_referencia_unica_check
  CHECK (
    (accion IN ('APROBAR', 'RECHAZAR') AND verificacion_id IS NOT NULL AND solicitud_id IS NULL)
    OR (accion = 'VER_CHAT' AND verificacion_id IS NULL)
  );

COMMENT ON COLUMN admin_log.solicitud_id IS 'Se completa cuando accion = VER_CHAT (RPC admin_ver_mensajes_chat, migración 088). ON DELETE SET NULL (fix 091, antes CASCADE): si la solicitud referenciada se borrara, la evidencia de auditoría se conserva con solicitud_id en NULL en vez de desaparecer.';
