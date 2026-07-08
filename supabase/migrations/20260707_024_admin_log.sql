-- 20260707_024_admin_log.sql
-- Auditoría de las acciones del admin sobre verificaciones (CLAUDE.md módulo 4:
-- quién aprobó/rechazó cada verificación, y cuándo).
--
-- admin_log se completa exclusivamente desde el trigger fn_propagar_estado_verificacion
-- (migración 008, SECURITY DEFINER, dueño postgres) cuando una verificación pasa a
-- VERIFICADO o RECHAZADO. No se otorga GRANT INSERT a authenticated (CLAUDE.md §12:
-- "no otorgar INSERT en tablas donde el dato lo crea un trigger"): así ni siquiera un
-- admin autenticado puede insertar entradas falsas en el log directamente vía PostgREST,
-- solo puede llegar a existir una entrada como consecuencia real de aprobar/rechazar
-- una verificación desde el flujo auditado.

CREATE TABLE admin_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  accion          text NOT NULL CHECK (accion IN ('APROBAR', 'RECHAZAR')),
  verificacion_id uuid NOT NULL REFERENCES verificaciones(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_log_created_at ON admin_log (created_at DESC);

COMMENT ON TABLE admin_log IS 'Auditoría de aprobaciones/rechazos de verificaciones. Insertado únicamente por el trigger fn_propagar_estado_verificacion (migración 008); nunca desde el frontend.';

ALTER TABLE admin_log ENABLE ROW LEVEL SECURITY;

-- Solo admin puede leer el log. No hay política de INSERT/UPDATE/DELETE:
-- la única vía de escritura es el trigger SECURITY DEFINER, que corre como
-- dueño de la función (postgres) y por lo tanto no depende de GRANTs de RLS.
CREATE POLICY "admin_select_admin_log" ON admin_log
  FOR SELECT USING (es_admin());

-- Extiende el trigger de la migración 008: además de propagar el estado,
-- registra la acción del admin en admin_log cuando corresponde.
CREATE OR REPLACE FUNCTION fn_propagar_estado_verificacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.abogado_id IS NOT NULL THEN
      UPDATE abogados
      SET verificacion = NEW.estado
      WHERE id = NEW.abogado_id;
    END IF;

    IF NEW.estudio_id IS NOT NULL THEN
      UPDATE estudios
      SET verificacion = NEW.estado
      WHERE id = NEW.estudio_id;
    END IF;

    -- Registrar al revisor (auth.uid() puede ser NULL si lo hace un proceso interno)
    NEW.revisado_por = auth.uid();
    NEW.revisado_at  = now();

    -- Log de auditoría: solo para aprobar/rechazar hechos por un admin con sesión
    -- (auth.uid() IS NULL en procesos internos, que no cuentan como acción de admin).
    IF auth.uid() IS NOT NULL AND NEW.estado IN ('VERIFICADO', 'RECHAZADO') THEN
      INSERT INTO admin_log (admin_id, accion, verificacion_id)
      VALUES (auth.uid(), CASE NEW.estado WHEN 'VERIFICADO' THEN 'APROBAR' ELSE 'RECHAZAR' END, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────
-- Vista: log de acciones con nombre del admin y del abogado/estudio afectado.
-- Igual que las demás vistas del panel de administración (migración 018),
-- se ejecuta con los permisos de su dueño (postgres) y por lo tanto filtra
-- explícitamente con es_admin() en el WHERE.
-- ────────────────────────────────────────────────
CREATE OR REPLACE VIEW admin_log_detalle AS
SELECT
  al.id,
  al.accion,
  al.created_at,
  p_admin.nombre_completo AS admin_nombre,
  CASE WHEN v.abogado_id IS NOT NULL THEN 'abogado' ELSE 'estudio' END AS tipo,
  COALESCE(p_abogado.nombre_completo, e.nombre) AS nombre_afectado
FROM admin_log al
JOIN perfiles p_admin        ON p_admin.id = al.admin_id
JOIN verificaciones v        ON v.id = al.verificacion_id
LEFT JOIN perfiles p_abogado ON p_abogado.id = v.abogado_id
LEFT JOIN estudios  e        ON e.id = v.estudio_id
WHERE es_admin();

COMMENT ON VIEW admin_log_detalle IS 'Log de acciones del admin para el panel de administración. Filtra por es_admin() porque la vista no hereda el RLS de admin_log.';

GRANT SELECT ON admin_log_detalle TO authenticated;
