-- 20260707_021_storage_verificacion_docs.sql
-- Configura el bucket verificacion-docs (carnets, cédulas, RUC, nombramientos)
-- para que solo la entidad dueña del documento y el admin puedan leerlo.
--
-- Estos son documentos de identidad — CLAUDE.md §10.3/PRD §11 (LOPDP: "datos de
-- verificación profesional bajo resguardo especial"). A diferencia de
-- 'avatares'/'logos' (públicos, ver frontend/js/api.js storage.getPublicUrl),
-- este bucket NUNCA debe ser público: si lo fuera, cualquiera con la URL vería
-- el documento sin que importen las políticas de abajo (Storage RLS no aplica
-- a objetos servidos desde un bucket público).
--
-- Convención de carpetas (definida en frontend/js/api.js _subirDocumento):
--   verificacion-docs/{carpetaId}/{prefijo}-{timestamp}.{ext}
-- Donde carpetaId es:
--   - abogado individual: su propio auth.uid() (= abogados.id = perfiles.id)
--   - estudio: estudios.id — NO es igual a auth.uid() del representante legal,
--     por eso hace falta una política aparte que resuelva estudios.id a partir
--     de representante_legal_id = auth.uid().

-- Crea el bucket si no existe, y fuerza public=false si ya existía
-- (por si se creó como público desde el Dashboard por error).
INSERT INTO storage.buckets (id, name, public)
VALUES ('verificacion-docs', 'verificacion-docs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ────────────────────────────────────────────────
-- SELECT (ver/descargar el documento)
-- ────────────────────────────────────────────────

CREATE POLICY "verificacion_docs_abogado_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "verificacion_docs_estudio_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM estudios WHERE representante_legal_id = auth.uid()
    )
  );

CREATE POLICY "verificacion_docs_admin_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'verificacion-docs'
    AND es_admin()
  );

-- ────────────────────────────────────────────────
-- INSERT / UPDATE (subir el documento — _subirDocumento usa upsert:true,
-- que en Storage requiere también UPDATE por si el path colisiona)
-- ────────────────────────────────────────────────

CREATE POLICY "verificacion_docs_abogado_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "verificacion_docs_abogado_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "verificacion_docs_estudio_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM estudios WHERE representante_legal_id = auth.uid()
    )
  );

CREATE POLICY "verificacion_docs_estudio_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM estudios WHERE representante_legal_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'verificacion-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM estudios WHERE representante_legal_id = auth.uid()
    )
  );

-- Sin política DELETE: los documentos de verificación nunca se borran desde
-- el cliente (mismo criterio que la tabla verificaciones — historial inmutable).
-- Sin política admin_update/insert: el admin nunca sube documentos, solo revisa
-- (aprueba/rechaza) la fila en la tabla verificaciones — no necesita escribir en Storage.
