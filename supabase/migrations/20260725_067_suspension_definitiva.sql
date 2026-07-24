-- 20260725_067_suspension_definitiva.sql
-- Estado SUSPENDIDO para verificaciones: cierre definitivo de una cuenta de
-- abogado/estudio que no pudo acreditar su ejercicio profesional tras
-- agotar sus intentos de verificación (§ límite de 3 intentos, ver
-- api.abogados.enviarDocumentosVerificacion), o que el admin decide
-- suspender directamente desde el panel. Es irreversible desde la app.

-- 'SUSPENDIDO' ya existía en el enum desde su definición original
-- (20260625_002_estudios.sql) — nunca se había usado hasta ahora. Se deja
-- este ADD VALUE IF NOT EXISTS de todos modos (sin efecto real acá) para
-- que la migración sea correcta también si el enum se recreara sin ese
-- valor en otro entorno.
ALTER TYPE estado_verificacion ADD VALUE IF NOT EXISTS 'SUSPENDIDO';

-- Cuenta los envíos de documentos del abogado/estudio — incrementado en
-- api.abogados.enviarDocumentosVerificacion()/api.estudios.enviarDocumentosVerificacion()
-- para hacer cumplir el límite de 3 intentos antes de requerir contacto
-- manual con soporte.
ALTER TABLE verificaciones ADD COLUMN IF NOT EXISTS intentos_verificacion integer NOT NULL DEFAULT 0;

-- Bloquea el login del usuario suspendido — app.js cierra la sesión
-- automáticamente si perfiles.suspendido = true (ver frontend/js/app.js).
-- Vive en perfiles, no en abogados/estudios, porque ese chequeo corre para
-- cualquier rol que inicie sesión, aunque en este MVP solo abogados/estudios
-- puedan terminar suspendidos.
ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS suspendido boolean NOT NULL DEFAULT false;

-- El admin necesita poder marcar perfiles.suspendido = true en la fila de
-- OTRO usuario. perfil_propio_update (migración 20260625_001) solo permite
-- a cada quien editar su propia fila, y no existía ninguna política de
-- UPDATE para admin sobre esta tabla — admin_select_perfiles solo cubre
-- SELECT. Sin restricción de columnas, mismo criterio que
-- admin_update_verificaciones (que tampoco las restringe): el admin ya es
-- un rol de confianza total sobre las tablas que administra (CLAUDE.md §12).
CREATE POLICY "admin_update_perfiles" ON perfiles
  FOR UPDATE
  USING (es_admin());

COMMENT ON POLICY "admin_update_perfiles" ON perfiles IS
  'Permite al admin marcar perfiles.suspendido = true (u otros campos administrativos futuros) en la fila de cualquier usuario.';

-- SUSPENDIDO ya queda irreversible para el propio abogado sin ningún cambio
-- de RLS adicional: "abogado_actualiza_verificacion_pendiente" (creada en
-- 20260725_061, reescrita para evitar recursión en 20260726_066) exige que
-- el estado ANTERIOR de la fila sea PENDIENTE para poder actualizarla, y que
-- el estado NUEVO también sea PENDIENTE — una fila SUSPENDIDO nunca cumple
-- ninguna de las dos condiciones, así que cualquier intento de UPDATE del
-- abogado sobre su propia fila suspendida (o de revertir una suspensión) es
-- rechazado por RLS. Solo "admin_update_verificaciones" (USING es_admin(),
-- sin restricción de estado previo ni nuevo) puede escribir ese valor.
COMMENT ON COLUMN verificaciones.estado IS
  'PENDIENTE -> VERIFICADO (admin aprueba) o RECHAZADO (admin rechaza, motivo_rechazo explica por qué). RECHAZADO permite reintentar: el abogado vuelve a subir documentos y la fila vuelve a PENDIENTE (máx. 3 intentos, ver intentos_verificacion). SUSPENDIDO es definitivo: solo lo escribe un admin vía admin_update_verificaciones; irreversible para el propio abogado/estudio por RLS.';
