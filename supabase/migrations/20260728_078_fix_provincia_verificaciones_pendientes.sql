-- Fix: la provincia no aparece en las tarjetas de verificaciones pendientes
-- del panel admin.
--
-- Diagnóstico vía MCP:
-- - cedula_solicitante: YA lee correctamente p_abogado.cedula (perfiles del
--   abogado, no del cliente ni de otra tabla). Los NULL actuales en las 2
--   verificaciones PENDIENTE reales corresponden a colisiones de cédula
--   duplicada ya diagnosticadas y confirmadas contra trigger_errors (ver
--   CLAUDE.md §44) — no es un bug de esta vista, es el fallback documentado
--   de fn_crear_perfil_en_registro funcionando como se diseñó.
-- - provincia: SÍ era un bug real. La columna se armaba como
--   COALESCE(prov.nombre, e.provincia) — prov.nombre sale de
--   abogados.provincia_id, y fn_crear_fila_abogado() (trigger que crea la
--   fila de abogados al registrarse) NUNCA setea provincia_id (solo inserta
--   numero_registro y especialidades) — ese campo se completa recién cuando
--   el abogado edita su perfil desde editar-perfil-abogado.html, algo que
--   normalmente ocurre DESPUÉS de ser aprobado, no antes. e.provincia es
--   exclusivo de la rama estudio, nunca ayuda a un abogado individual. El
--   resultado: la provincia elegida en el formulario de registro (que sí se
--   guarda como texto libre en perfiles.provincia, vía
--   fn_crear_perfil_en_registro) nunca se mostraba al admin.
--
-- Fix: agregar p_abogado.provincia (texto libre de perfiles, siempre
-- disponible desde el registro) como fallback intermedio, antes que
-- e.provincia — así un abogado individual recién registrado, que todavía no
-- tiene provincia_id normalizado, igual muestra la provincia que declaró.

CREATE OR REPLACE VIEW admin_verificaciones_pendientes AS
SELECT
  v.id,
  v.estado,
  v.abogado_id,
  v.estudio_id,
  CASE WHEN v.abogado_id IS NOT NULL THEN 'abogado' ELSE 'estudio' END AS tipo,
  COALESCE(p_abogado.nombre_completo, p_estudio.nombre_completo) AS nombre_solicitante,
  e.nombre AS nombre_estudio,
  v.doc_carnet_url,
  v.doc_cedula_url,
  v.doc_cedula_reverso_url,
  v.doc_ruc_url,
  v.doc_nombramiento_url,
  v.created_at,
  COALESCE(p_abogado.foto_url, p_estudio.foto_url) AS foto_url,
  v.intentos_verificacion,
  p_abogado.cedula AS cedula_solicitante,
  ab.numero_registro,
  ab.especialidades,
  COALESCE(prov.nombre, p_abogado.provincia, e.provincia) AS provincia,
  e.ruc AS ruc_estudio
FROM verificaciones v
LEFT JOIN perfiles p_abogado ON p_abogado.id = v.abogado_id
LEFT JOIN estudios e ON e.id = v.estudio_id
LEFT JOIN perfiles p_estudio ON p_estudio.id = e.representante_legal_id
LEFT JOIN abogados ab ON ab.id = v.abogado_id
LEFT JOIN provincias prov ON prov.id = ab.provincia_id
WHERE v.estado = 'PENDIENTE' AND es_admin();

GRANT SELECT ON admin_verificaciones_pendientes TO authenticated;
