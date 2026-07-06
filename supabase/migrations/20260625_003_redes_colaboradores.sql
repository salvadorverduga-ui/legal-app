-- 20260625_003_redes_colaboradores.sql
-- Asociación informal entre abogados independientes.
-- No tiene suscripción propia: cada miembro paga su $11.99 individual.
-- El badge de red desaparece automáticamente si algún miembro no renueva
-- (se maneja en la vista de búsqueda, no eliminando la fila).

CREATE TABLE redes_colaboradores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  descripcion text,
  creador_id  uuid NOT NULL REFERENCES perfiles(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE redes_colaboradores IS 'Redes informales de abogados independientes. No tiene suscripción propia; cada miembro paga individual.';

-- Membresías: relación muchos-a-muchos entre redes y abogados.
-- Un abogado puede pertenecer a una sola red a la vez (ver constraint en abogados.red_id).
CREATE TABLE red_miembros (
  red_id      uuid NOT NULL REFERENCES redes_colaboradores(id) ON DELETE CASCADE,
  abogado_id  uuid NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (red_id, abogado_id)
);

COMMENT ON TABLE red_miembros IS 'Membresías en redes. La red solo aparece en el badge de búsqueda cuando TODOS los miembros tienen suscripción vigente y están verificados.';

ALTER TABLE redes_colaboradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE red_miembros ENABLE ROW LEVEL SECURITY;

-- Miembros y creador pueden ver su propia red
CREATE POLICY "red_visible_para_miembros" ON redes_colaboradores
  FOR SELECT
  USING (
    creador_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM red_miembros rm
      WHERE rm.red_id = redes_colaboradores.id
        AND rm.abogado_id = auth.uid()
    )
  );

CREATE POLICY "admin_select_redes" ON redes_colaboradores
  FOR SELECT USING (es_admin());

-- Solo el creador puede actualizar la red
CREATE POLICY "creador_update_red" ON redes_colaboradores
  FOR UPDATE
  USING (creador_id = auth.uid());

-- El abogado puede insertar su propia red
CREATE POLICY "abogado_crea_red" ON redes_colaboradores
  FOR INSERT
  WITH CHECK (
    creador_id = auth.uid()
    AND EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'abogado')
  );

-- red_miembros: un abogado ve sus propias membresías
CREATE POLICY "abogado_ve_propias_membresias" ON red_miembros
  FOR SELECT
  USING (abogado_id = auth.uid());

CREATE POLICY "admin_select_red_miembros" ON red_miembros
  FOR SELECT USING (es_admin());

-- Solo el creador de la red puede agregar o eliminar miembros
CREATE POLICY "creador_gestiona_miembros" ON red_miembros
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM redes_colaboradores r
      WHERE r.id = red_id AND r.creador_id = auth.uid()
    )
  );

CREATE TRIGGER trg_redes_updated_at
  BEFORE UPDATE ON redes_colaboradores
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
