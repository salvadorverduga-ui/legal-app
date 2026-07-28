-- Fix: el email del cliente aparece como "No registrado" en "Datos de
-- contacto" (tablon-caso.html) para un abogado ELEGIDO, aunque el cliente sí
-- tiene email (obligatorio en Supabase Auth).
--
-- Diagnóstico (verificado vía MCP contra datos reales, sin tocar producción
-- salvo por esta migración):
--
-- 1. auth.users.email para el cliente reportado SÍ existe y es correcto.
-- 2. tablon-caso.js lee casoActual.cliente_email, que sale de
--    api.tablon.getCasoDetalle() → vista tablon_caso_detalle.
-- 3. fn_revelar_contacto_al_aceptar() (el trigger que revela contacto al
--    aceptar una solicitud) YA joinea correctamente auth.users para el
--    email — nunca leyó perfiles.email. Esa hipótesis original no era la
--    causa: se confirmó con las 3 solicitudes reales que tienen
--    caso_tablon_id, las 3 tienen cliente_email = auth.users.email exacto.
--
-- La causa real: tablon_caso_detalle.cliente_email/cliente_telefono salen de
-- una subquery contra `solicitudes WHERE caso_tablon_id = <este caso> AND
-- abogado_id = auth.uid()`. Pero fn_crear_solicitud_desde_tablon() (§17/§25,
-- migración 052/074) solo puede mantener UNA solicitud activa del Tablón por
-- par cliente-abogado (índice idx_solicitud_activa_unica_tablon) — si el
-- mismo cliente elige al mismo abogado desde un caso NUEVO mientras ya tenía
-- una solicitud activa del Tablón con él, la rama EXCEPTION solo re-vincula
-- (COALESCE) la solicitud ya existente, que sigue apuntando al PRIMER caso.
-- El caso nuevo queda con la aplicación en ELEGIDO pero SIN ninguna fila de
-- solicitudes para ese caso_tablon_id puntual — de ahí que la subquery no
-- tenga de dónde sacar el email, no porque el dato no exista.
--
-- Confirmado con datos reales: 9 aplicaciones_tablon en estado ELEGIDO entre
-- el mismo par cliente-abogado, pero solo 3 tienen una fila de solicitudes
-- vinculada a su caso_tablon_id — las otras 6 quedaban mostrando "No
-- registrado" pese a que el cliente sí tiene email y teléfono.
--
-- Fix: fn_contacto_cliente_caso_tablon(p_caso_id) resuelve el contacto
-- directamente desde perfiles/auth.users a partir de casos_tablon.cliente_id,
-- autorizada por la condición real de negocio ("¿el abogado que consulta fue
-- ELEGIDO para ESTE caso puntual?", vía aplicaciones_tablon) en vez de
-- depender de que exista una fila de solicitudes para ese caso específico.

CREATE OR REPLACE FUNCTION public.fn_contacto_cliente_caso_tablon(p_caso_id uuid)
 RETURNS TABLE(email text, telefono text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente_id uuid;
BEGIN
  -- Solo el abogado ELEGIDO para este caso puntual recibe los datos de
  -- contacto — misma condición que ya evaluaba tablon_caso_detalle antes de
  -- este fix, solo que ahora se verifica directamente contra
  -- aplicaciones_tablon en vez de inferirla de la existencia de una fila de
  -- solicitudes.
  IF NOT EXISTS (
    SELECT 1 FROM aplicaciones_tablon
    WHERE caso_id = p_caso_id AND abogado_id = auth.uid() AND estado = 'ELEGIDO'
  ) THEN
    RETURN;
  END IF;

  SELECT ct.cliente_id INTO v_cliente_id FROM casos_tablon ct WHERE ct.id = p_caso_id;

  RETURN QUERY
  -- auth.users.email es character varying(255): cast explícito a text para
  -- que coincida con el tipo declarado en RETURNS TABLE (detectado recién al
  -- probar la función — sin el cast, Postgres rechaza el RETURN QUERY con
  -- "structure of query does not match function result type").
  SELECT u.email::text, p.telefono
  FROM perfiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = v_cliente_id;
END;
$function$;

-- Postgres otorga EXECUTE a PUBLIC por defecto al crear una función (a
-- diferencia de las tablas, que no tienen grants implícitos) — el advisor de
-- seguridad marca esto como "anon puede ejecutarla". No hay fuga real
-- (auth.uid() es NULL para anon, así que el IF NOT EXISTS de arriba nunca
-- matchea y la función no devuelve filas), pero se revoca explícitamente por
-- principio de mínimo privilegio (CLAUDE.md §12).
REVOKE EXECUTE ON FUNCTION public.fn_contacto_cliente_caso_tablon(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_contacto_cliente_caso_tablon(uuid) TO authenticated;

CREATE OR REPLACE VIEW tablon_caso_detalle AS
SELECT
  c.id,
  c.cliente_id,
  c.titulo,
  c.descripcion,
  c.especialidad,
  c.caso_comun,
  c.provincia,
  c.ciudad,
  c.anonimo,
  c.estado,
  c.created_at,
  c.expires_at,
  CASE
    WHEN c.cliente_id = auth.uid() THEN p.nombre_completo
    WHEN c.anonimo AND NOT EXISTS (
      SELECT 1 FROM aplicaciones_tablon ap
      WHERE ap.caso_id = c.id AND ap.abogado_id = auth.uid() AND ap.estado = 'ELEGIDO'
    ) THEN 'Cliente anónimo'
    ELSE p.nombre_completo
  END AS cliente_nombre,
  (SELECT count(*) FROM aplicaciones_tablon ap2 WHERE ap2.caso_id = c.id) AS total_aplicaciones,
  (SELECT ap3.estado FROM aplicaciones_tablon ap3 WHERE ap3.caso_id = c.id AND ap3.abogado_id = auth.uid()) AS mi_aplicacion_estado,
  (SELECT ap4.en_seguimiento_abogado FROM aplicaciones_tablon ap4 WHERE ap4.caso_id = c.id AND ap4.abogado_id = auth.uid()) AS mi_seguimiento,
  (SELECT ap5.id FROM aplicaciones_tablon ap5 WHERE ap5.caso_id = c.id AND ap5.abogado_id = auth.uid()) AS mi_aplicacion_id,
  contacto.telefono AS cliente_telefono,
  contacto.email AS cliente_email,
  c.visualizaciones
FROM casos_tablon c
JOIN perfiles p ON p.id = c.cliente_id
LEFT JOIN LATERAL fn_contacto_cliente_caso_tablon(c.id) contacto ON true
WHERE c.cliente_id = auth.uid()
   OR (c.estado = 'ACTIVO' AND EXISTS (
        SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO'
      ))
   OR EXISTS (
        SELECT 1 FROM aplicaciones_tablon ap6 WHERE ap6.caso_id = c.id AND ap6.abogado_id = auth.uid()
      );

GRANT SELECT ON tablon_caso_detalle TO authenticated;
