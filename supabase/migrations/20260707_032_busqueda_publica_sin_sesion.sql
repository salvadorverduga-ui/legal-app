-- 20260707_032_busqueda_publica_sin_sesion.sql
-- Feature: navegación sin cuenta — busqueda.html y perfil-abogado.html ahora
-- son accesibles sin sesión activa (CLAUDE.md pendiente: permitir explorar
-- la plataforma antes de registrarse).
--
-- La migración 20260625_011_grants.sql documentaba explícitamente
-- "anon: NO accede a ninguna vista. La búsqueda requiere sesión." — esa
-- decisión cambia aquí. Es seguro otorgar SELECT a anon porque:
--   1. Estas vistas ya corren con los permisos de su dueño (postgres) y
--      tienen su propio WHERE clause de seguridad (ver comentario en
--      20260625_011_grants.sql, sección VISTAS) — no dependen de las
--      políticas RLS de las tablas subyacentes para filtrar filas.
--   2. Ninguna de las dos expone teléfono, email ni cédula (ver comentarios
--      de creación de cada vista). Los datos de contacto del cliente viven
--      únicamente en solicitudes.cliente_telefono/cliente_email, cuyas
--      vistas (panel_solicitudes_abogado/cliente) NO reciben GRANT a anon.
--   3. provincias y cantones son catálogos de referencia fijos, sin datos
--      de usuarios.

GRANT SELECT ON busqueda_abogados TO anon;
GRANT SELECT ON resenas_publicas  TO anon;
GRANT SELECT ON TABLE provincias  TO anon;
GRANT SELECT ON TABLE cantones    TO anon;

COMMENT ON VIEW busqueda_abogados IS 'Vista de búsqueda pública de abogados. Filtra por verificacion=VERIFICADO AND toggle_disponible=true AND suscripción vigente/gracia. No expone teléfono ni email. Accesible sin sesión (anon) y con sesión (authenticated).';
COMMENT ON VIEW resenas_publicas IS 'Reseñas visibles (oculta=false) con el nombre del cliente autor, para mostrar iniciales en el perfil público del abogado. No expone teléfono, email ni cédula. Accesible sin sesión (anon) y con sesión (authenticated).';
