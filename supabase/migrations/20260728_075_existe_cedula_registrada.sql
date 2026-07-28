-- RPC pública para validar una cédula antes del registro de abogado.
--
-- perfiles no tiene ningún GRANT hacia anon (ver CLAUDE.md §12: el rol sin
-- sesión solo recibe permisos sobre funciones de utilidad pre-login) — un
-- SELECT directo contra la tabla desde registro.js fallaría con "permission
-- denied" para un visitante sin cuenta todavía. Mismo patrón que
-- validar_codigo_referido() (migración 20260712_043): función pública,
-- SECURITY DEFINER, que solo expone un booleano, nada sensible de la fila.
--
-- Por qué esta validación proactiva: perfiles.cedula es UNIQUE, y
-- fn_crear_perfil_en_registro ya reintenta el INSERT sin cédula si hay un
-- duplicado (para no perder la cuenta completa) — pero eso deja la cédula en
-- NULL sin que el abogado se entere en el momento. Avisar antes de intentar
-- el signUp evita ese vacío de información (CLAUDE.md §44, módulo 8/Fix 3).

CREATE OR REPLACE FUNCTION public.existe_cedula_registrada(p_cedula text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM perfiles WHERE cedula = p_cedula);
$function$;

GRANT EXECUTE ON FUNCTION public.existe_cedula_registrada(text) TO anon, authenticated;
