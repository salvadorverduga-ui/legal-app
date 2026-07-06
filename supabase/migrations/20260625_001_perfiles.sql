-- 20260625_001_perfiles.sql
-- Tabla central para todos los usuarios del sistema.
-- Un registro por cada entrada en auth.users.
-- El rol determina qué tabla extendida existe (abogados, estudios).
-- Los clientes solo viven en esta tabla.

-- Función compartida para updated_at: se crea aquí porque todas las tablas la usan.
CREATE OR REPLACE FUNCTION fn_actualizar_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE perfiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rol             text NOT NULL CHECK (rol IN ('cliente', 'abogado', 'estudio', 'admin')),
  nombre_completo text NOT NULL,
  cedula          text UNIQUE,      -- cédula de identidad; obligatoria para clientes y abogados
  telefono        text,             -- dato sensible; se revela al abogado solo tras match aceptado
  ciudad          text,
  provincia       text,
  foto_url        text,             -- path en Supabase Storage (no URL directa para evitar exposición sin auth)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- El email vive en auth.users y se accede vía Supabase Auth API.
-- No se duplica aquí para evitar desincronización.

COMMENT ON TABLE perfiles IS 'Tabla base para todos los usuarios: clientes, abogados, estudios y admins.';
COMMENT ON COLUMN perfiles.telefono IS 'Dato sensible. El abogado lo recibe en solicitudes.cliente_telefono solo cuando el estado es ACEPTADA.';
COMMENT ON COLUMN perfiles.foto_url IS 'Path relativo en Supabase Storage. La URL pública se genera en el frontend con supabase.storage.from().getPublicUrl().';

ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;

-- Función auxiliar que identifica si el usuario activo es admin.
-- SECURITY DEFINER para poder leer la tabla perfiles sin recursión infinita.
-- SET search_path previene hijacking del schema.
CREATE OR REPLACE FUNCTION es_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM perfiles
    WHERE id = auth.uid() AND rol = 'admin'
  );
$$;

-- Cada usuario puede leer su propio perfil completo (incluyendo teléfono)
CREATE POLICY "perfil_propio_select" ON perfiles
  FOR SELECT
  USING (id = auth.uid());

-- Admin puede leer todos los perfiles
CREATE POLICY "admin_select_perfiles" ON perfiles
  FOR SELECT
  USING (es_admin());

-- El usuario puede actualizar su propio perfil pero NO puede cambiar el rol.
-- El cambio de rol solo lo hace el sistema (service_role).
CREATE POLICY "perfil_propio_update" ON perfiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND rol = (SELECT rol FROM perfiles WHERE id = auth.uid())
  );

-- INSERT: solo el trigger de registro lo hace (service_role bypasses RLS).
-- No se permite INSERT directo desde el cliente.

CREATE TRIGGER trg_perfiles_updated_at
  BEFORE UPDATE ON perfiles
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- Trigger: crea la fila en perfiles automáticamente cuando un usuario se registra en auth.
-- Los metadatos del registro deben incluir: rol, nombre_completo, cedula.
CREATE OR REPLACE FUNCTION fn_crear_perfil_en_registro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO perfiles (id, rol, nombre_completo, cedula)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'rol', 'cliente'),
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', ''),
    NEW.raw_user_meta_data->>'cedula'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crear_perfil_en_registro
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fn_crear_perfil_en_registro();
