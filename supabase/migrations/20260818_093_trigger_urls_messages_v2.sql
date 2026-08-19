-- 20260818_093_trigger_urls_messages_v2.sql
-- Mismo fix que 20260817_089_trigger_validar_urls_chat.sql, aplicado a la
-- tabla `messages` de chat v2 (migración 092): la validación de URLs de
-- api.mensajes.enviar() (REGEX_URL_MENSAJE) solo corre en el cliente y se
-- puede saltear llamando a la REST API de Supabase directamente, ya que RLS
-- no valida el contenido de los mensajes, solo quién puede insertarlos.
--
-- Trigger BEFORE INSERT como última línea de defensa real, mismo regex y
-- mismo criterio que la 089 (http(s)://, ftp://, mailto:, www., y dominios
-- sueltos tipo "ejemplo.com" contra una lista de TLD comunes) -- solo cambia
-- la columna validada (NEW.body en vez de NEW.contenido) y el texto del
-- mensaje, para que coincida con la terminología de chat v2 ("mensajes", no
-- "chat").

CREATE OR REPLACE FUNCTION fn_validar_sin_urls_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- \y (no \b): en el motor de expresiones regulares de Postgres (ARE), \b
  -- dentro del patrón NO es "límite de palabra" como en Perl/PCRE -- es una
  -- convención distinta que acá simplemente no matchea nunca. El límite de
  -- palabra real en Postgres es \y. Verificado en vivo (migración 089): con
  -- \b, "ejemplo.com" suelto en una oración no se bloqueaba; con \y, sí.
  IF NEW.body ~* '(https?://|ftp://|mailto:|www\s*\.|[a-z0-9]([a-z0-9-]*[a-z0-9])?\s*\.\s*(com|net|org|io|co|info|biz|gov|edu|me|app|dev|xyz|online|site|link|click|shop|store|top|ec|es|mx|ar|cl|pe|uy|py|bo|co\.uk|uk|us|ca|br)\y)' THEN
    RAISE EXCEPTION 'No se permiten enlaces externos en los mensajes.'
      USING HINT = 'URL_NO_PERMITIDA';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_validar_sin_urls_message() IS
  'Última línea de defensa contra enlaces externos en chat v2 (mismo fix que fn_validar_sin_urls_mensaje, migración 089, aplicado a la tabla messages) -- complementa, no reemplaza, la validación client-side de REGEX_URL_MENSAJE en api.js. El hint URL_NO_PERMITIDA lo traduce api.mensajes.enviar() al mismo mensaje amigable que ya usa el chequeo del cliente.';

DROP TRIGGER IF EXISTS trg_validar_sin_urls_message ON messages;
CREATE TRIGGER trg_validar_sin_urls_message
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sin_urls_message();
