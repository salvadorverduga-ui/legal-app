-- 20260706_016_cedula_indice_parcial.sql
-- Reemplaza el constraint UNIQUE de perfiles.cedula por un índice único
-- parcial que solo aplica cuando cedula NO es NULL.
--
-- CONTEXTO: el registro de cliente (frontend/js/registro.js) ya no recoge
-- cédula — un cliente solo da nombre completo, correo y contraseña. Los
-- abogados sí siguen usando cédula (identificación + verificación); los
-- estudios usan RUC, no cédula (ver fn_crear_fila_estudio, migración 013,
-- que nunca toca perfiles.cedula).
--
-- perfiles.cedula ya era nullable (sin NOT NULL, migración 001) — eso no
-- cambia acá. Lo que se explicita con el índice parcial es que la unicidad
-- solo se evalúa entre cédulas reales, nunca entre perfiles sin cédula
-- (clientes y estudios). En Postgres, un UNIQUE constraint estándar ya trata
-- cada NULL como distinto entre sí (no genera conflicto), así que el
-- comportamiento en la práctica no cambia — este índice deja esa intención
-- explícita en el esquema en vez de depender del comportamiento por defecto.
--
-- El nombre del constraint original (creado inline con "cedula text UNIQUE"
-- en la migración 001) sigue la convención de Postgres para constraints de
-- una sola columna: perfiles_cedula_key.

ALTER TABLE perfiles DROP CONSTRAINT IF EXISTS perfiles_cedula_key;

CREATE UNIQUE INDEX IF NOT EXISTS perfiles_cedula_unique
  ON perfiles(cedula)
  WHERE cedula IS NOT NULL;

COMMENT ON COLUMN perfiles.cedula IS 'Cédula de identidad. Obligatoria para abogados individuales; NULL para clientes y para estudios (que usan RUC en la tabla estudios). Única entre los perfiles que sí tienen cédula (índice parcial perfiles_cedula_unique).';
