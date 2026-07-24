-- 20260725_061_verificacion_pendiente_automatica.sql
-- Fix (smoke test): el panel admin no mostraba verificaciones pendientes al
-- registrarse un abogado nuevo. Diagnóstico (verificado en producción vía MCP):
-- `verificaciones` solo tenía 1 fila total, y `fn_crear_fila_abogado` nunca
-- insertaba en esa tabla — la única vía existente era
-- api.abogados.enviarDocumentosVerificacion() (frontend/js/api.js), que solo
-- corre cuando `data.session` viene truthy desde el signUp. Con confirmación
-- de correo obligatoria (el flujo real de producción), signUp nunca devuelve
-- sesión de inmediato, así que esa función jamás se ejecuta en el registro
-- real y ningún abogado nuevo generaba fila en `verificaciones`. Por eso
-- `admin_verificaciones_pendientes` (vista, migración 018) siempre retornaba
-- vacío pese a haber abogados nuevos esperando revisión.

-- fn_crear_fila_abogado gana un segundo bloque BEGIN/EXCEPTION (subtransacción
-- independiente, mismo criterio que el bloque de referidos ya existente en
-- esta función y que 20260706_014_fix_triggers.sql documentó para toda esta
-- familia de triggers): si el INSERT en verificaciones fallara, no debe
-- revertir la fila ya creada en `abogados`.
CREATE OR REPLACE FUNCTION fn_crear_fila_abogado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta           jsonb;
  v_email          text;
  v_codigo_ref     text;
  v_referidor_id   uuid;
BEGIN
  IF NEW.rol = 'abogado' THEN
    BEGIN
      SELECT raw_user_meta_data, email INTO v_meta, v_email FROM auth.users WHERE id = NEW.id;

      INSERT INTO abogados (id, numero_registro, especialidades)
      VALUES (
        NEW.id,
        v_meta->>'numero_carnet',
        COALESCE(
          (SELECT array_agg(valor) FROM jsonb_array_elements_text(v_meta->'especialidades') AS valor),
          '{}'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO trigger_errors (funcion, mensaje, datos)
      VALUES (
        'fn_crear_fila_abogado',
        SQLERRM,
        jsonb_build_object('perfil_id', NEW.id, 'raw_user_meta_data', v_meta)
      );
    END;

    -- Verificación pendiente automática: se crea vacía (sin documentos) para
    -- que el abogado entre de inmediato a la cola del admin. Si el signUp sí
    -- trajo sesión activa (docs subidos en el mismo registro), esta misma
    -- fila se completa por UPDATE desde enviarDocumentosVerificacion en vez
    -- de crear una fila nueva (ver política abogado_actualiza_verificacion_pendiente
    -- más abajo) — así nunca hay dos filas PENDIENTE para el mismo abogado.
    BEGIN
      INSERT INTO verificaciones (abogado_id, estado)
      VALUES (NEW.id, 'PENDIENTE');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO trigger_errors (funcion, mensaje, datos)
      VALUES (
        'fn_crear_fila_abogado:verificacion',
        SQLERRM,
        jsonb_build_object('perfil_id', NEW.id)
      );
    END;

    BEGIN
      v_codigo_ref := upper(trim(v_meta->>'ref'));

      IF v_codigo_ref IS NOT NULL AND v_codigo_ref <> '' THEN
        SELECT id INTO v_referidor_id FROM abogados WHERE codigo_referido = v_codigo_ref;

        IF v_referidor_id IS NOT NULL AND v_referidor_id <> NEW.id THEN
          INSERT INTO referidos (referidor_id, referido_email, codigo_referido, estado)
          VALUES (v_referidor_id, v_email, v_codigo_ref, 'COMPLETADO');

          INSERT INTO suscripciones (abogado_id, tipo, estado, monto, fecha_vencimiento, metodo_pago, notas_admin)
          VALUES (
            v_referidor_id,
            'ABOGADO_INDIVIDUAL',
            'ACTIVA',
            0,
            (GREATEST(COALESCE((SELECT suscripcion_vigente_hasta FROM abogados WHERE id = v_referidor_id), CURRENT_DATE), CURRENT_DATE) + INTERVAL '30 days')::date,
            'REFERIDO',
            'Mes gratis — programa de referidos'
          );

          INSERT INTO suscripciones (abogado_id, tipo, estado, monto, fecha_vencimiento, metodo_pago, notas_admin)
          VALUES (
            NEW.id,
            'ABOGADO_INDIVIDUAL',
            'ACTIVA',
            0,
            (CURRENT_DATE + INTERVAL '30 days')::date,
            'REFERIDO',
            'Mes gratis — programa de referidos'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO trigger_errors (funcion, mensaje, datos)
      VALUES (
        'fn_crear_fila_abogado:referidos',
        SQLERRM,
        jsonb_build_object('perfil_id', NEW.id, 'codigo_ref', v_codigo_ref)
      );
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- El abogado puede completar (UPDATE) los documentos de su propia fila
-- PENDIENTE — nunca cambiar estado, revisor ni motivo de rechazo (esos
-- quedan "congelados" comparando contra la fila actual, mismo patrón que
-- 20260707_033_editar_solicitud.sql).
CREATE POLICY "abogado_actualiza_verificacion_pendiente" ON verificaciones
  FOR UPDATE
  USING (abogado_id = auth.uid())
  WITH CHECK (
    abogado_id = auth.uid()
    AND (SELECT estado FROM verificaciones WHERE id = verificaciones.id) = 'PENDIENTE'
    AND estado = 'PENDIENTE'
    AND revisado_por   IS NOT DISTINCT FROM (SELECT revisado_por   FROM verificaciones WHERE id = verificaciones.id)
    AND revisado_at    IS NOT DISTINCT FROM (SELECT revisado_at    FROM verificaciones WHERE id = verificaciones.id)
    AND motivo_rechazo IS NOT DISTINCT FROM (SELECT motivo_rechazo FROM verificaciones WHERE id = verificaciones.id)
  );

COMMENT ON POLICY "abogado_actualiza_verificacion_pendiente" ON verificaciones IS
  'Permite al abogado adjuntar sus documentos a la fila PENDIENTE creada automáticamente por el trigger, sin poder tocar estado, revisor ni motivo de rechazo.';

-- Backfill: abogados existentes que nunca generaron ninguna fila en
-- verificaciones (registrados antes de este fix) quedan sin cola visible
-- para el admin. Se les crea una fila PENDIENTE salvo que ya tengan alguna
-- fila de verificaciones (para no duplicar en los pocos casos de prueba que
-- sí llegaron a insertar vía enviarDocumentosVerificacion).
INSERT INTO verificaciones (abogado_id, estado)
SELECT a.id, 'PENDIENTE'
FROM abogados a
WHERE NOT EXISTS (SELECT 1 FROM verificaciones v WHERE v.abogado_id = a.id)
  AND a.verificacion = 'PENDIENTE';
