-- Fija search_path = public en 6 funciones SECURITY INVOKER marcadas por el
-- advisor de seguridad como "Function Search Path Mutable". Mismo criterio que
-- las migraciones 20260713041003 (fix_recursion_definitiva_tablon_search_path)
-- y 20260718024028 (fix_search_path_limite_solicitudes_directas): sin
-- search_path fijo, una función puede resolver objetos contra un esquema
-- distinto al esperado si el search_path de la sesión que la invoca fue
-- alterado. No cambia lógica ni firma, solo agrega el SET.

ALTER FUNCTION public.fn_actualizar_updated_at() SET search_path = public;
ALTER FUNCTION public.fn_set_expires_at() SET search_path = public;
ALTER FUNCTION public.fn_set_expires_at_caso_tablon() SET search_path = public;
ALTER FUNCTION public.fn_verificar_limite_casos_tablon() SET search_path = public;
ALTER FUNCTION public.fn_verificar_limite_aplicaciones_tablon() SET search_path = public;
ALTER FUNCTION public.fn_generar_codigo_referido() SET search_path = public;
