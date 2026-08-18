-- 20260817_081_revoke_public_rpcs.sql
-- Fix (auditoría de seguridad Codex, ronda 2, LOW 1): PostgreSQL otorga EXECUTE
-- a PUBLIC por defecto sobre toda función nueva, a diferencia de las tablas
-- (donde el default es sin acceso). Los GRANT explícitos que agregaron las
-- migraciones 079 y 080 nunca revocaron ese privilegio heredado — en la
-- práctica no cambiaba el comportamiento hoy (PUBLIC ya incluye a anon y
-- authenticated en este proyecto), pero deja la puerta abierta a que un rol
-- futuro sin GRANT explícito pueda ejecutar estas funciones igual, además de
-- no reflejar la intención real (acceso solo a los roles documentados en cada
-- migración). REVOKE FROM PUBLIC primero, GRANT explícito después: mismo
-- patrón recomendado por la documentación de PostgreSQL para funciones
-- expuestas selectivamente.

REVOKE EXECUTE ON FUNCTION actualizar_zonas_servicio_abogado(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actualizar_zonas_servicio_abogado(jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION buscar_abogados_por_provincia(integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buscar_abogados_por_provincia(integer, text, text, text, text) TO anon, authenticated;
