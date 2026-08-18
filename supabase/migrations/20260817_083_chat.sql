-- 20260817_083_chat.sql
-- Sistema de chat interno entre cliente y abogado, acotado a solicitudes
-- ACEPTADA/COMPLETADA (ya hubo match, los datos de contacto ya están
-- revelados vía fn_revelar_contacto_al_aceptar, migración 006). El chat es
-- un canal adicional dentro de la app, no reemplaza esos datos de contacto.

CREATE TABLE mensajes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id        uuid NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  emisor_id           uuid NOT NULL REFERENCES auth.users(id),
  contenido           text NOT NULL CHECK (char_length(contenido) BETWEEN 1 AND 2000),
  leido_por_receptor  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mensajes_solicitud ON mensajes (solicitud_id, created_at DESC);

COMMENT ON TABLE mensajes IS 'Chat interno entre cliente y abogado de una solicitud. Solo se puede escribir mientras la solicitud está ACEPTADA o COMPLETADA (ver política participantes_envian_mensaje). Mensajes permanentes: no hay política de DELETE.';
COMMENT ON COLUMN mensajes.leido_por_receptor IS 'Solo el receptor (el participante que no es emisor_id) puede pasarlo a true, y solo ese campo — ver política receptor_marca_leido.';

ALTER TABLE mensajes ENABLE ROW LEVEL SECURITY;

-- ─── Helper: ¿el usuario autenticado es cliente_id o abogado_id de la solicitud? ──
-- SECURITY DEFINER: evita que las políticas de mensajes que la usan disparen
-- una re-evaluación de las políticas de solicitudes -- mismo criterio que
-- fn_existe_bloqueo (migración 056) y fn_cliente_dueno_caso_tablon (058).
CREATE OR REPLACE FUNCTION fn_es_participante_solicitud(p_solicitud_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM solicitudes
    WHERE id = p_solicitud_id
      AND (cliente_id = auth.uid() OR abogado_id = auth.uid())
  );
$$;

COMMENT ON FUNCTION fn_es_participante_solicitud(uuid) IS
  'true si el usuario autenticado es cliente_id o abogado_id de la solicitud. Usada por las políticas de mensajes para evitar subconsultas autoreferenciadas contra solicitudes.';

REVOKE EXECUTE ON FUNCTION fn_es_participante_solicitud(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_es_participante_solicitud(uuid) TO authenticated;

-- ─── RLS ───────────────────────────────────────────────────────────────────

CREATE POLICY "participantes_ven_mensajes" ON mensajes
  FOR SELECT
  USING (fn_es_participante_solicitud(solicitud_id));

CREATE POLICY "admin_ve_mensajes" ON mensajes
  FOR SELECT USING (es_admin());

-- Solo se puede escribir mientras la solicitud sigue ACEPTADA/COMPLETADA. La
-- subconsulta contra solicitudes no es autoreferenciada (es otra tabla, y
-- solicitudes no depende de mensajes en ninguna de sus políticas), así que
-- no aplica el riesgo de recursión que sí motiva el helper de arriba; además
-- el emisor ya tiene SELECT propio sobre esa fila vía sus políticas normales
-- de solicitudes (cliente_ve_propias_solicitudes / abogado_ve_propias_solicitudes).
CREATE POLICY "participantes_envian_mensaje" ON mensajes
  FOR INSERT
  WITH CHECK (
    emisor_id = auth.uid()
    AND fn_es_participante_solicitud(solicitud_id)
    AND EXISTS (
      SELECT 1 FROM solicitudes
      WHERE id = solicitud_id AND estado IN ('ACEPTADA', 'COMPLETADA')
    )
  );

-- El receptor (participante distinto del emisor) solo puede pasar
-- leido_por_receptor de false a true, sin tocar ninguna otra columna --
-- mismo patrón "congelado" que usuario_marca_leida (notificaciones, 025).
CREATE POLICY "receptor_marca_leido" ON mensajes
  FOR UPDATE
  USING (
    fn_es_participante_solicitud(solicitud_id)
    AND emisor_id <> auth.uid()
  )
  WITH CHECK (
    fn_es_participante_solicitud(solicitud_id)
    AND emisor_id <> auth.uid()
    AND leido_por_receptor = true
    AND solicitud_id IS NOT DISTINCT FROM (SELECT solicitud_id FROM mensajes WHERE id = mensajes.id)
    AND emisor_id    IS NOT DISTINCT FROM (SELECT emisor_id    FROM mensajes WHERE id = mensajes.id)
    AND contenido    IS NOT DISTINCT FROM (SELECT contenido    FROM mensajes WHERE id = mensajes.id)
    AND created_at   IS NOT DISTINCT FROM (SELECT created_at   FROM mensajes WHERE id = mensajes.id)
  );

-- Sin política de DELETE para ningún rol (ni siquiera admin): mensajes permanentes.

GRANT SELECT, INSERT, UPDATE ON TABLE mensajes TO authenticated;

-- Habilita Realtime -- respeta el RLS de arriba, mismo criterio que
-- notificaciones (migración 025): cada cliente solo recibe eventos de
-- mensajes de solicitudes donde es participante.
ALTER PUBLICATION supabase_realtime ADD TABLE mensajes;

-- ─── Vista: mensajes + datos del emisor para renderizar el chat ─────────────
-- SECURITY DEFINER (como toda vista de este proyecto, ver CLAUDE.md §32):
-- bypassea el RLS de mensajes, así que el filtro de participante se repite
-- acá en el WHERE -- mismo criterio que busqueda_abogados con fn_existe_bloqueo.
CREATE OR REPLACE VIEW mensajes_con_perfil AS
SELECT
  m.id,
  m.solicitud_id,
  m.emisor_id,
  p.nombre_completo AS emisor_nombre,
  p.foto_url         AS emisor_foto,
  m.contenido,
  m.leido_por_receptor,
  m.created_at
FROM mensajes m
JOIN perfiles p ON p.id = m.emisor_id
WHERE fn_es_participante_solicitud(m.solicitud_id) OR es_admin();

COMMENT ON VIEW mensajes_con_perfil IS 'Mensajes con nombre/foto del emisor, para el componente de chat (frontend/js/chat.js). Filtra por participante o admin en el propio WHERE porque la vista es SECURITY DEFINER y no hereda el RLS de mensajes.';

GRANT SELECT ON mensajes_con_perfil TO authenticated;
