-- 20260817_089_trigger_validar_urls_chat.sql
-- Fix HIGH 2 de la auditoría de Codex: el filtro de URLs del chat
-- (REGEX_URL_CHAT en api.js) solo corre en el cliente -- cualquiera con
-- acceso directo a la REST API de Supabase (o simplemente editando el
-- request antes de que salga del navegador) puede saltárselo por completo,
-- ya que RLS no valida el contenido de los mensajes, solo quién puede
-- insertarlos.
--
-- Fix: trigger BEFORE INSERT que valida el contenido en la base de datos,
-- como última línea de defensa real. Cubre más casos que el regex del
-- cliente: http(s)://, ftp://, mailto:, www. (con o sin espacios alrededor
-- del punto), y dominios sueltos sin protocolo (ej. "ejemplo.com", con o sin
-- espacios alrededor del punto) contra una lista de TLD comunes -- no existe
-- una forma 100% precisa de detectar "cualquier dominio posible" sin falsos
-- positivos, así que se prioriza cubrir los casos reales de evasión sobre
-- una precisión perfecta.

CREATE OR REPLACE FUNCTION fn_validar_sin_urls_mensaje()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- \y (no \b): en el motor de expresiones regulares de Postgres (ARE), \b
  -- dentro del patrón NO es "límite de palabra" como en Perl/PCRE -- es una
  -- convención distinta que acá simplemente no matchea nunca. El límite de
  -- palabra real en Postgres es \y. Verificado en vivo: con \b, "ejemplo.com"
  -- suelto en una oración no se bloqueaba; con \y, sí.
  IF NEW.contenido ~* '(https?://|ftp://|mailto:|www\s*\.|[a-z0-9]([a-z0-9-]*[a-z0-9])?\s*\.\s*(com|net|org|io|co|info|biz|gov|edu|me|app|dev|xyz|online|site|link|click|shop|store|top|ec|es|mx|ar|cl|pe|uy|py|bo|co\.uk|uk|us|ca|br)\y)' THEN
    RAISE EXCEPTION 'No se permiten enlaces externos en el chat.'
      USING HINT = 'URL_NO_PERMITIDA';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_validar_sin_urls_mensaje() IS
  'Última línea de defensa contra enlaces externos en el chat (fix 089) -- complementa, no reemplaza, la validación client-side de REGEX_URL_CHAT en api.js. El hint URL_NO_PERMITIDA lo traduce api.chat.enviarMensaje() al mismo mensaje amigable que ya usa el chequeo del cliente.';

DROP TRIGGER IF EXISTS trg_validar_sin_urls_mensaje ON mensajes;
CREATE TRIGGER trg_validar_sin_urls_mensaje
  BEFORE INSERT ON mensajes
  FOR EACH ROW EXECUTE FUNCTION fn_validar_sin_urls_mensaje();
