-- 20260712_040_tablon.sql
-- Feature: "El Tablón" — sección independiente donde clientes publican casos
-- y abogados verificados aplican. Al elegir un abogado se crea automáticamente
-- una solicitud mediada (mismo flujo de solicitudes.sql), así que el contacto
-- del cliente sigue revelándose solo cuando esa solicitud pasa a ACEPTADA
-- (fn_revelar_contacto_al_aceptar, migración 006) — este archivo no toca esa
-- regla, solo la reutiliza.
--
-- Distinto es el nombre del cliente en un caso publicado anónimamente: eso no
-- depende del estado de la solicitud sino de si el abogado fue ELEGIDO en su
-- aplicación a ESE caso. Se resuelve en la vista tablon_casos_abogado más abajo.

CREATE TYPE estado_caso_tablon AS ENUM ('ACTIVO', 'EXPIRADO', 'CERRADO');
CREATE TYPE estado_aplicacion_tablon AS ENUM ('PENDIENTE', 'ELEGIDO', 'RECHAZADO');

-- ────────────────────────────────────────────────────────────
-- TABLA: casos_tablon
-- ────────────────────────────────────────────────────────────
CREATE TABLE casos_tablon (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    uuid NOT NULL REFERENCES perfiles(id) ON DELETE RESTRICT,
  titulo        text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 120),
  descripcion   text NOT NULL CHECK (char_length(descripcion) <= 600),
  especialidad  text NOT NULL CHECK (especialidad IN (
    'Derecho de familia', 'Derecho laboral', 'Derecho mercantil', 'Derecho penal',
    'Derecho civil', 'Derecho administrativo', 'Derecho tributario', 'Derecho inmobiliario',
    'Derecho de tránsito', 'Derecho constitucional', 'Derecho ambiental',
    'Propiedad intelectual', 'Derecho internacional', 'Derecho migratorio'
  )),
  caso_comun    text CHECK (caso_comun IS NULL OR caso_comun IN (
    'Pensión alimenticia', 'Patria potestad', 'Divorcio', 'Trámite de herencia',
    'Despido intempestivo', 'Accidente de tránsito', 'Problema de arrendamiento',
    'Deuda comercial', 'Trámite migratorio', 'Otro'
  )),
  anonimo       boolean NOT NULL DEFAULT false,
  estado        estado_caso_tablon NOT NULL DEFAULT 'ACTIVO',
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL   -- calculado al insertar: created_at + 15 días
);

CREATE INDEX idx_casos_tablon_cliente ON casos_tablon (cliente_id, created_at DESC);
CREATE INDEX idx_casos_tablon_activos ON casos_tablon (especialidad, created_at DESC) WHERE estado = 'ACTIVO';
-- Índice para el cron de expiración: solo filas ACTIVO próximas a vencer
CREATE INDEX idx_casos_tablon_expiracion ON casos_tablon (expires_at) WHERE estado = 'ACTIVO';

COMMENT ON TABLE casos_tablon IS 'El Tablón: casos publicados por clientes para que abogados verificados apliquen. Expiran a los 15 días vía pg_cron.';
COMMENT ON COLUMN casos_tablon.anonimo IS 'Si true, el nombre del cliente se muestra como "Cliente anónimo" a los abogados hasta que uno de ellos es ELEGIDO en aplicaciones_tablon (ver vista tablon_casos_abogado).';

ALTER TABLE casos_tablon ENABLE ROW LEVEL SECURITY;

-- El cliente ve todos sus propios casos, sin importar el estado
CREATE POLICY "cliente_ve_propios_casos_tablon" ON casos_tablon
  FOR SELECT
  USING (cliente_id = auth.uid());

-- Abogados verificados ven los casos activos (la vista tablon_casos_abogado
-- es el canal recomendado desde el frontend; esta política habilita el acceso
-- directo a la tabla que esa vista necesita).
CREATE POLICY "abogado_ve_casos_activos_tablon" ON casos_tablon
  FOR SELECT
  USING (
    estado = 'ACTIVO'
    AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO')
  );

CREATE POLICY "admin_ve_casos_tablon" ON casos_tablon
  FOR SELECT USING (es_admin());

-- Solo clientes registrados pueden publicar. El límite de 2 casos/día se
-- valida en el trigger fn_verificar_limite_casos_tablon (no en la política,
-- para poder devolver un mensaje de error claro en vez de "row violates RLS").
CREATE POLICY "cliente_crea_caso_tablon" ON casos_tablon
  FOR INSERT
  WITH CHECK (
    cliente_id = auth.uid()
    AND EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'cliente')
  );

-- Trigger: calcula expires_at al insertar (now() es más seguro que created_at en BEFORE trigger)
CREATE OR REPLACE FUNCTION fn_set_expires_at_caso_tablon()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.expires_at = now() + INTERVAL '15 days';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_caso_tablon_expires_at
  BEFORE INSERT ON casos_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_set_expires_at_caso_tablon();

-- Trigger: máximo 2 casos publicados por cliente por día (CURRENT_DATE del
-- servidor, nunca la fecha del cliente — mismo criterio que get_server_date()).
CREATE OR REPLACE FUNCTION fn_verificar_limite_casos_tablon()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conteo integer;
BEGIN
  SELECT count(*) INTO v_conteo
  FROM casos_tablon
  WHERE cliente_id = NEW.cliente_id
    AND created_at::date = CURRENT_DATE;

  IF v_conteo >= 2 THEN
    RAISE EXCEPTION 'Ya publicó el máximo de 2 casos hoy. Intente de nuevo mañana.'
      USING ERRCODE = 'P0001', HINT = 'LIMITE_CASOS_TABLON';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_verificar_limite_casos_tablon
  BEFORE INSERT ON casos_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_limite_casos_tablon();


-- ────────────────────────────────────────────────────────────
-- TABLA: config_tablon
-- Se define antes que aplicaciones_tablon porque su trigger de límite
-- de aplicaciones (fn_verificar_limite_aplicaciones_tablon) la consulta.
-- ────────────────────────────────────────────────────────────
CREATE TABLE config_tablon (
  clave       text PRIMARY KEY,
  valor       text,
  descripcion text
);

COMMENT ON TABLE config_tablon IS 'Configuración editable desde panel-admin.html para El Tablón. valor es texto libre; cada clave documenta su propio formato/tipo esperado en descripcion.';

INSERT INTO config_tablon (clave, valor, descripcion) VALUES
  ('limite_aplicaciones_abogado', NULL, 'Máximo de aplicaciones activas simultáneas por abogado. NULL = sin límite.');

ALTER TABLE config_tablon ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede leer la config (no es sensible; el
-- abogado la necesita para saber si alcanzó el límite antes de aplicar).
CREATE POLICY "select_config_tablon" ON config_tablon
  FOR SELECT USING (true);

-- Solo el admin edita valores de configuración
CREATE POLICY "admin_actualiza_config_tablon" ON config_tablon
  FOR UPDATE USING (es_admin());


-- ────────────────────────────────────────────────────────────
-- TABLA: aplicaciones_tablon
-- ────────────────────────────────────────────────────────────
CREATE TABLE aplicaciones_tablon (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id     uuid NOT NULL REFERENCES casos_tablon(id) ON DELETE RESTRICT,
  abogado_id  uuid NOT NULL REFERENCES abogados(id) ON DELETE RESTRICT,
  mensaje     text CHECK (mensaje IS NULL OR char_length(mensaje) <= 300),
  estado      estado_aplicacion_tablon NOT NULL DEFAULT 'PENDIENTE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (caso_id, abogado_id)   -- un abogado aplica una sola vez por caso
);

CREATE INDEX idx_aplicaciones_tablon_caso ON aplicaciones_tablon (caso_id);
CREATE INDEX idx_aplicaciones_tablon_abogado ON aplicaciones_tablon (abogado_id, estado);

COMMENT ON TABLE aplicaciones_tablon IS 'Aplicaciones de abogados verificados a casos de El Tablón. Al pasar a ELEGIDO, el trigger fn_crear_solicitud_desde_tablon crea automáticamente una solicitud mediada normal.';

ALTER TABLE aplicaciones_tablon ENABLE ROW LEVEL SECURITY;

-- El abogado ve sus propias aplicaciones
CREATE POLICY "abogado_ve_propias_aplicaciones_tablon" ON aplicaciones_tablon
  FOR SELECT
  USING (abogado_id = auth.uid());

-- El cliente ve las aplicaciones recibidas en sus propios casos
CREATE POLICY "cliente_ve_aplicaciones_de_sus_casos" ON aplicaciones_tablon
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM casos_tablon c WHERE c.id = caso_id AND c.cliente_id = auth.uid()));

CREATE POLICY "admin_ve_aplicaciones_tablon" ON aplicaciones_tablon
  FOR SELECT USING (es_admin());

-- Solo abogados verificados aplican, y solo a casos activos.
-- El límite opcional de aplicaciones simultáneas (config_tablon) se valida
-- en el trigger fn_verificar_limite_aplicaciones_tablon.
CREATE POLICY "abogado_aplica_tablon" ON aplicaciones_tablon
  FOR INSERT
  WITH CHECK (
    abogado_id = auth.uid()
    AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO')
    AND EXISTS (SELECT 1 FROM casos_tablon c WHERE c.id = caso_id AND c.estado = 'ACTIVO')
  );

-- El cliente dueño del caso elige (o rechaza) una aplicación
CREATE POLICY "cliente_elige_aplicacion_tablon" ON aplicaciones_tablon
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM casos_tablon c WHERE c.id = caso_id AND c.cliente_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM casos_tablon c WHERE c.id = caso_id AND c.cliente_id = auth.uid()));

-- Trigger: límite opcional de aplicaciones PENDIENTE simultáneas por abogado.
-- config_tablon.limite_aplicaciones_abogado = NULL (default) significa sin límite;
-- el admin puede fijar un número desde panel-admin.html (ver config_tablon abajo).
CREATE OR REPLACE FUNCTION fn_verificar_limite_aplicaciones_tablon()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limite  integer;
  v_activas integer;
BEGIN
  SELECT valor::integer INTO v_limite
  FROM config_tablon
  WHERE clave = 'limite_aplicaciones_abogado';

  IF v_limite IS NOT NULL THEN
    SELECT count(*) INTO v_activas
    FROM aplicaciones_tablon
    WHERE abogado_id = NEW.abogado_id AND estado = 'PENDIENTE';

    IF v_activas >= v_limite THEN
      RAISE EXCEPTION 'Alcanzó el máximo de aplicaciones activas permitidas (%).', v_limite
        USING ERRCODE = 'P0001', HINT = 'LIMITE_APLICACIONES_TABLON';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_verificar_limite_aplicaciones_tablon
  BEFORE INSERT ON aplicaciones_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_verificar_limite_aplicaciones_tablon();

-- Trigger: al elegir un abogado, crear automáticamente la solicitud mediada
-- (mismo flujo que una solicitud creada desde búsqueda normal — ver
-- solicitudes.sql). Corre con los permisos de quien ejecuta el UPDATE (el
-- propio cliente dueño del caso, según la política de arriba), así que la
-- política "cliente_crea_solicitud" de solicitudes se cumple sin necesidad
-- de SECURITY DEFINER.
CREATE OR REPLACE FUNCTION fn_crear_solicitud_desde_tablon()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_caso casos_tablon%ROWTYPE;
BEGIN
  IF NEW.estado = 'ELEGIDO' AND OLD.estado IS DISTINCT FROM 'ELEGIDO' THEN
    SELECT * INTO v_caso FROM casos_tablon WHERE id = NEW.caso_id;

    BEGIN
      INSERT INTO solicitudes (cliente_id, abogado_id, descripcion_caso)
      VALUES (v_caso.cliente_id, NEW.abogado_id, v_caso.titulo || ': ' || v_caso.descripcion);
    EXCEPTION WHEN unique_violation THEN
      -- Ya existe una solicitud activa entre este cliente y este abogado
      -- (p.ej. enviada antes desde la búsqueda normal). El caso se marca
      -- ELEGIDO igual; no se duplica la solicitud.
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crear_solicitud_desde_tablon
  AFTER UPDATE OF estado ON aplicaciones_tablon
  FOR EACH ROW EXECUTE FUNCTION fn_crear_solicitud_desde_tablon();


-- ────────────────────────────────────────────────────────────
-- VISTAS
-- ────────────────────────────────────────────────────────────

-- Vista para abogados: casos activos con el nombre del cliente resuelto
-- según la regla de anonimato (CLAUDE.md-style: la condición vive en la BD,
-- no en el frontend). Retorna vacío si quien consulta no es un abogado
-- verificado — refuerza la política RLS de la tabla base, no la reemplaza.
CREATE OR REPLACE VIEW tablon_casos_abogado AS
SELECT
  c.id,
  c.titulo,
  c.descripcion,
  c.especialidad,
  c.caso_comun,
  c.anonimo,
  c.estado,
  c.created_at,
  c.expires_at,
  CASE
    WHEN c.anonimo AND NOT EXISTS (
      SELECT 1 FROM aplicaciones_tablon ap
      WHERE ap.caso_id = c.id AND ap.abogado_id = auth.uid() AND ap.estado = 'ELEGIDO'
    ) THEN 'Cliente anónimo'
    ELSE p.nombre_completo
  END AS cliente_nombre,
  (SELECT count(*) FROM aplicaciones_tablon ap2 WHERE ap2.caso_id = c.id) AS total_aplicaciones,
  (SELECT ap3.estado FROM aplicaciones_tablon ap3
     WHERE ap3.caso_id = c.id AND ap3.abogado_id = auth.uid()) AS mi_aplicacion_estado
FROM casos_tablon c
JOIN perfiles p ON p.id = c.cliente_id
WHERE c.estado = 'ACTIVO'
  AND EXISTS (SELECT 1 FROM abogados a WHERE a.id = auth.uid() AND a.verificacion = 'VERIFICADO');

COMMENT ON VIEW tablon_casos_abogado IS 'Casos activos de El Tablón para el abogado verificado autenticado. cliente_nombre respeta el anonimato hasta que este abogado sea ELEGIDO en el caso. mi_aplicacion_estado es NULL si aún no aplicó.';

-- Vista para el cliente: sus propios casos con el total de aplicaciones recibidas.
CREATE OR REPLACE VIEW tablon_casos_cliente AS
SELECT
  c.*,
  (SELECT count(*) FROM aplicaciones_tablon ap WHERE ap.caso_id = c.id) AS total_aplicaciones
FROM casos_tablon c
WHERE c.cliente_id = auth.uid();

COMMENT ON VIEW tablon_casos_cliente IS 'Casos propios del cliente autenticado (todos los estados) con el total de aplicaciones recibidas.';

-- Vista para el cliente: aplicaciones recibidas en sus casos, con datos
-- públicos del abogado aplicante para decidir a quién elegir.
CREATE OR REPLACE VIEW tablon_aplicaciones_cliente AS
SELECT
  ap.id,
  ap.caso_id,
  ap.abogado_id,
  ap.mensaje,
  ap.estado,
  ap.created_at,
  p.nombre_completo AS abogado_nombre,
  p.foto_url        AS abogado_foto,
  a.especialidades  AS abogado_especialidades,
  a.rating_promedio AS abogado_rating,
  a.total_resenas   AS abogado_total_resenas
FROM aplicaciones_tablon ap
JOIN casos_tablon c ON c.id = ap.caso_id
JOIN perfiles     p ON p.id = ap.abogado_id
JOIN abogados     a ON a.id = ap.abogado_id
WHERE c.cliente_id = auth.uid();

COMMENT ON VIEW tablon_aplicaciones_cliente IS 'Aplicaciones recibidas en los casos del cliente autenticado, con datos públicos del abogado aplicante.';


-- ────────────────────────────────────────────────────────────
-- pg_cron: expiración automática de casos (cada hora)
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION fn_expirar_casos_tablon()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE casos_tablon
  SET estado = 'EXPIRADO'
  WHERE estado = 'ACTIVO'
    AND expires_at < now();
$$;

COMMENT ON FUNCTION fn_expirar_casos_tablon() IS
  'Transiciona ACTIVO -> EXPIRADO cuando expires_at < now(). Programada vía pg_cron cada hora (job "expirar-casos-tablon"). Sin GRANT a authenticated/anon: solo la invoca el scheduler interno de pg_cron.';

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'expirar-casos-tablon';

SELECT cron.schedule(
  'expirar-casos-tablon',
  '0 * * * *',
  $$SELECT fn_expirar_casos_tablon();$$
);


-- ────────────────────────────────────────────────────────────
-- GRANTS (CLAUDE.md §12: en la misma migración donde se crea el objeto)
-- ────────────────────────────────────────────────────────────

-- casos_tablon: cliente publica (INSERT) y lee los suyos; abogado lee los
-- activos. UPDATE no se otorga: el único cambio de estado post-creación
-- (ACTIVO -> EXPIRADO) lo hace el cron con SECURITY DEFINER, que no
-- requiere GRANT. DELETE: NO, el historial de casos no se borra.
GRANT SELECT, INSERT ON TABLE casos_tablon TO authenticated;

-- aplicaciones_tablon: abogado aplica (INSERT); cliente elige (UPDATE
-- estado, vía RLS restringido a sus propios casos). DELETE: NO.
GRANT SELECT, INSERT, UPDATE ON TABLE aplicaciones_tablon TO authenticated;

-- config_tablon: lectura para todos los autenticados; escritura solo admin
-- (la RLS ya lo restringe; el GRANT de tabla es la capa complementaria).
GRANT SELECT, UPDATE ON TABLE config_tablon TO authenticated;

-- Vistas: mismo criterio que busqueda_abogados/panel_solicitudes_* (011) —
-- cada vista ya filtra por auth.uid() o por rol en su propio WHERE.
GRANT SELECT ON tablon_casos_abogado TO authenticated;
GRANT SELECT ON tablon_casos_cliente TO authenticated;
GRANT SELECT ON tablon_aplicaciones_cliente TO authenticated;
