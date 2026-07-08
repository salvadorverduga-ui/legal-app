-- 20260707_028_provincias_cantones.sql
-- Normaliza la ubicación del abogado: reemplaza el texto libre
-- perfiles.provincia (usado hasta ahora en el formulario del panel del
-- abogado) por tablas de referencia provincias/cantones y agrega el
-- concepto de "zona de servicio adicional" — un abogado puede marcar
-- provincias donde también atiende (consulta online, desplazamiento, etc.)
-- además de su provincia/cantón principal.
--
-- perfiles.provincia (texto) se mantiene intacta: sigue siendo el campo
-- de ubicación general para clientes y estudios. abogados.provincia_id/
-- canton_id son la fuente de verdad para la ubicación profesional del
-- abogado y para el filtro de búsqueda.

-- ────────────────────────────────────────────────────────────
-- Tabla: provincias — las 24 provincias del Ecuador
-- ────────────────────────────────────────────────────────────
CREATE TABLE provincias (
  id     serial PRIMARY KEY,
  nombre text NOT NULL UNIQUE
);

COMMENT ON TABLE provincias IS 'Catálogo fijo de las 24 provincias del Ecuador. Datos de referencia; no editable desde el frontend.';

INSERT INTO provincias (nombre) VALUES
  ('Azuay'),
  ('Bolívar'),
  ('Cañar'),
  ('Carchi'),
  ('Chimborazo'),
  ('Cotopaxi'),
  ('El Oro'),
  ('Esmeraldas'),
  ('Galápagos'),
  ('Guayas'),
  ('Imbabura'),
  ('Loja'),
  ('Los Ríos'),
  ('Manabí'),
  ('Morona Santiago'),
  ('Napo'),
  ('Orellana'),
  ('Pastaza'),
  ('Pichincha'),
  ('Santa Elena'),
  ('Santo Domingo de los Tsáchilas'),
  ('Sucumbíos'),
  ('Tungurahua'),
  ('Zamora Chinchipe');

-- ────────────────────────────────────────────────────────────
-- Tabla: cantones — cantones de cada provincia
-- ────────────────────────────────────────────────────────────
CREATE TABLE cantones (
  id           serial PRIMARY KEY,
  nombre       text NOT NULL,
  provincia_id integer NOT NULL REFERENCES provincias(id) ON DELETE CASCADE,
  UNIQUE (provincia_id, nombre)
);

CREATE INDEX idx_cantones_provincia_id ON cantones (provincia_id);

COMMENT ON TABLE cantones IS 'Catálogo fijo de cantones por provincia. Datos de referencia; no editable desde el frontend.';

INSERT INTO cantones (nombre, provincia_id) VALUES
  -- Azuay
  ('Cuenca', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Camilo Ponce Enríquez', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Chordeleg', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('El Pan', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Girón', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Guachapala', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Gualaceo', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Nabón', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Oña', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Paute', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Pucará', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('San Fernando', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Santa Isabel', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Sevilla de Oro', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  ('Sígsig', (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  -- Bolívar
  ('Guaranda', (SELECT id FROM provincias WHERE nombre = 'Bolívar')),
  ('Caluma', (SELECT id FROM provincias WHERE nombre = 'Bolívar')),
  ('Chillanes', (SELECT id FROM provincias WHERE nombre = 'Bolívar')),
  ('Chimbo', (SELECT id FROM provincias WHERE nombre = 'Bolívar')),
  ('Echeandía', (SELECT id FROM provincias WHERE nombre = 'Bolívar')),
  ('Las Naves', (SELECT id FROM provincias WHERE nombre = 'Bolívar')),
  ('San Miguel', (SELECT id FROM provincias WHERE nombre = 'Bolívar')),
  -- Cañar
  ('Azogues', (SELECT id FROM provincias WHERE nombre = 'Cañar')),
  ('Biblián', (SELECT id FROM provincias WHERE nombre = 'Cañar')),
  ('Cañar', (SELECT id FROM provincias WHERE nombre = 'Cañar')),
  ('Deleg', (SELECT id FROM provincias WHERE nombre = 'Cañar')),
  ('El Tambo', (SELECT id FROM provincias WHERE nombre = 'Cañar')),
  ('La Troncal', (SELECT id FROM provincias WHERE nombre = 'Cañar')),
  ('Suscal', (SELECT id FROM provincias WHERE nombre = 'Cañar')),
  -- Carchi
  ('Tulcán', (SELECT id FROM provincias WHERE nombre = 'Carchi')),
  ('Bolívar', (SELECT id FROM provincias WHERE nombre = 'Carchi')),
  ('Espejo', (SELECT id FROM provincias WHERE nombre = 'Carchi')),
  ('Mira', (SELECT id FROM provincias WHERE nombre = 'Carchi')),
  ('Montúfar', (SELECT id FROM provincias WHERE nombre = 'Carchi')),
  ('San Pedro de Huaca', (SELECT id FROM provincias WHERE nombre = 'Carchi')),
  -- Chimborazo
  ('Riobamba', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Alausí', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Chambo', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Chunchi', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Colta', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Cumandá', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Guamote', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Guano', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Pallatanga', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  ('Penipe', (SELECT id FROM provincias WHERE nombre = 'Chimborazo')),
  -- Cotopaxi
  ('Latacunga', (SELECT id FROM provincias WHERE nombre = 'Cotopaxi')),
  ('La Maná', (SELECT id FROM provincias WHERE nombre = 'Cotopaxi')),
  ('Pangua', (SELECT id FROM provincias WHERE nombre = 'Cotopaxi')),
  ('Pujilí', (SELECT id FROM provincias WHERE nombre = 'Cotopaxi')),
  ('Salcedo', (SELECT id FROM provincias WHERE nombre = 'Cotopaxi')),
  ('Saquisilí', (SELECT id FROM provincias WHERE nombre = 'Cotopaxi')),
  ('Sigchos', (SELECT id FROM provincias WHERE nombre = 'Cotopaxi')),
  -- El Oro
  ('Machala', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Arenillas', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Atahualpa', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Balsas', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Chilla', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('El Guabo', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Huaquillas', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Las Lajas', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Marcabelí', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Pasaje', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Piñas', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Portovelo', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Santa Rosa', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  ('Zaruma', (SELECT id FROM provincias WHERE nombre = 'El Oro')),
  -- Esmeraldas
  ('Esmeraldas', (SELECT id FROM provincias WHERE nombre = 'Esmeraldas')),
  ('Atacames', (SELECT id FROM provincias WHERE nombre = 'Esmeraldas')),
  ('Eloy Alfaro', (SELECT id FROM provincias WHERE nombre = 'Esmeraldas')),
  ('Muisne', (SELECT id FROM provincias WHERE nombre = 'Esmeraldas')),
  ('Quinindé', (SELECT id FROM provincias WHERE nombre = 'Esmeraldas')),
  ('Rioverde', (SELECT id FROM provincias WHERE nombre = 'Esmeraldas')),
  ('San Lorenzo', (SELECT id FROM provincias WHERE nombre = 'Esmeraldas')),
  -- Galápagos
  ('San Cristóbal', (SELECT id FROM provincias WHERE nombre = 'Galápagos')),
  ('Isabela', (SELECT id FROM provincias WHERE nombre = 'Galápagos')),
  ('Santa Cruz', (SELECT id FROM provincias WHERE nombre = 'Galápagos')),
  -- Guayas
  ('Guayaquil', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Alfredo Baquerizo Moreno', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Balao', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Balzar', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Colimes', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Daule', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Durán', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('El Empalme', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('El Triunfo', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('General Antonio Elizalde', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Isidro Ayora', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Lomas de Sargentillo', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Marcelino Maridueña', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Milagro', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Naranjal', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Naranjito', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Nobol', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Palestina', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Pedro Carbo', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Playas', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Salitre', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Samborondón', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Santa Lucía', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Simón Bolívar', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  ('Yaguachi', (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  -- Imbabura
  ('Ibarra', (SELECT id FROM provincias WHERE nombre = 'Imbabura')),
  ('Antonio Ante', (SELECT id FROM provincias WHERE nombre = 'Imbabura')),
  ('Cotacachi', (SELECT id FROM provincias WHERE nombre = 'Imbabura')),
  ('Otavalo', (SELECT id FROM provincias WHERE nombre = 'Imbabura')),
  ('Pimampiro', (SELECT id FROM provincias WHERE nombre = 'Imbabura')),
  ('Urcuquí', (SELECT id FROM provincias WHERE nombre = 'Imbabura')),
  -- Loja
  ('Loja', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Calvas', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Catamayo', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Celica', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Chaguarpamba', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Espíndola', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Gonzanamá', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Macará', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Olmedo', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Paltas', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Pindal', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Puyango', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Quilanga', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Saraguro', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Sozoranga', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  ('Zapotillo', (SELECT id FROM provincias WHERE nombre = 'Loja')),
  -- Los Ríos
  ('Babahoyo', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Baba', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Buena Fe', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Mocache', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Montalvo', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Palenque', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Puebloviejo', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Quevedo', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Quinsaloma', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Urdaneta', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Valencia', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Ventanas', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  ('Vinces', (SELECT id FROM provincias WHERE nombre = 'Los Ríos')),
  -- Manabí
  ('Portoviejo', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('24 de Mayo', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Bolívar', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Chone', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('El Carmen', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Flavio Alfaro', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Jama', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Jaramijó', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Jipijapa', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Junín', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Manta', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Montecristi', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Olmedo', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Paján', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Pedernales', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Pichincha', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Puerto López', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Rocafuerte', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('San Vicente', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Santa Ana', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Sucre', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  ('Tosagua', (SELECT id FROM provincias WHERE nombre = 'Manabí')),
  -- Morona Santiago
  ('Macas', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Gualaquiza', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Huamboya', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Limón Indanza', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Logroño', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Pablo Sexto', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Palora', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('San Juan Bosco', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Santiago', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Sucúa', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Taisha', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  ('Tiwintza', (SELECT id FROM provincias WHERE nombre = 'Morona Santiago')),
  -- Napo
  ('Tena', (SELECT id FROM provincias WHERE nombre = 'Napo')),
  ('Archidona', (SELECT id FROM provincias WHERE nombre = 'Napo')),
  ('Carlos Julio Arosemena Tola', (SELECT id FROM provincias WHERE nombre = 'Napo')),
  ('El Chaco', (SELECT id FROM provincias WHERE nombre = 'Napo')),
  ('Quijos', (SELECT id FROM provincias WHERE nombre = 'Napo')),
  -- Orellana
  ('Puerto Francisco de Orellana', (SELECT id FROM provincias WHERE nombre = 'Orellana')),
  ('Aguarico', (SELECT id FROM provincias WHERE nombre = 'Orellana')),
  ('La Joya de los Sachas', (SELECT id FROM provincias WHERE nombre = 'Orellana')),
  ('Loreto', (SELECT id FROM provincias WHERE nombre = 'Orellana')),
  -- Pastaza
  ('Puyo', (SELECT id FROM provincias WHERE nombre = 'Pastaza')),
  ('Arajuno', (SELECT id FROM provincias WHERE nombre = 'Pastaza')),
  ('Mera', (SELECT id FROM provincias WHERE nombre = 'Pastaza')),
  ('Santa Clara', (SELECT id FROM provincias WHERE nombre = 'Pastaza')),
  -- Pichincha
  ('Quito', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  ('Cayambe', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  ('Mejía', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  ('Pedro Moncayo', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  ('Pedro Vicente Maldonado', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  ('Puerto Quito', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  ('Rumiñahui', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  ('San Miguel de los Bancos', (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  -- Santa Elena
  ('Santa Elena', (SELECT id FROM provincias WHERE nombre = 'Santa Elena')),
  ('La Libertad', (SELECT id FROM provincias WHERE nombre = 'Santa Elena')),
  ('Salinas', (SELECT id FROM provincias WHERE nombre = 'Santa Elena')),
  -- Santo Domingo de los Tsáchilas
  ('Santo Domingo', (SELECT id FROM provincias WHERE nombre = 'Santo Domingo de los Tsáchilas')),
  ('La Concordia', (SELECT id FROM provincias WHERE nombre = 'Santo Domingo de los Tsáchilas')),
  -- Sucumbíos
  ('Nueva Loja', (SELECT id FROM provincias WHERE nombre = 'Sucumbíos')),
  ('Cascales', (SELECT id FROM provincias WHERE nombre = 'Sucumbíos')),
  ('Cuyabeno', (SELECT id FROM provincias WHERE nombre = 'Sucumbíos')),
  ('Gonzalo Pizarro', (SELECT id FROM provincias WHERE nombre = 'Sucumbíos')),
  ('Putumayo', (SELECT id FROM provincias WHERE nombre = 'Sucumbíos')),
  ('Shushufindi', (SELECT id FROM provincias WHERE nombre = 'Sucumbíos')),
  ('Sucumbíos', (SELECT id FROM provincias WHERE nombre = 'Sucumbíos')),
  -- Tungurahua
  ('Ambato', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('Baños de Agua Santa', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('Cevallos', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('Mocha', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('Patate', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('Píllaro', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('Quero', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('San Pedro de Pelileo', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  ('Tisaleo', (SELECT id FROM provincias WHERE nombre = 'Tungurahua')),
  -- Zamora Chinchipe
  ('Zamora', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('Centinela del Cóndor', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('Chinchipe', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('El Pangui', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('Nangaritza', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('Palanda', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('Paquisha', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('Yacuambi', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe')),
  ('Yantzaza', (SELECT id FROM provincias WHERE nombre = 'Zamora Chinchipe'));

-- ────────────────────────────────────────────────────────────
-- RLS: provincias y cantones son datos de referencia fijos.
-- Solo lectura para usuarios autenticados; nadie inserta/actualiza/
-- borra desde el frontend (CLAUDE.md §4.1 — RLS en todas las tablas).
-- ────────────────────────────────────────────────────────────
ALTER TABLE provincias ENABLE ROW LEVEL SECURITY;
ALTER TABLE cantones   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lectura_provincias" ON provincias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "lectura_cantones" ON cantones
  FOR SELECT TO authenticated USING (true);

-- ────────────────────────────────────────────────────────────
-- abogados: ubicación profesional normalizada.
-- provincia_id/canton_id reemplazan, para el abogado, el uso del
-- texto libre perfiles.provincia como ubicación principal.
-- ────────────────────────────────────────────────────────────
ALTER TABLE abogados
  ADD COLUMN provincia_id integer REFERENCES provincias(id),
  ADD COLUMN canton_id    integer REFERENCES cantones(id);

COMMENT ON COLUMN abogados.provincia_id IS 'Provincia principal donde el abogado está ubicado. Fuente de verdad para búsqueda y perfil público (reemplaza perfiles.provincia para abogados).';
COMMENT ON COLUMN abogados.canton_id IS 'Cantón principal dentro de provincia_id.';

-- Backfill: intenta emparejar el texto libre existente en perfiles.provincia
-- con el catálogo nuevo. Si no hay coincidencia exacta (por variaciones de
-- escritura), provincia_id queda NULL y el abogado deberá completarlo desde
-- el panel — no hay forma segura de adivinar el cantón desde texto libre.
UPDATE abogados a
SET provincia_id = p.id
FROM perfiles pf
JOIN provincias p ON lower(trim(p.nombre)) = lower(trim(pf.provincia))
WHERE a.id = pf.id
  AND a.provincia_id IS NULL;

CREATE INDEX idx_abogados_provincia_id ON abogados (provincia_id);

-- ────────────────────────────────────────────────────────────
-- Tabla: abogado_zonas_servicio
-- Provincias adicionales donde el abogado también presta servicios
-- (consulta online, desplazamiento, etc.), además de su provincia
-- principal (abogados.provincia_id).
-- ────────────────────────────────────────────────────────────
CREATE TABLE abogado_zonas_servicio (
  abogado_id   uuid NOT NULL REFERENCES abogados(id) ON DELETE CASCADE,
  provincia_id integer NOT NULL REFERENCES provincias(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (abogado_id, provincia_id)
);

CREATE INDEX idx_abogado_zonas_servicio_provincia_id ON abogado_zonas_servicio (provincia_id);

COMMENT ON TABLE abogado_zonas_servicio IS 'Provincias adicionales donde un abogado presta servicios, aparte de su provincia principal (abogados.provincia_id). Usada para ampliar el alcance del filtro de búsqueda por provincia.';

ALTER TABLE abogado_zonas_servicio ENABLE ROW LEVEL SECURITY;

-- El abogado gestiona (agrega/quita) sus propias zonas.
CREATE POLICY "abogado_inserta_propias_zonas" ON abogado_zonas_servicio
  FOR INSERT
  WITH CHECK (abogado_id = auth.uid());

CREATE POLICY "abogado_elimina_propias_zonas" ON abogado_zonas_servicio
  FOR DELETE
  USING (abogado_id = auth.uid());

-- Cualquier usuario autenticado puede leer todas las zonas: la búsqueda
-- pública necesita ver las zonas de servicio de otros abogados, no solo
-- las propias.
CREATE POLICY "lectura_publica_zonas_servicio" ON abogado_zonas_servicio
  FOR SELECT TO authenticated USING (true);

-- ────────────────────────────────────────────────────────────
-- Vista busqueda_abogados: agrega provincia/cantón principal y las
-- zonas de servicio adicionales para que el frontend pueda filtrar
-- por "provincia principal O zona de servicio" y mostrar el badge
-- "También atiende en [provincia]".
-- ────────────────────────────────────────────────────────────
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
  COALESCE(zonas.provincia_ids, '{}') AS zonas_servicio_ids,
  COALESCE(zonas.nombres, '{}')       AS zonas_servicio_nombres
FROM abogados a
JOIN perfiles p ON p.id = a.id
LEFT JOIN provincias prov ON prov.id = a.provincia_id
LEFT JOIN cantones   cant ON cant.id = a.canton_id
LEFT JOIN LATERAL (
  SELECT
    array_agg(z.provincia_id) AS provincia_ids,
    array_agg(zp.nombre)      AS nombres
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
  );

COMMENT ON VIEW busqueda_abogados IS 'Vista segura para búsqueda pública. Excluye teléfono, email, documentos y suscripcion_vigente_hasta. provincia_id/provincia_nombre y canton_id/canton_nombre son la ubicación principal; zonas_servicio_ids/zonas_servicio_nombres son provincias adicionales donde el abogado también atiende.';

-- ────────────────────────────────────────────────────────────
-- GRANTs (CLAUDE.md §12 — obligatorio en la misma migración)
-- ────────────────────────────────────────────────────────────
GRANT SELECT ON TABLE provincias TO authenticated;
GRANT SELECT ON TABLE cantones TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE abogado_zonas_servicio TO authenticated;

-- Se repite el GRANT de la vista (ya existente desde migration 011) porque
-- CREATE OR REPLACE VIEW no cambia los grants existentes, pero lo dejamos
-- explícito por si esta migración se llegara a aplicar de forma aislada.
GRANT SELECT ON busqueda_abogados TO authenticated;
