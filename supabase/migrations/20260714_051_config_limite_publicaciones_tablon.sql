-- Hace configurable el límite diario de casos publicados por cliente en El
-- Tablón (antes hardcodeado en 2 dentro de fn_verificar_limite_casos_tablon,
-- migración 040). Mismo patrón que limite_aplicaciones_abogado: NULL en
-- config_tablon = sin límite, editable desde panel-admin.html.

INSERT INTO config_tablon (clave, valor, descripcion) VALUES
  ('limite_publicaciones_diarias_cliente', '2', 'Máximo de casos que un cliente puede publicar por día. NULL = sin límite.');

CREATE OR REPLACE FUNCTION fn_verificar_limite_casos_tablon()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limite integer;
  v_conteo integer;
BEGIN
  SELECT valor::integer INTO v_limite
  FROM config_tablon
  WHERE clave = 'limite_publicaciones_diarias_cliente';

  IF v_limite IS NOT NULL THEN
    SELECT count(*) INTO v_conteo
    FROM casos_tablon
    WHERE cliente_id = NEW.cliente_id
      AND created_at::date = CURRENT_DATE;

    IF v_conteo >= v_limite THEN
      RAISE EXCEPTION 'Ya publicó el máximo de % casos hoy. Intente de nuevo mañana.', v_limite
        USING ERRCODE = 'P0001', HINT = 'LIMITE_CASOS_TABLON';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
