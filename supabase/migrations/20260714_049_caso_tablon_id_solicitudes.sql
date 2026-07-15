-- 20260714_049_caso_tablon_id_solicitudes.sql
-- Módulo 1 (separación de solicitudes directas vs. El Tablón en el frontend):
-- solicitudes no tenía ninguna columna que la vinculara de vuelta al caso de
-- El Tablón que la originó — fn_crear_solicitud_desde_tablon (047) solo copiaba
-- el título/descripción del caso dentro de descripcion_caso como texto libre.
-- Sin un vínculo real no hay forma de distinguir "solicitud directa" de
-- "solicitud del Tablón" en una query, que es justo lo que necesitan las nuevas
-- páginas solicitudes-directas.html / solicitudes-tablon.html.

ALTER TABLE solicitudes
  ADD COLUMN caso_tablon_id uuid REFERENCES casos_tablon(id);

COMMENT ON COLUMN solicitudes.caso_tablon_id IS
  'Caso de El Tablón que originó esta solicitud (trigger fn_crear_solicitud_desde_tablon). NULL para solicitudes enviadas directamente desde búsqueda/perfil-abogado.';

-- Redefine el trigger (mismo cuerpo que 047, SECURITY DEFINER) para completar
-- la nueva columna al crear la solicitud desde El Tablón.
CREATE OR REPLACE FUNCTION fn_crear_solicitud_desde_tablon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caso casos_tablon%ROWTYPE;
  v_solicitud_id uuid;
BEGIN
  IF NEW.estado = 'ELEGIDO' AND OLD.estado IS DISTINCT FROM 'ELEGIDO' THEN
    SELECT * INTO v_caso FROM casos_tablon WHERE id = NEW.caso_id;

    BEGIN
      INSERT INTO solicitudes (cliente_id, abogado_id, descripcion_caso, caso_tablon_id)
      VALUES (v_caso.cliente_id, NEW.abogado_id, v_caso.titulo || ': ' || v_caso.descripcion, v_caso.id)
      RETURNING id INTO v_solicitud_id;

      UPDATE solicitudes SET estado = 'ACEPTADA' WHERE id = v_solicitud_id;

    EXCEPTION WHEN unique_violation THEN
      -- Ya existe una solicitud activa entre este cliente y este abogado
      -- (p.ej. enviada antes desde la búsqueda normal). El caso se marca
      -- ELEGIDO igual; no se duplica la solicitud ni se le asigna caso_tablon_id
      -- retroactivamente (esa solicitud siguió siendo "directa" en su origen).
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_crear_solicitud_desde_tablon() IS
  'SECURITY DEFINER (fix 047): el INSERT+UPDATE sobre solicitudes debe correr con los permisos del dueño de la función, no del cliente que disparó el trigger vía aplicaciones_tablon.cliente_elige_aplicacion_tablon. Desde 049 también completa caso_tablon_id para que el frontend pueda distinguir el origen de la solicitud.';

-- Vistas del panel: exponer caso_tablon_id para filtrar por origen ('directa'
-- si es NULL, 'tablon' si no lo es — ver api.solicitudes.getSolicitudesAbogado/
-- getSolicitudesCliente en frontend/js/api.js). CREATE OR REPLACE VIEW exige
-- que las columnas existentes conserven nombre, orden y tipo (mismo criterio
-- que la migración 039); caso_tablon_id se agrega al final del SELECT. No
-- requiere volver a otorgar GRANT — ya lo tienen de la 011 (criterio 039/041).
CREATE OR REPLACE VIEW panel_solicitudes_abogado AS
SELECT
  s.id,
  s.estado,
  s.descripcion_caso,
  s.disponibilidad_horaria,
  s.motivo_rechazo,
  s.expires_at,
  s.aceptada_at,
  s.rechazada_at,
  s.completada_at,
  s.created_at,
  p.nombre_completo AS cliente_nombre,
  p.foto_url        AS cliente_foto,
  s.cliente_telefono,
  s.cliente_email,
  s.en_seguimiento_abogado,
  s.caso_tablon_id
FROM solicitudes s
JOIN perfiles p ON p.id = s.cliente_id
WHERE s.abogado_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_abogado IS 'Vista del panel del abogado. cliente_telefono y cliente_email son NULL hasta estado=ACEPTADA. caso_tablon_id distingue solicitudes directas (NULL) de las originadas en El Tablón. Cada abogado solo ve sus propias solicitudes.';

CREATE OR REPLACE VIEW panel_solicitudes_cliente AS
SELECT
  s.id,
  s.estado,
  s.descripcion_caso,
  s.disponibilidad_horaria,
  s.motivo_rechazo,
  s.expires_at,
  s.aceptada_at,
  s.created_at,
  p.nombre_completo AS abogado_nombre,
  p.foto_url        AS abogado_foto,
  p.ciudad          AS abogado_ciudad,
  a.especialidades  AS abogado_especialidades,
  a.rating_promedio AS abogado_rating,
  EXISTS (
    SELECT 1 FROM resenas r WHERE r.solicitud_id = s.id
  ) AS tiene_resena,
  s.abogado_id,
  s.en_seguimiento_cliente,
  s.caso_tablon_id
FROM solicitudes s
JOIN perfiles p ON p.id = s.abogado_id
JOIN abogados a ON a.id = s.abogado_id
WHERE s.cliente_id = auth.uid();

COMMENT ON VIEW panel_solicitudes_cliente IS 'Vista del panel del cliente. Muestra el estado de cada solicitud y datos públicos del abogado. caso_tablon_id distingue solicitudes directas (NULL) de las originadas en El Tablón.';
