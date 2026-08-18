-- 20260817_082_rate_limiting_contacto.sql
-- Fix (auditoría de seguridad Codex, ronda 2, HIGH 1): el rate limiting de
-- api/contacto.js (auditoría ronda 1, HIGH 1) usaba un Map en memoria del
-- proceso Node — en Vercel cada invocación puede aterrizar en una instancia
-- serverless distinta (y una instancia fría no comparte memoria con ninguna
-- otra), así que el contador nunca acumulaba de forma confiable entre
-- requests reales. Esta migración mueve el contador a Supabase, el único
-- estado compartido entre invocaciones que ya tiene este proyecto.
--
-- Tabla rate_limits: sin política RLS de lectura/escritura directa para
-- ningún rol — el único punto de acceso es la función RPC de abajo
-- (SECURITY DEFINER, bypassea RLS), mismo patrón que fn_existe_bloqueo/
-- fn_cliente_dueno_caso_tablon (CLAUDE.md §33/§34): la tabla queda
-- completamente cerrada, la función expone solo la operación puntual que
-- necesita el llamador. PRIMARY KEY (ip, endpoint) mantiene una sola fila
-- por combinación — a diferencia de una tabla de log, no crece sin límite
-- con cada request, solo con la cantidad de IPs distintas que alguna vez
-- llamaron al endpoint.
CREATE TABLE rate_limits (
  ip           text NOT NULL,
  endpoint     text NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, endpoint)
);

COMMENT ON TABLE rate_limits IS 'Contador de rate limiting por IP y endpoint, usado por funciones serverless de Vercel (api/contacto.js) que no pueden mantener estado en memoria entre invocaciones. Sin acceso directo por RLS — solo se modifica vía fn_verificar_rate_limit.';

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- Sin políticas a propósito: ningún rol (ni anon ni authenticated) tiene
-- SELECT/INSERT/UPDATE directo. Con RLS habilitado y cero políticas, todo
-- acceso vía PostgREST queda denegado por defecto; el acceso real ocurre
-- solo dentro de fn_verificar_rate_limit (SECURITY DEFINER), que sí puede
-- leer/escribir porque corre con los privilegios de su dueño.

-- fn_verificar_rate_limit: hace el "leer contador, ¿reseteo de ventana?,
-- incrementar" en una sola sentencia SQL (INSERT ... ON CONFLICT DO UPDATE),
-- no en dos llamadas separadas (SELECT + UPDATE) — dos llamadas HTTP
-- distintas desde api/contacto.js reintroducirían exactamente el mismo tipo
-- de condición de carrera que ya se corrigió para actualizar_zonas_servicio_
-- abogado (migración 079): dos requests concurrentes desde la misma IP
-- podrían leer el mismo count antes de que ninguna lo actualice, y ambas
-- pasarían el límite. INSERT ... ON CONFLICT toma el lock de la fila a nivel
-- de Postgres, así que los requests concurrentes se serializan correctamente.
CREATE OR REPLACE FUNCTION fn_verificar_rate_limit(
  p_ip text,
  p_endpoint text,
  p_limite integer,
  p_ventana interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO rate_limits (ip, endpoint, count, window_start)
  VALUES (p_ip, p_endpoint, 1, now())
  ON CONFLICT (ip, endpoint) DO UPDATE SET
    count = CASE
      WHEN rate_limits.window_start <= now() - p_ventana THEN 1
      ELSE rate_limits.count + 1
    END,
    window_start = CASE
      WHEN rate_limits.window_start <= now() - p_ventana THEN now()
      ELSE rate_limits.window_start
    END
  RETURNING count INTO v_count;

  RETURN v_count <= p_limite;
END;
$$;

COMMENT ON FUNCTION fn_verificar_rate_limit(text, text, integer, interval) IS 'Incrementa atómicamente el contador de rate_limits para (ip, endpoint), reseteando la ventana si ya expiró. Retorna true si el request está dentro del límite, false si debe rechazarse con 429. Usado por api/contacto.js vía PostgREST RPC con la anon key.';

-- anon: api/contacto.js llama a esta función sin sesión de usuario (es un
-- endpoint público de soporte, sin login), usando SUPABASE_ANON_KEY — misma
-- key que ya usa api/config.js para el frontend, no hace falta ninguna
-- variable de entorno nueva en Vercel.
REVOKE EXECUTE ON FUNCTION fn_verificar_rate_limit(text, text, integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_verificar_rate_limit(text, text, integer, interval) TO anon;
