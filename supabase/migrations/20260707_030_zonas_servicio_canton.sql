-- 20260707_030_zonas_servicio_canton.sql
-- Permite que una zona de servicio adicional (abogado_zonas_servicio) especifique
-- un cantón puntual dentro de la provincia marcada, en vez de asumir siempre
-- "toda la provincia". Si canton_id es NULL, el abogado atiende en toda la
-- provincia; si tiene un valor, solo ese cantón específico dentro de ella.

ALTER TABLE abogado_zonas_servicio
  ADD COLUMN canton_id integer REFERENCES cantones(id);

COMMENT ON COLUMN abogado_zonas_servicio.canton_id IS 'Cantón específico dentro de provincia_id donde el abogado también atiende. NULL = toda la provincia.';

-- Valida que canton_id (si se especifica) pertenezca a la provincia_id de la
-- misma fila — evita datos inconsistentes (ej: "Cuenca" con provincia_id de Guayas).
CREATE OR REPLACE FUNCTION fn_validar_canton_zona_servicio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.canton_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cantones
      WHERE id = NEW.canton_id AND provincia_id = NEW.provincia_id
    ) THEN
      RAISE EXCEPTION 'canton_id % no pertenece a provincia_id %', NEW.canton_id, NEW.provincia_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_canton_zona_servicio
  BEFORE INSERT OR UPDATE ON abogado_zonas_servicio
  FOR EACH ROW EXECUTE FUNCTION fn_validar_canton_zona_servicio();

-- Sin GRANT nuevo (CLAUDE.md §12): la columna vive en una tabla ya otorgada
-- en la migración 028, y la función es de trigger — la invoca el motor de
-- PostgreSQL, no el usuario.
