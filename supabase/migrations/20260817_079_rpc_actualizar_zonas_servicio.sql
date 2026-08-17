-- 20260817_079_rpc_actualizar_zonas_servicio.sql
-- Fix (auditoría de seguridad Codex, HIGH 3): api.abogados.actualizarZonasServicio()
-- hacía un DELETE y luego un INSERT como dos llamadas separadas a PostgREST —
-- si la conexión se caía entre ambas, el abogado podía quedar sin ninguna zona
-- de servicio adicional (DELETE aplicado, INSERT nunca llegó). Esta función RPC
-- ejecuta las dos operaciones dentro de una única invocación, así que corren en
-- la misma transacción implícita del statement CALL — atómico por construcción,
-- sin necesitar BEGIN/COMMIT explícito.
--
-- SECURITY INVOKER (no DEFINER): las políticas RLS de abogado_zonas_servicio
-- (migración 20260707_028) ya permiten que un abogado autenticado inserte y
-- elimine sus propias filas — no hace falta bypasear RLS, así que se mantiene
-- como defensa en profundidad, mismo criterio que el resto de las funciones de
-- este proyecto que no necesitan privilegios elevados.
CREATE OR REPLACE FUNCTION actualizar_zonas_servicio_abogado(p_zonas jsonb)
RETURNS SETOF abogado_zonas_servicio
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  DELETE FROM abogado_zonas_servicio WHERE abogado_id = auth.uid();

  RETURN QUERY
  INSERT INTO abogado_zonas_servicio (abogado_id, provincia_id, canton_id)
  SELECT
    auth.uid(),
    (zona->>'provincia_id')::integer,
    (zona->>'canton_id')::integer
  FROM jsonb_array_elements(COALESCE(p_zonas, '[]'::jsonb)) AS zona
  RETURNING *;
END;
$$;

COMMENT ON FUNCTION actualizar_zonas_servicio_abogado(jsonb) IS 'Reemplaza atómicamente el conjunto de zonas de servicio adicionales del abogado autenticado (DELETE + INSERT en una sola transacción). p_zonas: [{"provincia_id": number, "canton_id": number|null}, ...].';

GRANT EXECUTE ON FUNCTION actualizar_zonas_servicio_abogado(jsonb) TO authenticated;
