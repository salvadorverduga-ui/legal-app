-- 20260707_031_perfil_cliente.sql
-- Feature: perfil del cliente con foto, teléfono y ubicación (panel-cliente.html,
-- pestaña "Mi perfil").
--
-- No se requieren cambios estructurales: perfiles.telefono, perfiles.ciudad,
-- perfiles.provincia y perfiles.foto_url ya existen desde la migración
-- 20260625_001_perfiles.sql, ya son nullable, y la política RLS
-- "perfil_propio_update" (misma migración) ya permite que cualquier usuario
-- autenticado — cliente incluido — actualice su propia fila. El GRANT
-- SELECT, UPDATE ON perfiles TO authenticated ya existe en
-- 20260625_011_grants.sql. Esta migración solo deja constancia de que estos
-- campos ahora también se editan desde el panel del cliente, no solo desde
-- el registro de abogados/estudios.

COMMENT ON COLUMN perfiles.telefono IS 'Dato sensible. El abogado lo recibe en solicitudes.cliente_telefono solo cuando el estado es ACEPTADA (leído en vivo por el trigger fn_revelar_contacto_al_aceptar). Editable por el propio usuario desde panel-abogado.html o panel-cliente.html.';
COMMENT ON COLUMN perfiles.ciudad IS 'Texto libre, opcional. Editable por el propio usuario desde su panel.';
COMMENT ON COLUMN perfiles.provincia IS 'Texto libre (nombre de una de las 24 provincias del Ecuador), opcional. Editable por el propio usuario desde su panel. No confundir con abogados.provincia_id, que es la FK usada para búsqueda por zona de servicio.';
