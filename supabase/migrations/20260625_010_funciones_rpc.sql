-- 20260625_010_funciones_rpc.sql
-- Funciones RPC disponibles para el cliente Supabase y para uso interno en políticas RLS.
--
-- Por qué funciones en lugar de queries inline:
--   1. La lógica de visibilidad y la fecha del servidor viven en un solo lugar.
--      Si cambian las reglas (ej: el período de gracia pasa de 4 a 7 días),
--      se actualiza la función sin tocar todas las políticas que la llaman.
--   2. SECURITY DEFINER garantiza que la función se ejecuta con los permisos del dueño
--      (postgres), evitando recursión infinita cuando se llama desde una política RLS
--      sobre la misma tabla que consulta.
--   3. El cliente puede llamar estas funciones vía supabase.rpc() para lógica
--      que requiere un resultado de la BD, sin construir queries manuales.

-- ────────────────────────────────────────────────
-- get_server_date()
-- ────────────────────────────────────────────────
-- Retorna la fecha actual del servidor (UTC).
-- El cliente nunca debe usar new Date() o Date.now() para comparar
-- contra fechas de suscripción o expiración de solicitudes:
-- el reloj del dispositivo puede estar manipulado o desfasado.
-- Ejemplo de uso desde el frontend:
--   const { data } = await supabase.rpc('get_server_date');
--   // data = "2026-06-25"
CREATE OR REPLACE FUNCTION get_server_date()
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER        -- no necesita elevar privilegios; CURRENT_DATE es siempre pública
SET search_path = public
AS $$
  SELECT CURRENT_DATE;
$$;

-- Permisos: accesible para usuarios autenticados y anónimos
-- (la landing puede necesitar la fecha sin sesión activa)
GRANT EXECUTE ON FUNCTION get_server_date() TO anon, authenticated;

COMMENT ON FUNCTION get_server_date() IS
  'Retorna CURRENT_DATE del servidor. Usar siempre en lugar de la fecha del cliente para comparar suscripciones y expiración de solicitudes.';

-- ────────────────────────────────────────────────
-- abogado_es_visible(p_abogado_id uuid)
-- ────────────────────────────────────────────────
-- Verifica simultáneamente las tres condiciones de visibilidad de un perfil de abogado
-- definidas en CLAUDE.md sección 4.1 y PRD sección 6.3:
--
--   1. verificacion = 'VERIFICADO'
--   2. toggle_disponible = true
--   3. suscripcion_vigente_hasta >= CURRENT_DATE
--        O suscripcion_vigente_hasta >= CURRENT_DATE - 4 días  (período de gracia)
--
-- Uso interno: llamada desde políticas RLS de otras tablas para verificar
-- si el abogado al que se referencia sigue siendo visible antes de exponer datos.
--
-- Uso desde el cliente:
--   const { data } = await supabase.rpc('abogado_es_visible', { p_abogado_id: '...' });
--   // data = true | false
--
-- SECURITY DEFINER: necesario porque esta función consulta la tabla abogados,
-- que tiene RLS habilitado. Si se llamara con SECURITY INVOKER desde dentro de
-- una política RLS sobre abogados, entraría en recursión infinita.
-- SET search_path previene que un atacante redefina el schema y cambie el resultado.
CREATE OR REPLACE FUNCTION abogado_es_visible(p_abogado_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   abogados a
    WHERE  a.id = p_abogado_id
      AND  a.verificacion = 'VERIFICADO'
      AND  a.toggle_disponible = true
      AND  a.suscripcion_vigente_hasta IS NOT NULL
      AND  (
             a.suscripcion_vigente_hasta >= CURRENT_DATE
          OR a.suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
           )
  );
$$;

-- Permisos: solo usuarios autenticados (un cliente anónimo no debería llamar esto)
GRANT EXECUTE ON FUNCTION abogado_es_visible(uuid) TO authenticated;

COMMENT ON FUNCTION abogado_es_visible(uuid) IS
  'Verifica las 3 condiciones de visibilidad de un abogado (CLAUDE.md §4.1). SECURITY DEFINER para evitar recursión en políticas RLS. Usar en lugar de repetir las condiciones inline.';

-- ────────────────────────────────────────────────
-- Nota para futuras migraciones
-- ────────────────────────────────────────────────
-- Las políticas RLS en 001–009 tienen las condiciones de visibilidad inline.
-- A partir de esta migración, cualquier política nueva que necesite verificar
-- visibilidad de un abogado debe llamar abogado_es_visible() en lugar de
-- repetir las condiciones, para mantener una única fuente de verdad.
--
-- Ejemplo:
--   CREATE POLICY "..." ON alguna_tabla FOR SELECT
--   USING (abogado_es_visible(abogado_id));
--
-- Advertencia de performance: llamar una función dentro de una política RLS
-- puede impedir que el planner use índices en ciertos casos. Si en producción
-- se detecta degradación en búsquedas, evaluar si conviene mantener las
-- condiciones inline en la política busqueda_publica_abogados (004) y reservar
-- esta función para validaciones puntuales (ej: antes de enviar una solicitud).
