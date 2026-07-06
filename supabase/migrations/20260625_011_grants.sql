-- ============================================================
-- 20260625_011_grants.sql
-- Permisos mínimos (mínimo privilegio) para los roles anon y
-- authenticated sobre todas las tablas, vistas y funciones RPC
-- del sistema.
--
-- POR QUÉ ESTE ARCHIVO EXISTE
-- En Supabase/PostgreSQL hay dos capas de acceso complementarias:
--
--   1. GRANT  — define qué operaciones puede intentar un rol sobre
--               un objeto (tabla, vista, función).
--   2. RLS    — define qué filas puede ver o modificar ese rol
--               una vez que la operación está permitida.
--
-- Sin GRANT: PostgREST devuelve "permission denied" antes de que
--   RLS tenga oportunidad de evaluarse.
-- Sin RLS:   el rol puede ver todas las filas, ignorando la lógica
--   de negocio (abogado ve solicitudes de otros, etc.).
-- Ambas capas son obligatorias.
--
-- REGLA (ver CLAUDE.md §12):
-- Todo objeto nuevo (tabla, vista, función RPC) debe tener su GRANT
-- en el mismo PR donde se crea. No dejar GRANTs pendientes.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- SCHEMA
-- PostgREST necesita USAGE en el schema public para resolver
-- cualquier objeto (tablas, vistas, funciones). Sin este GRANT
-- todos los queries fallan con "schema not found".
-- Se otorga a ambos roles porque anon necesita al menos poder
-- llamar funciones de utilidad pre-login (ej: get_server_date).
-- ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- FUNCIÓN AUXILIAR: es_admin()
-- Las políticas RLS de la mayoría de tablas llaman a es_admin()
-- para abrir paso a los administradores. Si el rol que ejecuta
-- el query no tiene EXECUTE sobre esta función, PostgreSQL lanza
-- "permission denied for function es_admin" al evaluar la
-- política, bloqueando el query aunque la política debería
-- simplemente retornar false para ese usuario.
-- Se otorga a anon también: las políticas RLS se evalúan incluso
-- cuando un usuario anónimo intenta acceder a una tabla, aunque
-- en la práctica no le hayamos dado GRANT SELECT sobre ella.
-- es_admin() es SECURITY DEFINER, así que no expone datos aunque
-- sea callable.
-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION es_admin() TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: perfiles
--
-- SELECT:  todo usuario autenticado puede leer perfiles. El RLS
--          restringe a: perfil propio, abogados visibles cuya
--          solicitud está activa, y admin que ve todo.
-- UPDATE:  el usuario edita su propio perfil. WITH CHECK en RLS
--          impide cambiar el campo rol o la foto de otra persona.
-- INSERT:  NO se otorga. El trigger fn_crear_perfil_en_registro
--          crea la fila automáticamente al registrarse en
--          auth.users (corre con service_role). Permitir INSERT
--          directo abriría la posibilidad de crear perfiles con
--          rol='admin' sin pasar por el flujo de registro.
-- DELETE:  NO. Las cuentas se desactivan, no se borran.
-- anon:    sin acceso. La landing page no consulta perfiles.
-- ────────────────────────────────────────────────────────────
GRANT SELECT, UPDATE ON TABLE perfiles TO authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: estudios
--
-- SELECT:  clientes y abogados ven datos públicos del estudio
--          (nombre, logo, verificacion).
-- INSERT:  el representante legal crea su estudio. RLS exige
--          que el usuario tenga rol='abogado'.
-- UPDATE:  el representante actualiza datos. RLS bloquea que
--          cambie verificacion o suscripcion_vigente_hasta.
-- DELETE:  NO. Baja lógica: el estudio se desactiva.
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE estudios TO authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: redes_colaboradores
--
-- SELECT:  abogados y clientes ven las redes (búsqueda).
-- INSERT:  abogados crean redes. RLS valida rol='abogado'.
-- UPDATE:  el creador actualiza el nombre/logo de su red.
-- DELETE:  NO. Si se disuelve una red, se gestionan los
--          miembros y la red queda sin actividad.
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE redes_colaboradores TO authenticated;

-- TABLA: red_miembros (junction de redes_colaboradores)
-- SELECT:  miembros y admin ven quién forma parte de cada red.
-- INSERT:  el creador de la red agrega miembros. RLS valida
--          que el usuario sea el creador.
-- DELETE:  el creador elimina miembros. RLS igual.
--          Aquí sí se otorga DELETE porque un miembro puede
--          ser retirado de la red (acción reversible a nivel
--          de negocio: se puede volver a agregar).
-- UPDATE:  no hay columnas actualizables en red_miembros
--          (joined_at es inmutable). No se otorga.
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, DELETE ON TABLE red_miembros TO authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: abogados
--
-- SELECT:  clientes buscan abogados. RLS aplica la condición
--          triple de visibilidad (verificado + disponible +
--          suscripción vigente/gracia). La vista busqueda_abogados
--          es el canal recomendado para búsquedas; el GRANT
--          directo en la tabla permite que otras políticas
--          cruzadas funcionen.
-- UPDATE:  el abogado actualiza su perfil profesional
--          (especialidades, descripcion, precio_consulta, etc.).
--          RLS bloquea cambio de verificacion y
--          suscripcion_vigente_hasta.
-- INSERT:  NO se otorga. El trigger fn_crear_fila_abogado
--          crea la fila al insertar en perfiles con rol='abogado'.
--          Permitir INSERT directo saltaría el trigger y dejaría
--          la fila en estado inconsistente.
-- DELETE:  NO. Perfil se desactiva, no se borra.
-- ────────────────────────────────────────────────────────────
GRANT SELECT, UPDATE ON TABLE abogados TO authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: suscripciones
--
-- SELECT:  el abogado/representante ve su historial de pagos.
--          RLS filtra a las suscripciones propias.
-- INSERT:  NO. El admin registra pagos manualmente con
--          service_role, o lo hará una Edge Function de pago.
--          Otorgar INSERT a authenticated permitiría que un
--          abogado registre su propia suscripción sin haber
--          pagado, rompiendo el modelo de negocio.
-- UPDATE:  NO. Por la misma razón; el admin gestiona con
--          service_role.
-- DELETE:  NO. Historial de pagos es inmutable.
-- ────────────────────────────────────────────────────────────
GRANT SELECT ON TABLE suscripciones TO authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: solicitudes
--
-- SELECT:  cada parte ve sus propias solicitudes. RLS filtra
--          por cliente_id = auth.uid() O abogado_id = auth.uid().
-- INSERT:  clientes crean solicitudes. RLS exige rol='cliente'.
-- UPDATE:  abogado acepta/rechaza (PENDIENTE→ACEPTADA/RECHAZADA).
--          Cliente marca COMPLETADA. RLS valida cada transición.
-- DELETE:  NO. El ciclo de vida de la solicitud es por estados;
--          nunca se borran (trazabilidad).
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE solicitudes TO authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: resenas
--
-- SELECT:  reseñas públicas (oculta=false) son accesibles para
--          todo usuario autenticado. RLS filtra ocultas excepto
--          para admin.
-- INSERT:  clientes crean reseñas. RLS verifica que el
--          solicitud_id pertenece al cliente y está COMPLETADA.
-- UPDATE:  abogado agrega respuesta; admin modera (oculta=true).
--          RLS diferencia qué campos puede tocar cada rol.
-- DELETE:  NO. Las reseñas nunca se borran físicamente;
--          se ocultan con oculta=true. Permitir DELETE daría la
--          posibilidad (ante un bug de RLS) de eliminar reseñas
--          negativas.
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE resenas TO authenticated;


-- ────────────────────────────────────────────────────────────
-- TABLA: verificaciones
--
-- SELECT:  el abogado/representante ve el estado de su propio
--          proceso de verificación. RLS filtra por entidad propia.
-- INSERT:  el solicitante sube sus documentos. RLS valida que
--          está insertando para su propia entidad.
-- UPDATE:  el admin aprueba o rechaza (estado PENDIENTE→
--          VERIFICADO/RECHAZADO). RLS restringe UPDATE a admin.
--          El trigger fn_propagar_estado_verificacion copia el
--          estado a abogados.verificacion o estudios.verificacion.
-- DELETE:  NO. Historial de verificaciones es inmutable.
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE verificaciones TO authenticated;


-- ────────────────────────────────────────────────────────────
-- VISTAS
-- En PostgreSQL las vistas se ejecutan con los permisos de su
-- dueño (postgres), no del usuario que la consulta. Por eso:
--   • El usuario solo necesita SELECT en la vista, no en las
--     tablas subyacentes que la vista consulta internamente.
--   • Las vistas ya tienen su propio WHERE clause de seguridad.
-- Sin GRANT SELECT, PostgREST devuelve "permission denied for
-- view X" aunque las tablas subyacentes sean accesibles.
-- anon: NO accede a ninguna vista. La búsqueda requiere sesión.
-- ────────────────────────────────────────────────────────────

-- Vista de búsqueda pública de abogados.
-- La vista ya filtra por las 3 condiciones de visibilidad:
-- verificacion='VERIFICADO' AND toggle_disponible=true AND
-- suscripcion dentro de período de gracia. No expone teléfono
-- ni email del cliente.
GRANT SELECT ON busqueda_abogados TO authenticated;

-- Panel del abogado: lista de solicitudes recibidas.
-- La vista usa auth.uid() en su WHERE, así que cada abogado
-- solo ve sus propias solicitudes aunque tenga SELECT en la vista.
-- Expone cliente_telefono y cliente_email, que son NULL hasta
-- que el trigger fn_revelar_contacto_al_aceptar los completa.
GRANT SELECT ON panel_solicitudes_abogado TO authenticated;

-- Panel del cliente: lista de solicitudes enviadas.
-- Incluye el flag tiene_resena para controlar si puede reseñar.
-- La vista filtra por auth.uid() igual que la del abogado.
GRANT SELECT ON panel_solicitudes_cliente TO authenticated;


-- ────────────────────────────────────────────────────────────
-- FUNCIONES RPC
-- Las funciones trigger (fn_actualizar_updated_at, fn_crear_*,
-- fn_sincronizar_*, fn_revelar_*, fn_recalcular_*,
-- fn_propagar_*) son invocadas por el motor de PostgreSQL cuando
-- se dispara el trigger. El usuario no las llama directamente;
-- PostgreSQL no requiere EXECUTE grant para funciones trigger.
-- Solo se otorga EXECUTE a funciones llamables desde el cliente
-- vía supabase.rpc().
--
-- get_server_date() y abogado_es_visible() ya tienen GRANT en
-- migration 010. Se repiten aquí como fuente de verdad única
-- y por si la migration 010 se aplica sin sus GRANTs por error.
-- GRANT es idempotente: ejecutarlo dos veces no causa errores.
-- ────────────────────────────────────────────────────────────

-- Fecha del servidor: disponible pre-autenticación (anon) para
-- futuros casos de uso en landing page y para authenticated.
-- Evita manipulación del reloj del cliente.
GRANT EXECUTE ON FUNCTION get_server_date()        TO anon, authenticated;

-- Verificación de visibilidad de un abogado por id.
-- Callable desde el cliente antes de enviar una solicitud,
-- para mostrar feedback inmediato sin depender de la vista.
-- Solo authenticated: un usuario sin sesión no debería necesitar
-- verificar si un abogado específico está visible.
GRANT EXECUTE ON FUNCTION abogado_es_visible(uuid) TO authenticated;
