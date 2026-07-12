-- 20260707_029_datos_prueba.sql
-- Datos de prueba: 5 abogados ficticios, verificados, disponibles y con
-- suscripción vigente, para poder probar en QA/staging el filtro de
-- búsqueda por provincia, el badge "También atiende en...", y el
-- ordenamiento por rating dentro de cada grupo (principal vs. zona de
-- servicio adicional).
--
-- Identificación y limpieza: todos los usuarios de prueba usan el dominio
-- @legalec.test en su email, así que se pueden borrar por completo con:
--   DELETE FROM auth.users WHERE email LIKE '%@legalec.test';
-- (el ON DELETE CASCADE de perfiles/abogados/suscripciones/
-- abogado_zonas_servicio se encarga del resto).
--
-- Por qué INSERT directo en auth.users y no auth.create_user(): esa función
-- pertenece a la API de administración de GoTrue (se invoca vía
-- supabase.auth.admin.createUser() desde JS), no existe como función SQL
-- invocable dentro de una migración. El INSERT directo replica el mismo
-- resultado y deja que los triggers existentes (fn_crear_perfil_en_registro,
-- fn_crear_fila_abogado) completen perfiles/abogados automáticamente a
-- partir de raw_user_meta_data, igual que en un registro real (migración 013).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────
-- Usuarios de prueba (dispara fn_crear_perfil_en_registro → fn_crear_fila_abogado)
-- ────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change, is_sso_user, is_anonymous
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated',
    'abogado.prueba1@legalec.test',
    crypt('Prueba123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'rol', 'abogado',
      'nombre_completo', 'Ana María Torres',
      'cedula', '1000000001',
      'provincia', 'Pichincha',
      'numero_carnet', 'AB-1001',
      'especialidades', jsonb_build_array('Derecho de familia')
    ),
    now(), now(), '', '', '', '', false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated',
    'abogado.prueba2@legalec.test',
    crypt('Prueba123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'rol', 'abogado',
      'nombre_completo', 'Carlos Andrade',
      'cedula', '1000000002',
      'provincia', 'Pichincha',
      'numero_carnet', 'AB-1002',
      'especialidades', jsonb_build_array('Derecho laboral')
    ),
    now(), now(), '', '', '', '', false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated',
    'abogado.prueba3@legalec.test',
    crypt('Prueba123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'rol', 'abogado',
      'nombre_completo', 'Lucía Vera',
      'cedula', '1000000003',
      'provincia', 'Guayas',
      'numero_carnet', 'AB-1003',
      'especialidades', jsonb_build_array('Derecho penal')
    ),
    now(), now(), '', '', '', '', false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000004',
    'authenticated', 'authenticated',
    'abogado.prueba4@legalec.test',
    crypt('Prueba123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'rol', 'abogado',
      'nombre_completo', 'Jorge Salazar',
      'cedula', '1000000004',
      'provincia', 'Guayas',
      'numero_carnet', 'AB-1004',
      'especialidades', jsonb_build_array('Derecho civil')
    ),
    now(), now(), '', '', '', '', false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000005',
    'authenticated', 'authenticated',
    'abogado.prueba5@legalec.test',
    crypt('Prueba123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'rol', 'abogado',
      'nombre_completo', 'Patricia Cordero',
      'cedula', '1000000005',
      'provincia', 'Azuay',
      'numero_carnet', 'AB-1005',
      'especialidades', jsonb_build_array('Derecho mercantil')
    ),
    now(), now(), '', '', '', '', false, false
  );

-- ────────────────────────────────────────────────────────────
-- Completa los datos profesionales que la metadata de registro no cubre:
-- ubicación normalizada (provincia_id/canton_id), verificación, disponibilidad,
-- descripción, precio y ratings distintos para probar el ordenamiento.
-- ────────────────────────────────────────────────────────────
UPDATE abogados SET
  descripcion = 'Abogada especializada en derecho de familia, con enfoque en divorcios y custodia.',
  precio_consulta = 25.00,
  provincia_id = (SELECT id FROM provincias WHERE nombre = 'Pichincha'),
  canton_id    = (SELECT id FROM cantones WHERE nombre = 'Quito' AND provincia_id = (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  verificacion = 'VERIFICADO',
  toggle_disponible = true,
  rating_promedio = 4.80,
  total_resenas = 12
WHERE id = 'f0000000-0000-0000-0000-000000000001';

UPDATE abogados SET
  descripcion = 'Asesoría en derecho laboral: despidos, liquidaciones y contratos.',
  precio_consulta = 20.00,
  provincia_id = (SELECT id FROM provincias WHERE nombre = 'Pichincha'),
  canton_id    = (SELECT id FROM cantones WHERE nombre = 'Rumiñahui' AND provincia_id = (SELECT id FROM provincias WHERE nombre = 'Pichincha')),
  verificacion = 'VERIFICADO',
  toggle_disponible = true,
  rating_promedio = 3.60,
  total_resenas = 5
WHERE id = 'f0000000-0000-0000-0000-000000000002';

UPDATE abogados SET
  descripcion = 'Defensa penal con más de 10 años de experiencia en litigio.',
  precio_consulta = 35.00,
  provincia_id = (SELECT id FROM provincias WHERE nombre = 'Guayas'),
  canton_id    = (SELECT id FROM cantones WHERE nombre = 'Guayaquil' AND provincia_id = (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  verificacion = 'VERIFICADO',
  toggle_disponible = true,
  rating_promedio = 4.30,
  total_resenas = 20
WHERE id = 'f0000000-0000-0000-0000-000000000003';

UPDATE abogados SET
  descripcion = 'Derecho civil: contratos, arrendamientos y responsabilidad civil.',
  precio_consulta = 18.00,
  provincia_id = (SELECT id FROM provincias WHERE nombre = 'Guayas'),
  canton_id    = (SELECT id FROM cantones WHERE nombre = 'Durán' AND provincia_id = (SELECT id FROM provincias WHERE nombre = 'Guayas')),
  verificacion = 'VERIFICADO',
  toggle_disponible = true,
  rating_promedio = 2.90,
  total_resenas = 3
WHERE id = 'f0000000-0000-0000-0000-000000000004';

UPDATE abogados SET
  descripcion = 'Derecho mercantil y societario para pequeñas y medianas empresas.',
  precio_consulta = 30.00,
  provincia_id = (SELECT id FROM provincias WHERE nombre = 'Azuay'),
  canton_id    = (SELECT id FROM cantones WHERE nombre = 'Cuenca' AND provincia_id = (SELECT id FROM provincias WHERE nombre = 'Azuay')),
  verificacion = 'VERIFICADO',
  toggle_disponible = true,
  rating_promedio = 5.00,
  total_resenas = 8
WHERE id = 'f0000000-0000-0000-0000-000000000005';

-- ────────────────────────────────────────────────────────────
-- Suscripciones vigentes (30 días desde hoy). Inserta en suscripciones en vez
-- de escribir suscripcion_vigente_hasta directamente: el trigger
-- fn_sincronizar_suscripcion_vigente (migración 005) es la fuente de verdad
-- para ese campo y lo actualiza automáticamente al insertar una fila ACTIVA.
-- ────────────────────────────────────────────────────────────
INSERT INTO suscripciones (abogado_id, tipo, estado, monto, fecha_vencimiento, metodo_pago, notas_admin)
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'ABOGADO_INDIVIDUAL', 'ACTIVA', 11.99, (CURRENT_DATE + INTERVAL '30 days')::date, 'MANUAL_ADMIN', 'Dato de prueba — migración 029'),
  ('f0000000-0000-0000-0000-000000000002', 'ABOGADO_INDIVIDUAL', 'ACTIVA', 11.99, (CURRENT_DATE + INTERVAL '30 days')::date, 'MANUAL_ADMIN', 'Dato de prueba — migración 029'),
  ('f0000000-0000-0000-0000-000000000003', 'ABOGADO_INDIVIDUAL', 'ACTIVA', 11.99, (CURRENT_DATE + INTERVAL '30 days')::date, 'MANUAL_ADMIN', 'Dato de prueba — migración 029'),
  ('f0000000-0000-0000-0000-000000000004', 'ABOGADO_INDIVIDUAL', 'ACTIVA', 11.99, (CURRENT_DATE + INTERVAL '30 days')::date, 'MANUAL_ADMIN', 'Dato de prueba — migración 029'),
  ('f0000000-0000-0000-0000-000000000005', 'ABOGADO_INDIVIDUAL', 'ACTIVA', 11.99, (CURRENT_DATE + INTERVAL '30 days')::date, 'MANUAL_ADMIN', 'Dato de prueba — migración 029');

-- ────────────────────────────────────────────────────────────
-- Zonas de servicio adicionales para 2 de los 5 abogados (columna canton_id
-- de abogado_zonas_servicio todavía no existe en este punto — se agrega en
-- la migración 030 — por eso aquí solo se marca la provincia completa).
-- ────────────────────────────────────────────────────────────
-- Lucía Vera (Guayas) también atiende en Pichincha.
INSERT INTO abogado_zonas_servicio (abogado_id, provincia_id)
VALUES (
  'f0000000-0000-0000-0000-000000000003',
  (SELECT id FROM provincias WHERE nombre = 'Pichincha')
);

-- Ana María Torres (Pichincha) también atiende en Guayas.
INSERT INTO abogado_zonas_servicio (abogado_id, provincia_id)
VALUES (
  'f0000000-0000-0000-0000-000000000001',
  (SELECT id FROM provincias WHERE nombre = 'Guayas')
);
