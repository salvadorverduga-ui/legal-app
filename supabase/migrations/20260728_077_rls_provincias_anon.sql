-- Fix: el dropdown de provincia en busqueda.html (página pública, sin sesión
-- — ver comentario en busqueda.js) solo mostraba "Todas las provincias".
--
-- Diagnóstico: busqueda.js/poblarSelectProvincias() y api.geo.getProvincias()
-- estaban correctos — el problema era de RLS (capa 2, CLAUDE.md §12): la
-- tabla provincias tenía GRANT SELECT para anon (capa 1) pero la política
-- lectura_provincias solo autorizaba al rol authenticated. Para un visitante
-- sin sesión, PostgREST devuelve 0 filas (no "permission denied", porque el
-- GRANT sí existe) — confirmado con SET LOCAL ROLE anon; SELECT count(*)
-- FROM provincias devuelve 0.
--
-- provincias es un catálogo geográfico sin ningún dato sensible (24
-- provincias de Ecuador), y busqueda.html necesita poblarlo sin sesión —
-- caso legítimo de acceso anon según CLAUDE.md §12. cantones no se toca: sus
-- únicos consumidores (editar-perfil-abogado.js) ya requieren sesión.

ALTER POLICY lectura_provincias ON provincias TO anon, authenticated;
