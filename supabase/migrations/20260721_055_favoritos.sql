-- 20260721_055_favoritos.sql
-- CLAUDE.md módulo 7: sistema de favoritos para clientes.

CREATE TABLE favoritos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  uuid NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  abogado_id  uuid NOT NULL REFERENCES abogados(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, abogado_id)
);

CREATE INDEX idx_favoritos_cliente ON favoritos (cliente_id, created_at DESC);

COMMENT ON TABLE favoritos IS 'Abogados marcados como favoritos por un cliente. UNIQUE(cliente_id, abogado_id) evita duplicados; api.favoritos.toggle() inserta o borra según corresponda.';

ALTER TABLE favoritos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_ve_propios_favoritos" ON favoritos
  FOR SELECT
  USING (cliente_id = auth.uid());

CREATE POLICY "cliente_inserta_favorito" ON favoritos
  FOR INSERT
  WITH CHECK (
    cliente_id = auth.uid()
    AND EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'cliente')
  );

CREATE POLICY "cliente_elimina_favorito" ON favoritos
  FOR DELETE
  USING (cliente_id = auth.uid());

-- GRANT en la misma migración (CLAUDE.md §12). Sin UPDATE: el toggle del
-- frontend siempre inserta o borra, nunca actualiza una fila existente.
GRANT SELECT, INSERT, DELETE ON TABLE favoritos TO authenticated;

-- Vista para la pestaña "Favoritos" de panel-cliente.html — mismo patrón que
-- panel_abogados_contactados (migración 034): join directo sin bypass de
-- RLS. Si un abogado favorito deja de ser visible (verificación revocada,
-- suscripción vencida), su fila simplemente no aparece en esta vista.
CREATE OR REPLACE VIEW panel_favoritos_cliente AS
SELECT
  f.id                AS favorito_id,
  f.abogado_id,
  p.nombre_completo    AS abogado_nombre,
  p.foto_url           AS abogado_foto,
  a.especialidades     AS abogado_especialidades,
  prov.nombre          AS abogado_provincia,
  f.created_at
FROM favoritos f
JOIN perfiles   p    ON p.id = f.abogado_id
JOIN abogados   a    ON a.id = f.abogado_id
LEFT JOIN provincias prov ON prov.id = a.provincia_id
WHERE f.cliente_id = auth.uid();

COMMENT ON VIEW panel_favoritos_cliente IS 'Abogados favoritos del cliente autenticado, con datos públicos para la pestaña "Favoritos" de panel-cliente.html.';

GRANT SELECT ON panel_favoritos_cliente TO authenticated;
