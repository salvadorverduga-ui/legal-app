-- 20260722_056_bloqueos.sql
-- CLAUDE.md módulo 8: sistema de bloqueos entre cliente y abogado.

CREATE TABLE bloqueos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloqueador_id  uuid NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  bloqueado_id   uuid NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bloqueador_id, bloqueado_id),
  CHECK (bloqueador_id <> bloqueado_id)
);

CREATE INDEX idx_bloqueos_bloqueador ON bloqueos (bloqueador_id);
CREATE INDEX idx_bloqueos_bloqueado  ON bloqueos (bloqueado_id);

COMMENT ON TABLE bloqueos IS 'Bloqueos entre cliente y abogado. UNIQUE(bloqueador_id, bloqueado_id) evita duplicados. Al insertar, fn_cancelar_solicitudes_al_bloquear cancela las solicitudes activas entre ambos.';

ALTER TABLE bloqueos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario_ve_propios_bloqueos" ON bloqueos
  FOR SELECT
  USING (bloqueador_id = auth.uid());

CREATE POLICY "admin_ve_bloqueos" ON bloqueos
  FOR SELECT USING (es_admin());

CREATE POLICY "usuario_crea_bloqueo" ON bloqueos
  FOR INSERT
  WITH CHECK (bloqueador_id = auth.uid());

CREATE POLICY "usuario_elimina_propio_bloqueo" ON bloqueos
  FOR DELETE
  USING (bloqueador_id = auth.uid());

CREATE POLICY "admin_elimina_bloqueo" ON bloqueos
  FOR DELETE USING (es_admin());

GRANT SELECT, INSERT, DELETE ON TABLE bloqueos TO authenticated;

-- ─── Helper: ¿existe un bloqueo (en cualquier dirección) entre dos usuarios? ──
-- SECURITY DEFINER: evita que las políticas RLS que la usan (sobre otras
-- tablas) disparen una re-evaluación de las políticas de bloqueos, mismo
-- criterio que fn_rol_perfil (migración 026) y es_admin() (migración 001).
CREATE OR REPLACE FUNCTION fn_existe_bloqueo(p_usuario1 uuid, p_usuario2 uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM bloqueos
    WHERE (bloqueador_id = p_usuario1 AND bloqueado_id = p_usuario2)
       OR (bloqueador_id = p_usuario2 AND bloqueado_id = p_usuario1)
  );
$$;

COMMENT ON FUNCTION fn_existe_bloqueo(uuid, uuid) IS
  'true si hay un bloqueo entre los dos usuarios, en cualquier dirección. Usada por las políticas/vistas de solicitudes, abogados y perfiles para excluir pares bloqueados.';

GRANT EXECUTE ON FUNCTION fn_existe_bloqueo(uuid, uuid) TO anon, authenticated;

-- ─── Trigger: cancelar solicitudes activas al bloquear ───────────────────────
-- SECURITY DEFINER porque ninguna política RLS de solicitudes permite hoy
-- una transición directa a CANCELADA salvo el propio cliente desde PENDIENTE
-- (cliente_cancela_solicitud, migración 023) -- acá hace falta cancelar desde
-- PENDIENTE o ACEPTADA, y puede iniciarla cualquiera de las dos partes.
-- También limpia los datos de contacto ya revelados (si la solicitud estaba
-- ACEPTADA), por la misma razón de privacidad que fn_revelar_contacto_al_aceptar
-- ya aplica en un rechazo.
CREATE OR REPLACE FUNCTION fn_cancelar_solicitudes_al_bloquear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE solicitudes
  SET estado = 'CANCELADA',
      cliente_telefono = NULL,
      cliente_email = NULL
  WHERE estado IN ('PENDIENTE', 'ACEPTADA')
    AND (
      (cliente_id = NEW.bloqueador_id AND abogado_id = NEW.bloqueado_id)
      OR (cliente_id = NEW.bloqueado_id AND abogado_id = NEW.bloqueador_id)
    );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_cancelar_solicitudes_al_bloquear() IS
  'Al crear un bloqueo, cancela toda solicitud PENDIENTE/ACEPTADA entre bloqueador y bloqueado, y limpia el contacto ya revelado.';

CREATE TRIGGER trg_cancelar_solicitudes_al_bloquear
  AFTER INSERT ON bloqueos
  FOR EACH ROW EXECUTE FUNCTION fn_cancelar_solicitudes_al_bloquear();

-- ─── RLS: excluir pares bloqueados en solicitudes, abogados y perfiles ───────
-- Nota conocida: fn_crear_solicitud_desde_tablon (SECURITY DEFINER) crea
-- solicitudes al margen de "cliente_crea_solicitud", así que un bloqueo no
-- impide (todavía) elegir a un abogado bloqueado desde El Tablón. Fuera del
-- alcance de este módulo -- documentado en CLAUDE.md.

DROP POLICY IF EXISTS "cliente_crea_solicitud" ON solicitudes;
CREATE POLICY "cliente_crea_solicitud" ON solicitudes
  FOR INSERT
  WITH CHECK (
    cliente_id = auth.uid()
    AND EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'cliente')
    AND NOT fn_existe_bloqueo(cliente_id, abogado_id)
  );

DROP POLICY IF EXISTS "busqueda_publica_abogados" ON abogados;
CREATE POLICY "busqueda_publica_abogados" ON abogados
  FOR SELECT
  USING (
    verificacion = 'VERIFICADO'
    AND toggle_disponible = true
    AND suscripcion_vigente_hasta IS NOT NULL
    AND (
      suscripcion_vigente_hasta >= CURRENT_DATE
      OR suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
    )
    AND NOT fn_existe_bloqueo(auth.uid(), id)
  );

DROP POLICY IF EXISTS "abogado_perfil_visible_busqueda" ON perfiles;
CREATE POLICY "abogado_perfil_visible_busqueda" ON perfiles
  FOR SELECT
  TO authenticated
  USING (
    rol = 'abogado'
    AND EXISTS (
      SELECT 1 FROM abogados a
      WHERE a.id = perfiles.id
        AND a.verificacion = 'VERIFICADO'
        AND a.toggle_disponible = true
        AND a.suscripcion_vigente_hasta IS NOT NULL
        AND (
          a.suscripcion_vigente_hasta >= CURRENT_DATE
          OR a.suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
        )
    )
    AND NOT fn_existe_bloqueo(auth.uid(), perfiles.id)
  );

-- busqueda_abogados es SECURITY DEFINER (como toda vista de este proyecto):
-- bypassea el RLS de abogados/perfiles de arriba, así que el filtro de
-- bloqueo tiene que repetirse acá también para que realmente excluya
-- resultados en la búsqueda y en perfil-abogado.html (que usa esta misma
-- vista para el detalle de un abogado puntual). Definición tomada de
-- pg_get_viewdef() sobre la vista en producción (no de la migración 009
-- original): acumuló columnas de provincia/cantón/zonas de servicio/estudio
-- en migraciones posteriores que no se reflejan en el archivo original, y
-- CREATE OR REPLACE VIEW no admite quitar columnas existentes.
CREATE OR REPLACE VIEW busqueda_abogados AS
SELECT
  a.id,
  p.nombre_completo,
  p.foto_url,
  p.ciudad,
  p.provincia,
  a.especialidades,
  a.casos_frecuentes,
  a.descripcion,
  a.precio_consulta,
  a.rating_promedio,
  a.total_resenas,
  a.toggle_disponible,
  a.red_id,
  a.estudio_id,
  CASE
    WHEN a.estudio_id IS NOT NULL THEN 'estudio'
    WHEN a.red_id IS NOT NULL     THEN 'red'
    ELSE                               'individual'
  END AS tipo_badge,
  a.provincia_id,
  prov.nombre AS provincia_nombre,
  a.canton_id,
  cant.nombre AS canton_nombre,
  COALESCE(zonas.provincia_ids, '{}'::integer[]) AS zonas_servicio_ids,
  COALESCE(zonas.nombres, '{}'::text[]) AS zonas_servicio_nombres,
  est.nombre AS estudio_nombre
FROM abogados a
JOIN perfiles p ON p.id = a.id
LEFT JOIN provincias prov ON prov.id = a.provincia_id
LEFT JOIN cantones cant ON cant.id = a.canton_id
LEFT JOIN estudios est ON est.id = a.estudio_id
LEFT JOIN LATERAL (
  SELECT array_agg(z.provincia_id) AS provincia_ids,
         array_agg(zp.nombre) AS nombres
  FROM abogado_zonas_servicio z
  JOIN provincias zp ON zp.id = z.provincia_id
  WHERE z.abogado_id = a.id
) zonas ON true
WHERE
  a.verificacion = 'VERIFICADO'
  AND a.toggle_disponible = true
  AND a.suscripcion_vigente_hasta IS NOT NULL
  AND (
    a.suscripcion_vigente_hasta >= CURRENT_DATE
    OR a.suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
  )
  AND NOT fn_existe_bloqueo(auth.uid(), a.id);

COMMENT ON VIEW busqueda_abogados IS 'Vista segura para búsqueda pública. Excluye teléfono, email, documentos, suscripcion_vigente_hasta y abogados bloqueados por/hacia el usuario autenticado (NULL auth.uid() en anon nunca bloquea nada).';

GRANT SELECT ON busqueda_abogados TO anon, authenticated;

-- ─── Vista admin: bloqueos activos con nombres de ambas partes ───────────────
CREATE OR REPLACE VIEW admin_bloqueos AS
SELECT
  b.id,
  b.bloqueador_id,
  pb.nombre_completo AS bloqueador_nombre,
  pb.rol             AS bloqueador_rol,
  b.bloqueado_id,
  pd.nombre_completo AS bloqueado_nombre,
  pd.rol             AS bloqueado_rol,
  b.created_at
FROM bloqueos b
JOIN perfiles pb ON pb.id = b.bloqueador_id
JOIN perfiles pd ON pd.id = b.bloqueado_id
WHERE es_admin();

COMMENT ON VIEW admin_bloqueos IS 'Bloqueos activos con nombre/rol de ambas partes, para el panel de administración. Filtra por es_admin() porque la vista no hereda el RLS de bloqueos.';

GRANT SELECT ON admin_bloqueos TO authenticated;
