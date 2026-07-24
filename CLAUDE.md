# CLAUDE.md — Legal App
**Plataforma de conexión legal Ecuador**
Última actualización: Junio 2026

Lee este archivo completo antes de tocar cualquier archivo del proyecto.
Ante cualquier duda de arquitectura, consulta primero el PRD.md.

---

## 1. Qué es este proyecto

Plataforma web que conecta abogados con clientes en Ecuador. Modelo de solicitud mediada: el cliente solicita, el abogado acepta o rechaza, los datos de contacto se revelan solo tras el match. Los abogados pagan suscripción mensual; los clientes son siempre gratuitos.

Una sola app, un solo repositorio, roles diferenciados por tipo de usuario (cliente / abogado / estudio / admin).

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JS vanilla — sin frameworks, sin build steps |
| Base de datos + Auth | Supabase (PostgreSQL) con Row Level Security |
| Backend | Supabase Edge Functions (Deno/TypeScript) |
| Config runtime | Vercel Serverless Function (`api/config.js`) — expone `SUPABASE_URL`/`SUPABASE_ANON_KEY` al frontend estático sin commitear credenciales (ver §10) |
| Hosting | Vercel — auto-deploy en push a `main` |
| Almacenamiento | Supabase Storage (carnets, logos, fotos) |
| Email | Zoho SMTP — vía Supabase Edge Function `notificar-solicitud` (ver §13) y vía Vercel Function `api/contacto.js` (ver §16) |
| Notificaciones push | Web Push API / OneSignal (a definir) |
| Pagos MVP | PayPhone o transferencia manual |
| Mobile V2 | Capacitor |

**No introducir frameworks de frontend (React, Vue, etc.) sin discutirlo primero.**
**No introducir dependencias npm en el frontend sin discutirlo primero.**

---

## 3. Estructura de archivos

```
legal-app/
├── CLAUDE.md                  ← este archivo
├── PRD.md                     ← fuente de verdad del producto
├── docs/
│   └── PRD_Plataforma_Legal_Ecuador.docx
├── api/
│   ├── config.js              ← Vercel Function: expone SUPABASE_URL/ANON_KEY sin commitearlas
│   └── contacto.js            ← Vercel Function: formulario de contacto/soporte vía Zoho SMTP (ver §16)
├── package.json                ← dependencias de api/ (nodemailer). El frontend sigue sin build step (§2)
├── frontend/
│   ├── index.html             ← landing / login
│   ├── css/
│   │   └── main.css
│   ├── js/
│   │   ├── vendors/
│   │   │   └── supabase.min.js    ← UMD build; descargar de releases y commitear
│   │   ├── app.js             ← inicialización, routing, auth, roles
│   │   ├── api.js             ← todas las queries a Supabase
│   │   ├── config.js          ← obtiene SUPABASE_URL/ANON_KEY desde /api/config
│   │   ├── header.js          ← header centralizado: logo, notificaciones, avatar con menú desplegable, estado anónimo (ver §26, reemplaza a menu-perfil.js del §18)
│   │   ├── notificaciones.js  ← campana de notificaciones en el header
│   │   ├── busqueda.js        ← lógica de busqueda.html
│   │   ├── perfil-abogado.js  ← lógica de perfil-abogado.html
│   │   ├── panel-abogado.js   ← lógica de panel-abogado.html
│   │   ├── panel-cliente.js   ← lógica de panel-cliente.html
│   │   ├── panel-admin.js     ← lógica de panel-admin.html
│   │   ├── registro.js        ← lógica de registro.html
│   │   ├── recuperar-contrasena.js ← lógica de recuperar-contrasena.html
│   │   ├── nueva-contrasena.js     ← lógica de nueva-contrasena.html
│   │   ├── cambiar-contrasena.js   ← lógica de cambiar-contrasena.html (usuario ya autenticado, ver §18)
│   │   ├── contacto.js        ← lógica de contacto.html (sin Supabase; envía a /api/contacto)
│   │   ├── tablon.js          ← lógica de tablon.html: listado en formato foro de casos activos (ver §17/§25)
│   │   ├── tablon-publicar.js ← lógica de tablon-publicar.html: formulario de publicación de un caso (ver §25)
│   │   ├── tablon-caso.js     ← lógica de tablon-caso.html: detalle de un caso puntual (ver §17/§22)
│   │   ├── referidos.js       ← lógica de referidos.html: programa de referidos (ver §20)
│   │   ├── solicitudes-directas.js ← lógica de solicitudes-directas.html (ver §22)
│   │   ├── solicitudes-tablon.js   ← lógica de solicitudes-tablon.html (ver §22)
│   │   ├── editar-perfil-cliente.js ← lógica de editar-perfil-cliente.html, página independiente (ver §27)
│   │   ├── editar-perfil-abogado.js ← lógica de editar-perfil-abogado.html, página independiente (ver §27)
│   │   ├── notificaciones-pagina.js ← lógica de notificaciones.html: todas las notificaciones, agrupadas y paginadas (ver §31)
│   │   └── configuracion-cuenta.js  ← lógica de configuracion-cuenta.html: usuarios bloqueados y preferencias (ver §38)
│   └── pages/
│       ├── busqueda.html
│       ├── perfil-abogado.html
│       ├── panel-cliente.html
│       ├── panel-abogado.html
│       ├── panel-admin.html
│       ├── registro.html
│       ├── recuperar-contrasena.html
│       ├── nueva-contrasena.html
│       ├── cambiar-contrasena.html ← cambio de contraseña desde el panel (usuario ya autenticado, ver §18)
│       ├── contacto.html
│       ├── tablon.html        ← "El Tablón": listado en formato foro de casos activos (ver §17/§25)
│       ├── tablon-publicar.html ← formulario de publicación de un caso, página independiente (ver §25)
│       ├── tablon-caso.html   ← detalle de un caso puntual: aplicantes, elegir, aplicar, cerrar (ver §17/§22)
│       ├── referidos.html     ← programa de referidos, solo abogados (ver §20)
│       ├── solicitudes-directas.html ← listado con filtros de solicitudes normales, cliente o abogado (ver §22)
│       ├── solicitudes-tablon.html   ← listado con filtros de solicitudes originadas en El Tablón (ver §22)
│       ├── editar-perfil-cliente.html ← edición de perfil de cliente, página independiente (ver §27)
│       ├── editar-perfil-abogado.html ← edición de perfil de abogado, página independiente (ver §27)
│       ├── notificaciones.html        ← todas las notificaciones del usuario, agrupadas por fecha y paginadas (ver §31)
│       └── configuracion-cuenta.html  ← usuarios bloqueados (desbloquear) y preferencias (placeholder) (ver §38)
├── supabase/
│   ├── config.toml            ← project_id para el Supabase CLI (link/deploy)
│   ├── migrations/            ← archivos SQL en orden cronológico
│   └── functions/
│       └── notificar-solicitud/
│           └── index.ts       ← Edge Function: emails de solicitud vía Zoho SMTP (ver §13)
├── vercel.json                ← security headers + routing
├── .env.example                ← lista de variables de entorno; copiar como .env local
└── .gitignore
```

Actualizar esta sección cada vez que se agregue un archivo relevante.

---

## 4. Reglas de seguridad — NO NEGOCIABLES

Estas reglas se aplican siempre, en cada decisión, sin excepción.

### 4.1 Row Level Security (RLS)
- **RLS activado en TODAS las tablas sin excepción**
- Ningún dato se expone sin una política RLS explícita que lo autorice
- La visibilidad de perfiles se controla a nivel de base de datos, no de frontend
- Un perfil de abogado solo se devuelve si cumple TODAS estas condiciones:

```sql
verificacion = 'VERIFICADO'
AND toggle_disponible = true
AND (
  suscripcion_vigente_hasta >= CURRENT_DATE
  OR suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'
)
```

- Nunca filtrar perfiles solo en el frontend — siempre blindar en RLS

### 4.2 CORS
- Supabase configurado para aceptar solicitudes solo del dominio de la app
- Ningún origen externo no autorizado puede consultar la API
- Configurar en Supabase Dashboard → API → CORS

### 4.3 Security Headers (vercel.json)
Siempre presentes en vercel.json:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co" }
      ]
    }
  ]
}
```

Ajustar `connect-src` cuando se integren servicios externos (OneSignal, Resend, etc.).

### 4.4 Autenticación
- Usar Supabase Auth siempre — nunca manejar passwords manualmente
- El rol del usuario (cliente / abogado / estudio / admin) vive en la tabla `perfiles`, no en el JWT
- Verificar rol server-side en Edge Functions, nunca confiar solo en el frontend

---

## 5. Roles del sistema

| Rol | Descripción |
|---|---|
| `cliente` | Usuario gratuito, solo busca y solicita |
| `abogado` | Paga suscripción, tiene perfil individual |
| `estudio` | Cuenta paraguas con miembros abogados |
| `admin` | Acceso total al panel de administración |

El rol se asigna en el registro y vive en `perfiles.rol`.

---

## 6. Reglas de negocio críticas

### Visibilidad de perfiles
Un perfil de abogado aparece en búsquedas SOLO si:
- `verificacion = 'VERIFICADO'`
- `toggle_disponible = true`
- Suscripción vigente O dentro del período de gracia de 4 días

### Período de gracia
- 4 días desde vencimiento de suscripción
- Al día 5: perfil oculto de búsquedas, no recibe solicitudes
- Las reseñas se conservan siempre — solo se ocultan mientras el perfil está inactivo
- Al renovar: perfil vuelve visible automáticamente

### Reseñas
- Solo puede reseñar quien tiene una solicitud en estado `COMPLETADA`
- Nunca permitir reseñas sin solicitud asociada verificada

### Solicitudes
- Estados posibles: `PENDIENTE → ACEPTADA → COMPLETADA → RESEÑADA` / `RECHAZADA` / `EXPIRADA`
- Expiración automática a las 48h sin respuesta (cron o función programada)
- Los datos de contacto del cliente se revelan SOLO cuando el estado es `ACEPTADA`

---

## 7. Convenciones de código

### JavaScript
- Sin frameworks — vanilla JS puro
- Todas las queries a Supabase van en `api.js` — nunca inline en las páginas
- Helpers globales van en `utils.js`
- Inicialización, routing y auth van en `app.js`
- Comentar funciones complejas en español
- Nunca usar `window.confirm()`, `window.alert()` o `window.prompt()` — son diálogos del sistema, no de la app. Reemplazar siempre por modales o confirmaciones inline propias. Esta regla aplica a todos los archivos JS del proyecto. Para confirmaciones sí/no, usar `confirmar(mensaje)` de `utils.js` (modal propio, retorna una `Promise<boolean>`).

### SQL / Supabase
- Nombres de tablas en español y snake_case: `perfiles`, `solicitudes`, `abogados`
- Nombres de columnas en snake_case: `toggle_disponible`, `suscripcion_vigente_hasta`
- Cada migración en su propio archivo: `supabase/migrations/YYYYMMDD_descripcion.sql`
- Toda migración incluye comentario de qué hace y por qué

### HTML/CSS
- Mobile-first
- Sin librerías CSS externas (Bootstrap, Tailwind, etc.) sin discutirlo primero
- Variables CSS para colores y tipografía en `:root`

### Idioma y tono
- Español neutro latinoamericano en toda la UI. Contexto profesional legal: usar "usted" en mensajes formales dirigidos al usuario ("Complete los campos", "Ingrese su correo"), "tú" solo en contextos informales. Prohibido el español rioplatense: nada de "vos", "Completá", "Ingresá", "Hacé", "Revisá", "Debés", "querés", "Intentá", "Gestioná", "Recibí", "dale", "genial", ni cualquier otra expresión argentina.
- Sin emojis en el frontend. El diseño atractivo se consigue con tipografía, color, espaciado y jerarquía visual. Los badges y estados usan SVG inline o caracteres tipográficos. Las estrellas de rating usan entidades HTML (&#9733; / &#9734;). Excepción: solo si el usuario del proyecto lo solicita explícitamente para un caso puntual.

---

## 8. Flujo de desarrollo

- Rama `main`: producción — solo merge cuando algo está probado
- Ramas `feature/nombre-feature`: desarrollo de cada funcionalidad
- Cada migración de base de datos se prueba localmente antes de aplicar en producción
- Antes de crear cualquier tabla, revisar si la regla de negocio ya está definida en PRD.md

---

## 9. Lo que NO hacer

- ❌ No filtrar visibilidad de perfiles solo en el frontend
- ❌ No crear tablas sin RLS activado
- ❌ No manejar passwords manualmente
- ❌ No introducir frameworks de frontend sin discutirlo
- ❌ No hacer queries a Supabase fuera de `api.js`
- ❌ No hardcodear URLs, keys o credenciales — usar variables de entorno
- ❌ No aplicar migraciones en producción sin probar primero
- ❌ No crear vistas, funciones RPC o tablas sin agregar el GRANT en el mismo PR (ver §12)

---

## 10. Variables de entorno necesarias

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # solo en Edge Functions, nunca en frontend
RESEND_API_KEY=                # solo en la Edge Function notificar-solicitud (ver §13), no en Vercel
PAYPHONE_API_KEY=
```

Nunca commitear `.env` — está en `.gitignore`.

---

## 11. Pendientes técnicos por definir

- [ ] Nombre del proyecto y dominio definitivo — mientras tanto, `EMAIL_FROM` de la Edge Function de notificaciones usa `onboarding@resend.dev` (ver §13)
- [ ] Proveedor de notificaciones push (Web Push API nativo vs OneSignal)
- [ ] Estrategia de cron para expiración de solicitudes (Supabase cron vs cron-job.org)
- [ ] Flujo de pago PayPhone — integración específica
- [ ] Estructura definitiva de tablas (diseñar antes de primera migración)
- [ ] Activación automática de suscripcion_vigente_hasta al recibir pago (PayPhone) — por ahora manual desde Supabase
- [ ] Integración Google Play Billing para suscripciones automáticas (V2) — reemplaza PayPhone

---

## 12. Grants y permisos — regla obligatoria

### Regla general
Cada vez que se crea una vista, función RPC o tabla nueva, el GRANT correspondiente debe ir en el **mismo PR**. No dejar GRANTs como pendiente para después.

### Por qué ambas capas son necesarias
En Supabase/PostgreSQL el acceso funciona en dos capas:

| Capa | Controla |
|---|---|
| **GRANT** | Qué operaciones puede intentar el rol sobre el objeto (tabla, vista, función) |
| **RLS** | Qué filas puede ver o modificar dentro de esa operación |

- Sin GRANT: PostgREST devuelve `permission denied` antes de que RLS se evalúe.
- Sin RLS: el rol ve todas las filas sin restricción.
- Las dos capas son obligatorias y complementarias.

### Dónde poner los GRANTs
- Si el objeto se crea en una migration nueva → agregar el GRANT al final de **esa misma migration**.
- Si se descubrió un GRANT faltante en un objeto ya existente → corregir en un archivo `NNN_grants.sql` con timestamp del día.

### Plantilla por tipo de objeto

**Tabla nueva:**
```sql
GRANT SELECT [, INSERT] [, UPDATE] ON TABLE nombre_tabla TO authenticated;
-- anon: solo si hay acceso sin sesión sobre esa tabla (raro)
```

**Vista nueva:**
```sql
GRANT SELECT ON nombre_vista TO authenticated;
-- anon: solo si es accesible sin sesión iniciada
```

**Función RPC nueva:**
```sql
GRANT EXECUTE ON FUNCTION nombre_funcion(tipos) TO authenticated;
-- anon: si puede llamarse antes de login (ej: get_server_date)
```

**Función trigger:** no necesita GRANT. La invoca el motor de PostgreSQL, no el usuario.

### Roles del sistema

| Rol PostgreSQL | Quién es | Cuándo recibe GRANTs |
|---|---|---|
| `anon` | Usuario sin sesión | Funciones de utilidad pre-login y funciones llamadas por RLS (ej: `es_admin()`) |
| `authenticated` | Usuario con sesión activa | Todas las operaciones normales de la app |
| `service_role` | Edge Functions / admin | Bypass de RLS. Nunca exponer al frontend. No necesita GRANTs explícitos. |

### Principio de mínimo privilegio
- No usar `GRANT ALL ON TABLE` — otorga `TRUNCATE`, `REFERENCES` y `TRIGGER` que nunca necesitan los roles de la app.
- No otorgar `DELETE` a `authenticated` salvo casos de uso explícitos confirmados en PRD.
- No otorgar `INSERT` en tablas donde el dato lo crea un trigger (ej: `perfiles`, `abogados`).
- El historial de pagos (`suscripciones`) no recibe INSERT/UPDATE desde el cliente; lo hace el admin con `service_role`.

---

## 13. Notificaciones por email (Zoho SMTP)

### Arquitectura
Una sola Edge Function, `supabase/functions/notificar-solicitud/index.ts`, maneja los dos correos del flujo de solicitud:

| Evento en `solicitudes` | Destinatario | Email |
|---|---|---|
| `INSERT` (estado `PENDIENTE`) | Abogado | "Nueva solicitud de consulta" |
| `UPDATE`: `PENDIENTE → ACEPTADA` | Cliente | "Su solicitud fue aceptada" |

El resto de transiciones (`RECHAZADA`, `COMPLETADA`, `RESEÑADA`, `EXPIRADA`) no generan email por ahora — no está en el alcance actual.

La función se invoca desde un **Database Webhook** de Supabase (Dashboard → Database → Webhooks) configurado sobre la tabla `solicitudes` para los eventos `INSERT` y `UPDATE`. El webhook envía el header `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`; Supabase valida ese JWT automáticamente antes de invocar la función (verificación por defecto), así que la función no necesita lógica de autenticación propia.

Por qué Database Webhook y no un trigger SQL con `pg_net` directo: evita commitear o siquiera pegar el `service_role_key` en un archivo de migración versionado. El Dashboard almacena el header de forma segura de su lado.

Por qué una Edge Function y no lógica en `api/` (Vercel): el envío de email depende de datos que requieren `service_role` (email del abogado en `auth.users`, revelado solo tras el match) — nunca debe ejecutarse con las credenciales del frontend. Las Edge Functions son el único lugar con acceso a `service_role` (§4.4).

El envío de correo usa SMTP de Zoho Mail (librería `denomailer`), no una API de terceros como Resend.

### Variables de entorno de la Edge Function
Se configuran con `supabase secrets set`, **no** en Vercel:

```
ZOHO_SMTP_USER      # obligatoria — email de Zoho Mail usado para autenticar por SMTP
ZOHO_SMTP_PASSWORD  # obligatoria — contraseña de aplicación de Zoho, NUNCA la contraseña
                    # principal de la cuenta. Se genera en Zoho Mail > Configuración >
                    # Seguridad > Contraseñas de aplicación.
EMAIL_FROM          # remitente que se muestra en el correo ("Nombre <email@dominio.com>").
                    # Si no se configura, se usa ZOHO_SMTP_USER como remitente.
APP_URL             # URL pública de la app para armar los links del email.
                    # Default en el código: "https://legal-app-two.vercel.app"
```

Conexión SMTP fija en el código: `smtp.zoho.com`, puerto `465` (SSL). Sin ambas credenciales configuradas, el envío falla en silencio (solo log).

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente en toda Edge Function — no hace falta configurarlos.

### Pasos de despliegue (manual, una sola vez)
1. `supabase login`
2. Desde la raíz del repo: `supabase link --project-ref gxhildriufvesohyfwcb`
3. `supabase secrets set ZOHO_SMTP_USER=<tu_email_de_zoho>`
4. `supabase secrets set ZOHO_SMTP_PASSWORD=<tu_contraseña_de_aplicacion_de_zoho>`
5. (Opcional) `supabase secrets set EMAIL_FROM="LegalEC <tu_email_de_zoho>"`
6. `supabase functions deploy notificar-solicitud`
7. En el Dashboard de Supabase → Database → Webhooks → Create a new hook:
   - Table: `solicitudes`
   - Events: `INSERT`, `UPDATE`
   - Type: HTTP Request → `POST` a `https://gxhildriufvesohyfwcb.supabase.co/functions/v1/notificar-solicitud`
   - HTTP Headers: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (el mismo valor que está en `.env`, nunca commitear)

### Verificación
Después de desplegar: crear una solicitud de prueba desde `perfil-abogado.html` y revisar `supabase functions logs notificar-solicitud` para confirmar que se ejecutó y qué devolvió Zoho SMTP.

---

## 14. Storage: bucket `verificacion-docs`

Contiene carnets de abogado, cédulas, RUC y nombramientos — documentos de identidad (PRD §11: "datos de verificación profesional bajo resguardo especial"). A diferencia de `avatares`/`logos` (públicos), **este bucket es privado**: la migración `20260707_021_storage_verificacion_docs.sql` lo crea con `public = false` y agrega las políticas RLS de `storage.objects`.

### Quién puede ver qué
| Rol | Acceso |
|---|---|
| Abogado individual | Solo sus propios documentos (carpeta = su `auth.uid()`) |
| Representante de estudio | Solo los documentos de su propio estudio (carpeta = `estudios.id`, resuelto vía `representante_legal_id = auth.uid()`) |
| Admin | Todos los documentos (`es_admin()`) |
| Cualquier otro | Ninguno |

### Por qué URLs firmadas y no `getPublicUrl`
Un bucket privado no sirve archivos por URL pública aunque se conozca el path — Supabase devuelve 400/403. El panel de administración (`panel-admin.js`) genera enlaces a los documentos con `api.storage.getUrlFirmada(bucket, path)` (`frontend/js/api.js`), que llama a `createSignedUrl` y produce un link que expira a los 5 minutos. Nunca usar `getPublicUrl` con `verificacion-docs`.

### Aplicar la migración
La migración crea el bucket si no existe y fuerza `public = false` aunque ya existiera (por si se había creado como público desde el Dashboard). No requiere pasos manuales adicionales — a diferencia de §13, esto es 100% SQL.

---

## 15. Mejoras UI/UX en curso

- [x] MÓDULO 1 — General: favicon, página 404, toasts de feedback, mensajes de error amigables
- [x] MÓDULO 2 — Cliente: confirmación post-solicitud, CTA después de rechazo/expiración, cancelar solicitud pendiente
- [x] MÓDULO 3 — Abogado: preview del perfil público, alerta de vencimiento de suscripción, onboarding para abogado nuevo, formulario de perfil con progreso visual
- [x] MÓDULO 4 — Admin: búsqueda/filtro en verificaciones, log de acciones del admin
- [x] MÓDULO 5 — Notificaciones internas: sistema de notificaciones en la interfaz para cada tipo de usuario (nueva solicitud, solicitud aceptada/rechazada, verificación aprobada/rechazada, suscripción próxima a vencer)
- [x] MÓDULO A — Menú de perfil desde foto: avatar circular con dropdown (ver §18) reemplaza el nombre en texto y los botones sueltos del header
- [x] MÓDULO B — Dashboard "Inicio": primera pestaña de `panel-cliente.html` y `panel-abogado.html` con saludo, accesos rápidos y resumen numérico
- [x] MÓDULO C — Rediseño de El Tablón: ubicación en los casos, flujo de contacto directo al elegir, página `tablon-caso.html` por caso, cierre manual (ver §17)
- [x] MÓDULO D — En seguimiento: solicitudes y aplicaciones de El Tablón marcables, nueva pestaña en ambos paneles (ver §19)
- [x] MÓDULO E — Programa de referidos: código único por abogado, mes gratis a ambos al registrarse con él (ver §20)
- [x] MÓDULO F — Notificaciones completas: 5 tipos nuevos de El Tablón/solicitud cancelada, dropdown muestra últimas 7 leídas y no leídas (ver §21)

Marcar cada ítem como `[x]` a medida que se completa el módulo correspondiente.

---

## 16. Formulario de contacto y soporte (`api/contacto.js`)

### Arquitectura
`frontend/pages/contacto.html` no usa Supabase — es un formulario simple (nombre, email, asunto, mensaje) que hace `fetch('/api/contacto', ...)`. `api/contacto.js` es una Vercel Serverless Function (Node.js) que valida los campos y reenvía el mensaje por email al equipo de soporte usando SMTP de Zoho Mail, vía la librería `nodemailer`.

### Por qué una dependencia npm aquí
CLAUDE.md §2 prohíbe introducir dependencias npm en el **frontend** sin discutirlo primero; esto no cambia. `nodemailer` es una dependencia de `api/` (backend, Node.js, Vercel Serverless Function), documentada en el `package.json` de la raíz del repo — el primero que tiene este proyecto. Se eligió por el mismo motivo que la Edge Function de notificaciones usa `denomailer` en vez de implementar el protocolo SMTP a mano (ver §13): evita reimplementar EHLO/AUTH/DATA sobre TLS a mano, con el riesgo de bugs de seguridad que eso implica. El frontend estático sigue sin build step ni dependencias.

### Por qué variables de entorno separadas de la Edge Function
`ZOHO_SMTP_USER`, `ZOHO_SMTP_PASSWORD` y `EMAIL_FROM` normalmente tienen el mismo valor que sus equivalentes en Supabase secrets (§13), pero deben configurarse por separado en **Vercel → Project Settings → Environment Variables**, porque `api/contacto.js` corre en Vercel, no en Supabase, y cada plataforma tiene su propio almacén de secrets. `SUPPORT_EMAIL` es nueva: la bandeja que recibe los mensajes del formulario (si no se configura, se usa `ZOHO_SMTP_USER`). Ver `.env.example`.

### Seguridad
- `asunto` se valida contra una lista blanca fija (4 valores exactos); nunca se usa como texto libre en el email.
- `email` del remitente se usa como `Reply-To`, nunca como `from`/`to` — el remitente real y el destinatario real (`EMAIL_FROM`/`SUPPORT_EMAIL`) siempre vienen de variables de entorno, no de datos del formulario.
- `nombre` y `mensaje` se escapan antes de insertarse en el HTML del correo (misma función `escapar()` que ya usa `notificar-solicitud/index.ts`).
- Sin sesión ni RLS involucrados: este endpoint es público por diseño (cualquiera debe poder pedir soporte), así que la validación de entrada vive enteramente en `api/contacto.js`.

---

## 17. El Tablón

### Qué es
Sección independiente donde clientes publican casos y abogados verificados aplican para atenderlos. `frontend/pages/tablon.html` (`/pages/tablon`) lista, en formato foro, los casos propios (cliente) o los casos activos con filtros (abogado) — ver §25 para el layout y el formulario de publicación, que vive en `tablon-publicar.html`. `frontend/pages/tablon-caso.html` (`/pages/tablon-caso?id=<casoId>`) es el detalle de un caso puntual — aplicantes y "Elegir"/"Cerrar caso" para el cliente dueño, estado de su propia aplicación o formulario para aplicar para el abogado.

Al elegir un abogado se crea automáticamente una solicitud mediada — pero a diferencia del flujo normal (§6/§13), acá el contacto se revela de inmediato, sin que el abogado tenga que aceptar (ver "Flujo de contacto DIRECTO" abajo). El Tablón es un canal adicional para llegar a esa solicitud; no reemplaza el resto de las reglas de privacidad de contacto del §6.

### Modelo de datos (migraciones `20260712_040_tablon.sql` y `20260712_041_tablon_mejoras.sql`)
| Tabla | Qué guarda |
|---|---|
| `casos_tablon` | Caso publicado por un cliente: título, descripción, especialidad (opcional desde la 052 — el cliente puede no saber a qué especialidad corresponde su caso), caso común opcional, provincia/ciudad opcionales (041, texto libre — mismo criterio que `perfiles.provincia`), si es anónimo, estado (`ACTIVO`/`EXPIRADO`/`CERRADO`) |
| `aplicaciones_tablon` | Aplicación de un abogado verificado a un caso: mensaje opcional, estado (`PENDIENTE`/`ELEGIDO`/`RECHAZADO`), `en_seguimiento_cliente`/`en_seguimiento_abogado` (041, ver §19) |
| `config_tablon` | Configuración editable desde `panel-admin.html` — hoy solo `limite_aplicaciones_abogado` (NULL = sin límite) |

`solicitudes.en_seguimiento_cliente`/`en_seguimiento_abogado` (también agregadas en la 041) son del flujo normal de solicitudes, no de El Tablón — ver §19.

### Reglas de negocio y dónde viven
- **Máximo de casos publicados por cliente por día**: trigger `fn_verificar_limite_casos_tablon` (BEFORE INSERT en `casos_tablon`), no en RLS, para poder devolver un mensaje de error legible. Configurable desde `panel-admin.html` vía `config_tablon.limite_publicaciones_diarias_cliente` (valor inicial `2`, `NULL` = sin límite — migración 051, ver §24), mismo patrón que el límite de aplicaciones de abogado de abajo.
- **Expiración a los 15 días**: `expires_at` se calcula en el trigger `fn_set_expires_at_caso_tablon`; un job de `pg_cron` (`expirar-casos-tablon`, cada hora) transiciona `ACTIVO → EXPIRADO` vía `fn_expirar_casos_tablon`.
- **Cierre manual**: el cliente puede cerrar su propio caso `ACTIVO → CERRADO` sin elegir a nadie más (botón "Cerrar caso" en `tablon-caso.html`). Política RLS `cliente_cierra_caso_tablon` (041): solo esa transición exacta, ninguna otra columna puede cambiar.
- **Solo abogados con `verificacion = 'VERIFICADO'` ven y aplican a casos**: condición en las políticas RLS de `casos_tablon`/`aplicaciones_tablon` y en las vistas `tablon_casos_abogado`/`tablon_caso_detalle` (doble capa, igual que la regla de visibilidad de búsqueda en §4.1). `tablon_caso_detalle` (041) además deja ver el caso a cualquier abogado que ya haya aplicado a él, aunque el caso haya cerrado o expirado desde entonces — para que pueda seguir viendo el resultado de su propia aplicación.
- **Anonimato**: si `casos_tablon.anonimo = true`, las vistas para abogado (`tablon_casos_abogado`, `tablon_caso_detalle`) muestran `cliente_nombre = 'Cliente anónimo'` hasta que ese abogado específico queda `ELEGIDO` en `aplicaciones_tablon` para ese caso. El propio cliente dueño siempre ve su nombre real en `tablon_caso_detalle`. La condición vive en la vista (base de datos), nunca se resuelve ocultando el nombre solo en el frontend.
- **Flujo de contacto DIRECTO al elegir un abogado**: trigger `fn_crear_solicitud_desde_tablon` (AFTER UPDATE OF estado en `aplicaciones_tablon`, cuando pasa a `ELEGIDO`) inserta en `solicitudes` y la transiciona a `ACEPTADA` en el mismo trigger (vía UPDATE, para reutilizar `fn_revelar_contacto_al_aceptar` del §6, que solo corre en UPDATE OF estado). El cliente ya comparó varios aplicantes antes de elegir, así que no hace falta que el abogado acepte — los datos de contacto quedan revelados de inmediato. Si ya existía una solicitud activa entre ambos (ej. el cliente ya lo había contactado desde búsqueda normal, o desde otro caso del Tablón), el `INSERT` choca contra `idx_solicitud_activa_unica` (única solicitud `PENDIENTE`/`ACEPTADA` por par cliente-abogado) y el `unique_violation` se atrapa: el caso se marca `ELEGIDO` igual, sin duplicar la solicitud, pero desde la migración 052 esa solicitud activa existente se vincula (`caso_tablon_id = COALESCE(caso_tablon_id, v_caso.id)`) al caso recién elegido si todavía no tenía uno — antes (047/049) el vínculo se descartaba por completo, y esa elección nunca aparecía en `solicitudes-tablon.html` del lado del cliente aunque la aplicación sí quedara `ELEGIDO`. Ver §25.
- **Límite de aplicaciones por abogado**: sin límite por defecto (`config_tablon.limite_aplicaciones_abogado = NULL`). Si el admin fija un número desde la pestaña "Configuración" de `panel-admin.html`, el trigger `fn_verificar_limite_aplicaciones_tablon` lo hace cumplir contando las aplicaciones `PENDIENTE` del abogado.
- El cliente puede elegir a más de un abogado aplicante (no hay restricción de "un solo elegido por caso").

### Frontend
- `frontend/js/tablon.js` decide la vista (cliente o abogado verificado) según `perfiles.rol` y, para abogados, `abogados.verificacion`. Cada tarjeta de caso enlaza a `tablon-caso.html?id=<casoId>` — el formulario de publicar vive en `tablon-publicar.html`/`tablon-publicar.js` (página aparte, ver §25), no inline en `tablon.html`.
- `frontend/js/tablon-caso.js` resuelve el `id` desde `?id=` en la URL, carga el detalle con `api.tablon.getCasoDetalle()` (vista `tablon_caso_detalle`) y renderiza la vista según `perfiles.rol`.
- Todas las queries pasan por el módulo `api.tablon` en `frontend/js/api.js` (§7: nunca inline en las páginas).
- Link "El Tablón" en el header de `panel-cliente.html` y `panel-abogado.html`. `tablon.html`/`tablon-publicar.html`/`tablon-caso.html` usan el mismo menú de perfil del header que los paneles (§18).

---

## 18. Menú de perfil (header)

> **Superseded por §26.** `menu-perfil.js` se absorbió en `frontend/js/header.js`, que además centraliza el estado anónimo/autenticado en todas las páginas. Esta sección se conserva por el contenido del menú por rol, que sigue vigente.

### Qué es
`frontend/js/menu-perfil.js` reemplaza el nombre de usuario en texto plano y los botones sueltos ("Ver mi perfil público", "Salir") que tenían `panel-cliente.html` y `panel-abogado.html` por un botón circular (foto de perfil o iniciales) con un menú desplegable, siguiendo el mismo patrón visual del menú "Ver como" de `panel-admin.html` (clases `menu-desplegable`/`menu-desplegable__item`).

### Contenido del menú por rol
| Rol | Ítems |
|---|---|
| `cliente` | Editar perfil · Cambiar contraseña · Cerrar sesión |
| `abogado` | Ver mi perfil público · Editar perfil · Referir un colega · Cambiar contraseña · Cerrar sesión |

"Editar perfil" navega a `?tab=perfil` del panel propio — la pestaña correspondiente ya existe en ambos paneles y `aplicarTabDesdeUrl()` la activa al cargar. "Referir un colega" lleva a `/pages/referidos` (§20).

### Cambio de contraseña desde el panel
`frontend/pages/cambiar-contrasena.html` es distinto de `nueva-contrasena.html` (§ enlace de recuperación por correo, sesión temporal tipo `recovery`): acá el usuario ya tiene una sesión normal activa. Antes de llamar a `api.auth.cambiarContrasena(nuevaPassword)`, `cambiar-contrasena.js` reautentica con `api.auth.iniciarSesion(email, contraseñaActual)` — así una sesión abierta sin vigilancia no puede cambiar la contraseña sin conocer la actual. Supabase JS v2 no expone un método dedicado de reautenticación por contraseña; volver a iniciar sesión con las mismas credenciales cumple el mismo propósito sin agregar un flujo de OTP.

### Integración con la campana de notificaciones
`notificaciones.js` inserta su botón inmediatamente antes de `#menuPerfil` cuando existe (paneles cliente/abogado); en páginas que aún muestran el nombre en texto plano (`panel-admin.html`) mantiene el comportamiento anterior de insertarse después de `.nav-usuario__nombre`. Por eso `inicializarMenuPerfil()` debe llamarse antes que `inicializarNotificaciones()` en el `inicializar()` de cada panel.

---

## 19. En seguimiento

### Qué es
Cliente y abogado pueden marcar solicitudes y elementos de El Tablón como "en seguimiento" para encontrarlos rápido después. Checkbox "Marcar para seguimiento" (esquina inferior derecha de la tarjeta, ver `generarCheckboxSeguimiento()` en §25) en cada tarjeta de solicitud (`panel-cliente.html`, `panel-abogado.html`), en cada aplicación recibida y en la aplicación propia (`tablon-caso.html`), y en cada caso ya aplicado del listado del abogado (`tablon.html`). Nueva pestaña "En seguimiento" en ambos paneles.

### Modelo de datos
Columnas `en_seguimiento_cliente`/`en_seguimiento_abogado` (boolean, default `false`) en `solicitudes` y en `aplicaciones_tablon` (migración `20260712_041_tablon_mejoras.sql`).

**El seguimiento de El Tablón se guarda por aplicación, no por caso completo** — un caso puede tener varios aplicantes, así que:
- El cliente marca al aplicante puntual que le interesa (`en_seguimiento_cliente` en la fila de `aplicaciones_tablon` de ese aplicante), no el caso entero.
- El abogado marca su propia aplicación (`en_seguimiento_abogado` en su única fila para ese caso, `UNIQUE (caso_id, abogado_id)`).

Por eso `api.seguimiento.toggleTablon(aplicacionId, tipo)` recibe el id de una fila de `aplicaciones_tablon`, aunque conceptualmente el usuario esté "siguiendo" el caso al que pertenece. Consecuencia práctica: el botón de seguimiento del lado del abogado en `tablon.html` y en `tablon-caso.html` solo aparece **una vez que aplicó** al caso (recién ahí existe una fila de `aplicaciones_tablon` que marcar) — antes de aplicar no hay dónde guardar el flag sin crear una fila de aplicación falsa.

`tablon_casos_abogado` y `tablon_caso_detalle` exponen `mi_seguimiento` y `mi_aplicacion_id` (el id a pasarle a `toggleTablon`) de la aplicación propia del abogado — migración `20260712_042_tablon_seguimiento_vistas.sql`, que también agregó `en_seguimiento_cliente` a `tablon_aplicaciones_cliente`. Esta migración es una corrección de una falta detectada durante el desarrollo del frontend (mismo criterio que CLAUDE.md §12 para un GRANT faltante: archivo aparte con timestamp del día, no se reabre la 041 ya aplicada).

### RLS
- **Solicitudes**: sin política nueva — `abogado_responde_solicitud` y `cliente_completa_solicitud` (migración 006) ya permiten a cada parte actualizar cualquier columna de sus propias solicitudes (no restringen columnas), así que ya cubren estos dos flags.
- **`aplicaciones_tablon`**: el cliente ya podía modificar cualquier columna de las aplicaciones de sus propios casos vía `cliente_elige_aplicacion_tablon` (migración 040). El abogado no tenía ningún `UPDATE` sobre esta tabla — la política nueva `abogado_actualiza_seguimiento_aplicacion` (migración 041) sigue el mismo patrón de columnas "congeladas" que `20260707_033_editar_solicitud.sql`: solo `en_seguimiento_abogado` puede cambiar.

### Frontend
- `api.seguimiento` en `frontend/js/api.js`: `toggleSolicitud(solicitudId, tipo)`, `toggleTablon(aplicacionId, tipo)`, `getMisSeguimientos()` (retorna `{ solicitudes, casosTablon }`, resuelto según `perfiles.rol`).
- La pestaña "En seguimiento" de cada panel muestra las solicitudes marcadas (reutilizando la misma tarjeta que la pestaña de solicitudes) y los casos de El Tablón con al menos una aplicación marcada (tarjeta simplificada, solo lectura, con enlace "Ver caso" a `tablon-caso.html` — el toggle en sí vive ahí, no en la pestaña del panel, porque un caso puede tener varias aplicaciones marcadas de forma independiente).

---

## 20. Programa de referidos

### Qué es
Cada abogado tiene un código de referido único (`abogados.codigo_referido`, 8 caracteres hex, generado automáticamente al crearse la fila). `frontend/pages/referidos.html` — accesible solo para abogados, desde "Referir un colega" en el menú de perfil (§18) — muestra el link `{origin}/registro?ref=<codigo>` para compartir y el historial de referidos enviados. Cuando otro abogado se registra usando ese link, ambos reciben un mes gratis de suscripción.

### Modelo de datos (migración `20260712_043_referidos.sql`)
| Objeto | Qué es |
|---|---|
| `abogados.codigo_referido` | Código único (`UNIQUE`), generado por el trigger `fn_generar_codigo_referido` (BEFORE INSERT). Congelado contra el propio abogado en la política `abogado_update_propio` (extendida, igual que ya protegía `verificacion`/`suscripcion_vigente_hasta`). |
| `referidos` | Historial: `referidor_id`, `referido_email`, `codigo_referido` (copia del código usado — no es `UNIQUE` en esta tabla; el mismo abogado puede referir a varias personas con su mismo código), `estado` (`PENDIENTE`/`COMPLETADO`). En este MVP las filas se crean directamente en `COMPLETADO`: la recompensa se otorga de inmediato al registrarse, no hay un paso de reclamo posterior. `PENDIENTE` queda reservado para un futuro flujo de invitaciones. |
| `validar_codigo_referido(codigo)` | Función RPC pública (sin sesión, `SECURITY DEFINER`) que valida un código antes del registro — solo expone si es válido y el nombre del referidor, nada sensible. |

### Cómo se procesa el registro con código
El código viaja en `raw_user_meta_data->>'ref'` (igual que el resto de los datos de registro, ver §7 de `20260706_013_registro_metadata.sql`) y se procesa dentro de `fn_crear_fila_abogado`, en un bloque `BEGIN/EXCEPTION` **separado** del que crea la fila de `abogados`: en PL/pgSQL un bloque con `EXCEPTION` es una subtransacción (savepoint), así que si el procesamiento del referido fallara dentro del mismo bloque que el `INSERT INTO abogados`, revertiría también esa fila ya creada. Mismo criterio de aislamiento de fallos que `20260706_014_fix_triggers.sql` (log en `trigger_errors`, nunca aborta el `signUp`).

**La recompensa nunca escribe `abogados.suscripcion_vigente_hasta` directamente** — esa columna es denormalizada desde `suscripciones` y solo la mantiene sincronizada `fn_sincronizar_suscripcion_vigente` (§ ver `20260625_005_suscripciones.sql`; la política RLS `abogado_update_propio` la congela contra cualquier otro escritor). En cambio, se inserta una fila en `suscripciones` con `tipo='ABOGADO_INDIVIDUAL'`, `monto=0`, `metodo_pago='REFERIDO'` (valor nuevo del enum `metodo_pago`, agregado al inicio de esta misma migración) para el referidor y para el recién registrado — el trigger existente de `suscripciones` hace el resto. La fecha de vencimiento del referidor se extiende desde su vigencia actual si sigue activa, o desde hoy si no tenía o ya venció (`GREATEST` + `COALESCE`); la del recién registrado siempre arranca desde hoy.

Solo se otorga recompensa si el recién registrado tiene `rol='abogado'` — si alguien se registra como cliente o estudio con un `?ref=` en la URL, el código simplemente se ignora (no hay error, tampoco recompensa: `estudios` no tiene este programa en el MVP).

### Frontend
- `api.referidos` en `frontend/js/api.js`: `getMiCodigo()`, `getMisReferidos()`, `validarCodigo(codigo)` (RPC pública).
- `api.auth.registrarAbogado()` acepta un `ref` opcional, que se guarda en `raw_user_meta_data`.
- `registro.js` captura `?ref=` de la URL al cargar la página y lo asocia al registro de abogado; si el código es válido, muestra un aviso ("Fue referido por…") usando `validarCodigo()` — puramente informativo, no bloquea el formulario si el código no es válido.

---

## 21. Notificaciones de El Tablón y del dropdown

### Nuevos tipos (migración `20260712_044_notificaciones_tablon.sql`)
Mismo patrón que `20260707_025_notificaciones.sql` (§ módulo 5 en §15): triggers `SECURITY DEFINER` que llaman a `fn_crear_notificacion()`, nunca INSERT directo desde el frontend.

| Tipo | Evento | Destinatario | `url_destino` |
|---|---|---|---|
| `tablon_nueva_aplicacion` | `AFTER INSERT` en `aplicaciones_tablon` | Cliente dueño del caso | `/pages/tablon-caso?id=<caso_id>` |
| `tablon_elegido` | `aplicaciones_tablon.estado → ELEGIDO` | Abogado elegido | `/pages/tablon-caso?id=<caso_id>` |
| `tablon_caso_cerrado` | `casos_tablon.estado → CERRADO` | Cada abogado que seguía `PENDIENTE` en ese caso | `/pages/tablon` |
| `tablon_caso_expirado` | `casos_tablon.estado → EXPIRADO` (incluye el cron `expirar-casos-tablon`) | Cliente dueño del caso | `/pages/tablon` |
| `solicitud_cancelada` | `solicitudes.estado → CANCELADA` | Abogado de la solicitud | `/pages/panel-abogado?tab=solicitudes` |

**`tablon_caso_cerrado` está atado al cierre real del caso, no al primer `ELEGIDO`**: CLAUDE.md §17 permite elegir a más de un aplicante para el mismo caso, así que un aplicante `PENDIENTE` no pierde su oportunidad solo porque otro fue elegido — recién al cerrar el caso (`fn_notificar_estado_caso_tablon`) se sabe que no habrá más elecciones, y ahí se notifica a todos los que seguían `PENDIENTE`. `tablon_elegido` es un trigger aparte (`fn_notificar_elegido_tablon`), independiente del ya existente `fn_crear_solicitud_desde_tablon` — Postgres permite varios triggers sobre el mismo evento (`AFTER UPDATE OF estado ON aplicaciones_tablon`), mismo criterio que `trg_revelar_contacto`/`trg_solicitudes_updated_at` en `solicitudes`.

**Los destinos `tablon_caso_cerrado`/`tablon_caso_expirado` apuntan a `/pages/tablon` sin `?tab=`**: el enunciado original pedía `/pages/tablon?tab=aplicaciones` y `?tab=mis-casos`, tabs que existían en el `tablon.html` previo al rediseño de El Tablón (§17). Ese rediseño separó `tablon.html` (listado) de `tablon-caso.html` (detalle de un caso) y `tablon.html` ya no tiene ese concepto de tabs internas.

`solicitud_cancelada` se agregó como una rama más de la función ya existente `fn_notificar_estado_solicitud` (no un trigger nuevo — esa función ya está enganchada a `AFTER UPDATE OF estado ON solicitudes`).

### Comportamiento del dropdown (`frontend/js/notificaciones.js`)
- El dropdown siempre muestra las últimas 7 notificaciones (`api.notificaciones.getUltimas(7)`), leídas y no leídas — antes solo mostraba no leídas.
- Las leídas se renderizan con `.notificaciones__item--leida` (opacidad reducida), no se ocultan.
- El badge de la campana cuenta únicamente las no leídas (`api.notificaciones.getNoLeidas().length`, sigue siendo una consulta separada e independiente de la lista de 7 — puede haber más no leídas de las que caben en el dropdown).
- El botón "Marcar todas como leídas" se movió del header del dropdown a un pie fijo debajo de la lista (`#notificacionesPie`), oculto si no hay ninguna notificación. **Superseded por §31**: ese botón se quitó del dropdown; el pie ahora es un link "Ver todas mis notificaciones" a `notificaciones.html`, donde vive la acción de marcar todas como leídas.
- Las URLs de destino (tabla de arriba) las genera cada trigger de la base de datos directamente en `url_destino` al insertar — `notificaciones.js` nunca mapea `tipo → URL` en el cliente, solo navega a `n.url_destino` tal cual (mismo patrón que ya usaban `nueva_solicitud`/`solicitud_aceptada`/etc. desde la migración 025).

---

## 22. Solicitudes directas vs. solicitudes de El Tablón

### Qué es
La pestaña "Solicitudes" de `panel-cliente.html`/`panel-abogado.html` ya no lista solicitudes con filtros de estado inline — ahora muestra dos tarjetas grandes ("Solicitudes directas" / "Solicitudes del Tablón") que llevan a páginas independientes:
- `frontend/pages/solicitudes-directas.html` (`/pages/solicitudes-directas`) — solicitudes normales, enviadas desde búsqueda/perfil público.
- `frontend/pages/solicitudes-tablon.html` (`/pages/solicitudes-tablon`) — solicitudes originadas al elegir un aplicante en El Tablón (§17).

Ambas páginas son de rol dual (cliente o abogado, igual que `tablon.html`) y conservan el listado completo con filtros de estado, acciones y el toggle de seguimiento que antes vivían en la pestaña del panel.

### Modelo de datos (migración `20260714_049_caso_tablon_id_solicitudes.sql`)
`solicitudes` no tenía ninguna columna que la vinculara de vuelta al caso de El Tablón que la originó — `fn_crear_solicitud_desde_tablon` (047) solo copiaba título/descripción como texto libre en `descripcion_caso`. La 049 agrega `solicitudes.caso_tablon_id` (FK a `casos_tablon`, NULL para solicitudes directas) y la completa en el mismo INSERT del trigger. `panel_solicitudes_abogado`/`panel_solicitudes_cliente` exponen la columna (agregada al final del SELECT — `CREATE OR REPLACE VIEW` exige conservar nombre/orden/tipo de las columnas existentes, mismo criterio que la migración 039).

`api.solicitudes.getSolicitudesAbogado(origen)`/`getSolicitudesCliente(origen)` (`frontend/js/api.js`) aceptan `'directa'` (`.is('caso_tablon_id', null)`), `'tablon'` (`.not('caso_tablon_id', 'is', null)`) o ningún argumento (sin filtrar — así es como `panel-abogado.js`/`panel-cliente.js` siguen usándolo para el conteo de pendientes/activas en Inicio).

### Por qué una solicitud de El Tablón nunca puede estar PENDIENTE/RECHAZADA/EXPIRADA/CANCELADA
`fn_crear_solicitud_desde_tablon` inserta la fila y en el mismo trigger la mueve a `ACEPTADA` (fix 047, para reutilizar `fn_revelar_contacto_al_aceptar`). Como nunca pasa por `PENDIENTE`, ninguna de las transiciones que dependen de ese estado (`abogado_responde_solicitud` → RECHAZADA, el cron de expiración → EXPIRADA, `cliente_cancela_solicitud` → CANCELADA, ni la edición de `descripcion_caso`/`disponibilidad_horaria` vía `cliente_edita_solicitud_pendiente`) es alcanzable. Por eso `solicitudes-tablon.js` no incluye botones de aceptar/rechazar/cancelar/editar en ninguna de las dos vistas de rol — existen solo en `solicitudes-directas.js`, donde sí aplican.

### Frontend
- `frontend/js/solicitudes-directas.js` y `frontend/js/solicitudes-tablon.js` son independientes entre sí (mismo criterio de páginas autocontenidas que `tablon.js`/`tablon-caso.js`, §17): cada uno resuelve el rol (`perfiles.rol`) al cargar y renderiza la tarjeta de solicitud correspondiente (abogado ve datos del cliente y acciones sobre la solicitud entrante; cliente ve datos del abogado y acciones sobre su propia solicitud).
- En `solicitudes-tablon.js`, cada tarjeta agrega un enlace "Ver caso en El Tablón" (`/pages/tablon-caso?id=<caso_tablon_id>`) y, del lado del abogado, revela nombre completo/email/teléfono del cliente en cuanto la solicitud está `ACEPTADA` (siempre lo está, salvo el instante de creación) — con una nota adicional si el caso se publicó como anónimo (`caso_tablon_anonimo`, ver abajo).

### Datos de contacto en tablon-caso.html (migración `20260714_050_contacto_tablon_caso_detalle.sql`)
`tablon_caso_detalle` nunca expuso teléfono/email del cliente, solo `cliente_nombre` (con la regla de anonimato de §17). La 050 agrega `cliente_telefono`/`cliente_email` vía subquery contra `solicitudes` (`WHERE s.caso_tablon_id = c.id AND s.abogado_id = auth.uid()`) — solo resuelve datos cuando quien consulta es el abogado elegido para ese caso (esa es la única situación en la que existe una fila de `solicitudes` con ese par caso/abogado); para el cliente dueño y para cualquier otro abogado ambas columnas son NULL. `panel_solicitudes_abogado` se extiende igual con `caso_tablon_anonimo` (subquery a `casos_tablon.anonimo` vía `caso_tablon_id`), para que `solicitudes-tablon.js` pueda mostrar la nota de anonimato sin una query aparte.

`tablon-caso.js` renderiza la sección "Datos de contacto" (`#seccionContactoCaso`) solo cuando `casoActual.mi_aplicacion_estado === 'ELEGIDO'` — coincide exactamente con cuándo esas dos columnas tienen valor, así que no hace falta ninguna otra condición.

---

## 23. Dashboard cliente: accesos rápidos y últimos abogados

`panel-cliente.html`, pestaña "Inicio": los tres botones de `.accesos-rapidos` ahora envuelven título y descripción en `<span class="acceso-rapido__titulo">`/`<span class="acceso-rapido__descripcion">` (antes era texto plano) — `.acceso-rapido` pasó de `display: block` a `display: flex; flex-direction: column` para apilarlos.

Debajo se agregó "Últimos abogados con los que trabajó": hasta 3 abogados con solicitud `ACEPTADA`/`COMPLETADA`/`RESEÑADA` (directa o de El Tablón, sin distinción — misma condición que la pestaña "Mis abogados"). `api.clientes.getUltimosAbogados()` (`frontend/js/api.js`) reutiliza la vista `panel_abogados_contactados` (migración 034) con `.limit(3)`, sin necesidad de una vista ni migración nueva. `renderizarUltimosAbogados()` (`frontend/js/panel-cliente.js`) reutiliza `generarCardAbogadoContactado()`, la misma tarjeta que ya usaba "Mis abogados" — cubre de sobra "foto/iniciales, nombre clickeable, especialidad, botón 'Nueva consulta'" sin duplicar el render.

`clientes` es un namespace nuevo en `api.js` (junto a `solicitudes`, `tablon`, etc.) para consultas organizadas por perspectiva del panel en vez de por tabla — hoy solo tiene esta función.

---

## 24. Accesos rápidos de header, toast de seguimiento y límite diario configurable

### El Tablón / En seguimiento en el header
> **Superseded por §26.** Esta lógica ahora vive en `inicializarHeader()` (`frontend/js/header.js`), que además unificó el header de `busqueda.html`/`perfil-abogado.html` con el resto de la app (antes tenían su propio markup con `nombreUsuario`/`btnCerrarSesion`/`btnIniciarSesion` hardcodeados, causa del bug corregido en §26).

`inicializarMenuPerfil()` (`frontend/js/menu-perfil.js`) inserta ahora dos enlaces ("El Tablón", "En seguimiento") al inicio de `.nav-usuario` antes de armar el avatar — visibles en toda página que llama a esta función (paneles, `tablon.html`, `tablon-caso.html`, `solicitudes-directas.html`, `solicitudes-tablon.html`). "En seguimiento" apunta a `${rutaPanelPropio(rol)}?tab=seguimiento` (mismo mecanismo `aplicarTabDesdeUrl()` de §18). Esto reemplaza el enlace "El Tablón" que antes vivía hardcodeado en el HTML de `panel-cliente.html`/`panel-abogado.html` — se centralizó para no duplicarlo página por página.

### Acceso rápido "Publicar en El Tablón"
Cuarto botón en `.accesos-rapidos` de `panel-cliente.html` → `/pages/tablon-publicar` (desde el rediseño de El Tablón en formato foro, §25, el formulario vive en su propia página — el acceso rápido enlaza directo, sin pasar por `tablon.html`).

### Toast de seguimiento
`MENSAJE_AGREGADO_SEGUIMIENTO` (`frontend/js/utils.js`) centraliza el texto que antes era el literal `'Agregado a seguimiento.'`, repetido en los 7 lugares donde se hace toggle de seguimiento (paneles, `solicitudes-directas.js`, `solicitudes-tablon.js`, `tablon.js`, `tablon-caso.js` ×2). El mensaje de "quitar" (`'Quitado de seguimiento.'`) no cambió — sigue inline en cada call site, no ameritaba su propia constante.

### "Volver a solicitudes" en las páginas de solicitudes
`solicitudes-directas.html`/`solicitudes-tablon.html` agregaron `btnVolverSolicitudes` junto al `btnVolverPanel` existente, apuntando a `${rutaPanelPropio(rolActual)}?tab=solicitudes` (pestaña "Mis solicitudes" del panel, no la portada).

### Límite diario de publicaciones en El Tablón (configurable)
CLAUDE.md §17 documentaba el límite de 2 casos/día como hardcodeado en el trigger `fn_verificar_limite_casos_tablon`. La migración `20260714_051_config_limite_publicaciones_tablon.sql` lo vuelve configurable, con el mismo patrón que `limite_aplicaciones_abogado` (migración 040, §17): agrega la clave `limite_publicaciones_diarias_cliente` a `config_tablon` (valor inicial `'2'`, preserva el comportamiento previo) y reescribe la función para leer el límite de ahí — `NULL` = sin límite. No hizo falta ningún GRANT nuevo: la tabla y la función ya existían con sus permisos (§12).

`panel-admin.html`/`panel-admin.js`, pestaña "Configuración", agregan un segundo campo al mismo `formConfigTablon` ya existente para "El Tablón" — reutiliza `api.tablon.getConfigTablon()`/`actualizarConfigTablon(clave, valor)` (ya genéricos por clave desde la migración 040) en vez de crear un namespace `admin.getConfig()/setConfig()` nuevo que hubiera duplicado exactamente esas dos funciones.

`tablon.js` deja de asumir el límite en 2: `cargarMisCasos()` trae `config_tablon` en paralelo con `getMisCasos()` y guarda `limitePublicacionesDiarias` (`null` = sin límite). `actualizarAvisoLimiteCasos()` arma el texto del aviso con ese valor en vez de un string fijo en el HTML. `api.tablon.publicarCaso()` ya no hardcodea el mensaje de error del hint `LIMITE_CASOS_TABLON` — usa `error.message` tal cual lo devuelve el trigger (que ya interpola el límite configurado con `%`).

---

## 25. El Tablón en formato foro, especialidad opcional, checkbox de seguimiento

### Especialidad opcional al publicar
`casos_tablon.especialidad` era `NOT NULL` (migración 040) — el cliente no siempre sabe a qué especialidad corresponde su caso. Migración `20260718_052_especialidad_opcional_y_fix_caso_tablon.sql`: `ALTER TABLE casos_tablon ALTER COLUMN especialidad DROP NOT NULL` (el `CHECK` de valores permitidos ya admite `NULL` sin cambios — una expresión `IN` con `NULL` evalúa a `NULL`, que un `CHECK` trata como válido). En el frontend, `tablon-publicar.html` quitó el `required` del `<select>` y ofrece "No estoy seguro / No aplica"; todos los listados de casos (`tablon.js`, `tablon-caso.js`, `panel-cliente.js`, `panel-abogado.js`) muestran "Sin especialidad definida" cuando es `NULL`.

### Rediseño de `tablon.html`: layout de foro
`tablon.html` pasó de "formulario + lista inline" a un layout de dos columnas (`.tablon-layout`, grid `7fr 3fr` desde `min-width: 1024px`, una sola columna en mobile):
- **Columna principal** (`.tablon-layout__principal`): listado de casos en tarjetas — título ahora es un enlace (`.caso-tablon-card__titulo a`) a `tablon-caso.html?id=<id>`, además del botón "Ver caso" que ya existía. Cada tarjeta muestra especialidad, caso común, ubicación, tiempo transcurrido (`formatearTiempoTranscurrido()`, mismo formato "hace N días" que ya usaban las solicitudes), número de aplicaciones y, si el caso es anónimo, el badge `.badge--anonimo` ("Publicado como anónimo") en la vista del cliente dueño.
- **Columna lateral** (`.tablon-layout__lateral`, `.tablon-panel-lateral`, `position: sticky` en desktop): para el cliente, un botón grande "Publicar un caso" que enlaza a `tablon-publicar.html` (deshabilitado visualmente con `.btn--deshabilitado`/`aria-disabled` cuando se alcanzó `config_tablon.limite_publicaciones_diarias_cliente`, mismo cálculo que antes); para el abogado, el panel de filtros (especialidad, caso común y el nuevo filtro de provincia).

### Formulario de publicación: página independiente
El formulario que antes vivía inline en `tablon.html`/`tablon.js` se movió por completo a `frontend/pages/tablon-publicar.html` + `frontend/js/tablon-publicar.js` (`/pages/tablon-publicar`, solo `rol='cliente'`). `tablon.js` ya no tiene ninguna lógica de formulario — solo lista casos. El acceso rápido "Publicar en El Tablón" del dashboard cliente (§24) enlaza directo a esta página.

### Filtro de provincia para el abogado
`api.tablon.getCasosActivos(provincia)` (`frontend/js/api.js`) acepta ahora un parámetro opcional; sin él, el abogado sigue viendo casos de todas las provincias (comportamiento por defecto sin cambios). `tablon.html` agrega `#filtroProvinciaTablon` (24 provincias + "Todas las provincias") en el panel lateral del abogado — a diferencia de los filtros de especialidad/caso común (que filtran en el cliente sobre los datos ya cargados), el de provincia dispara un nuevo `cargarCasosActivos()` porque filtra server-side vía `.eq('provincia', provincia)` contra la vista `tablon_casos_abogado` (que ya expone `provincia` desde la migración 041).

### Checkbox de seguimiento
El botón "Seguimiento"/"En seguimiento" se reemplazó en toda la app por un checkbox: `generarCheckboxSeguimiento(idSeguro, marcado)` en `frontend/js/utils.js` genera el bloque `.seguimiento-check` (checkbox + "Marcar para seguimiento" + texto de ayuda "Las solicitudes y casos marcados aparecen en su sección 'En seguimiento' para acceso rápido", alineado a la esquina inferior derecha de la tarjeta vía `align-items: flex-end` en `.seguimiento-check`). El `<input>` conserva `data-accion="toggle-seguimiento"`/`data-id`, así que los listeners de `click` ya existentes en cada página (delegados sobre el contenedor de la lista) siguen funcionando sin cambios — los checkboxes disparan `click` igual que los botones que reemplazan. Único caso con listener propio: el checkbox de la aplicación del abogado en `tablon-caso.html` (`#checkSeguimientoAplicacion`, antes `#btnSeguimientoAplicacion`) escucha `change` en vez de `click`, porque no vive dentro de una lista con delegación de eventos. Call sites: `tablon.js`, `tablon-caso.js` (×2), `solicitudes-directas.js` (×2), `solicitudes-tablon.js` (×2), `panel-cliente.js`, `panel-abogado.js`. El toast de confirmación (`MENSAJE_AGREGADO_SEGUIMIENTO`) no cambió.

### Fix: solicitudes de El Tablón no aparecían en `solicitudes-tablon.html` (vista cliente)
Causa raíz: `idx_solicitud_activa_unica` exige una única solicitud activa (`PENDIENTE`/`ACEPTADA`) por par `(cliente_id, abogado_id)`. Si el cliente ya tenía una solicitud activa con ese abogado (de una consulta directa anterior, o de otro caso del Tablón) al elegir un aplicante nuevo, el `INSERT` de `fn_crear_solicitud_desde_tablon` chocaba contra ese índice y cae en la rama `EXCEPTION`, que (desde 047/049) no hacía nada más que descartar el vínculo: la aplicación quedaba `ELEGIDO` pero ninguna fila de `solicitudes` terminaba con ese `caso_tablon_id`, así que nunca aparecía en `solicitudes-tablon.html` aunque el cliente sí hubiera elegido a alguien. Esto no era un caso raro: cualquier cliente que ya tuviera una consulta activa con un abogado (por búsqueda normal o por otro caso del Tablón) y volviera a elegirlo desde un caso nuevo se topaba con el bug.

Migración `20260718_052_especialidad_opcional_y_fix_caso_tablon.sql` cambia la rama `EXCEPTION WHEN unique_violation` para vincular la solicitud activa existente al caso recién elegido (`UPDATE solicitudes SET caso_tablon_id = COALESCE(caso_tablon_id, v_caso.id) WHERE cliente_id = ... AND abogado_id = ... AND estado IN ('PENDIENTE','ACEPTADA')`) en vez de no hacer nada — `COALESCE` evita pisar el vínculo de una elección anterior si esa misma solicitud ya venía de otro caso del Tablón. Esto reemplaza la política documentada previamente en §22 de dejar la solicitud "directa" en su origen: ahora el cliente siempre encuentra en `solicitudes-tablon.html` el resultado de haber elegido a alguien en El Tablón, sin duplicar la fila de `solicitudes`. La misma migración hizo un backfill puntual sobre los datos de prueba ya existentes en producción que habían quedado sin vincular.

---

## 26. Header centralizado (`frontend/js/header.js`)

### Problema
El header mostraba estados inconsistentes según la página: `busqueda.html` y `perfil-abogado.html` tenían su propio markup independiente (`nombreUsuario` en texto plano + `btnCerrarSesion`/`btnIniciarSesion` ambos en el DOM, alternando `hidden` por JS) que en algunos casos dejaba "Salir" e "Iniciar sesión" visibles a la vez si la lógica de sesión fallaba a mitad de camino; `panel-admin.html` tampoco usaba el menú de perfil con foto (§18) sino el mismo patrón de nombre en texto plano. Cada página duplicaba su propia versión de "¿hay sesión? ¿qué rol?" en vez de tener una única fuente de verdad.

### Solución
`frontend/js/header.js` reemplaza a `menu-perfil.js` (§18, eliminado) y absorbe también el "Ver como" que antes vivía en `panel-admin.js`. Expone `inicializarHeader(opciones)`:
- Páginas donde el caller ya resolvió sesión y perfil (todos los paneles, El Tablón, solicitudes, referidos, cambiar-contraseña): `inicializarHeader({ rol, nombre, fotoPath, urlPerfilPublico? })` — nunca vuelve a golpear la base, solo renderiza.
- Páginas públicas donde puede o no haber sesión (`busqueda.html`, `perfil-abogado.html`): `await inicializarHeader()` sin argumentos resuelve `getSession()`/`getPerfilActual()` internamente y devuelve el perfil resuelto (o `null`), que el caller puede reutilizar sin duplicar la consulta.
- Páginas que nunca deben reflejar sesión aunque exista una activa (`recuperar-contrasena.html`, `nueva-contrasena.html` — acá la sesión es de tipo `recovery`, no un login real — y la landing `index.html` una vez confirmado que no hay sesión): `inicializarHeader({ forzarAnonimo: true })`.

En los tres casos el resultado es exactamente uno de dos estados — nunca ambos ni ninguno: con datos de usuario renderiza logo (link al panel propio), enlaces rápidos "El Tablón"/"En seguimiento" (solo `cliente`/`abogado`), la campana de `notificaciones.js` (sin cambios, sigue posicionándose antes de `#menuPerfil`) y el avatar con menú desplegable (`Editar perfil` — cliente y abogado, apunta a la página dedicada de cada rol, ver §27 —, `Ver mi perfil público` y `Referir un colega` solo abogado, `Cambiar contraseña`, `Cerrar sesión`); sin datos de usuario renderiza solo el botón "Iniciar sesión". Para `rol='admin'` agrega además el dropdown "Ver como" (navegación en pestaña nueva a `busqueda`/`panel-abogado`, no cambia la sesión del admin) — mismo componente `configurarMenuDesplegable()` genérico que ya usa el menú de avatar.

### Páginas sin `<nav class="nav-usuario">` previamente
`cambiar-contrasena.html`, `recuperar-contrasena.html`, `nueva-contrasena.html` e `index.html` no tenían ningún elemento de navegación de usuario en el header (solo el logo) — se les agregó el `<nav class="nav-usuario">` vacío para que `inicializarHeader()` tenga dónde renderizar.

### Actualizar avatar tras subir foto
`actualizarAvatarHeader(fotoPath, nombre)` reemplaza a `actualizarAvatarMenuPerfil()` — misma firma, mismo `id="menuPerfilAvatar"`.

---

## 27. Editar perfil como página independiente

### Qué cambió
La edición de perfil deja de ser una pestaña interna de `panel-cliente.html`/`panel-abogado.html` y pasa a ser una página propia por rol, accesible únicamente desde "Editar perfil" en el menú de avatar del header (§26):

| Rol | Página | Reemplaza a |
|---|---|---|
| `cliente` | `frontend/pages/editar-perfil-cliente.html` | sección `seccionPerfil` (sr-only, `?tab=perfil`) de `panel-cliente.html` |
| `abogado` | `frontend/pages/editar-perfil-abogado.html` | pestaña visible "Editar perfil" de `panel-abogado.html` |

`panel-abogado.html` queda con cuatro pestañas visibles (Inicio · Solicitudes · Reseñas · Mi suscripción) más "En seguimiento" — esta última no se ocultó: el pedido original de simplificar el orden de pestañas apuntaba a sacar "Editar perfil", no a esconder seguimiento, que ya es accesible en un clic desde el header (§24).

### Campo nuevo: nombre completo del cliente
`editar-perfil-cliente.html` agrega un campo "Nombre completo" que el cliente no podía editar antes (`panel-cliente.html` solo tenía teléfono/provincia/ciudad). No hizo falta ninguna migración: `api.perfiles.actualizarPerfil()` ya incluía `nombre_completo` en su lista blanca de columnas (`frontend/js/api.js`) y la política RLS `perfil_propio_update` (migración `20260707_026_fix_rls_perfiles.sql`) ya permite actualizar cualquier columna propia salvo `rol` — el campo simplemente no se exponía en el formulario. El perfil del abogado no agrega este campo por no haber sido parte del pedido; su nombre se sigue editando solo indirectamente (no hay campo de edición de nombre para abogados en este módulo).

### Código duplicado deliberadamente: `calcularPorcentajePerfil()`
`panel-abogado.js` conserva su propia copia de `calcularPorcentajePerfil()` (5 líneas) porque el badge "Perfil completo ✓" de la cabecera y el banner de onboarding ("Complete su perfil...") viven en el panel, no en la página de edición — moverla a un módulo compartido por una función de 5 líneas usada en dos archivos hubiera sido una abstracción prematura (CLAUDE.md, sección "Doing tasks"). El banner de onboarding ahora es un link (`<a href="/pages/editar-perfil-abogado">`) en vez de un botón que cambiaba de pestaña.

### Foto y avatar del header
Ambas páginas nuevas suben la foto con `api.perfiles.subirFotoPerfil()` (sin cambios) y llaman a `actualizarAvatarHeader()` (§26) para que el avatar del header se actualice sin recargar la página — mismo patrón que ya usaban los paneles.

---

## 28. Todos los casos del Tablón visibles en "Solicitudes del Tablón" (vista cliente)

### Problema
`solicitudes-tablon.html` (vista cliente) mostraba solo las `solicitudes` con `caso_tablon_id` — es decir, únicamente los casos donde el cliente ya había elegido a un abogado (§17: la elección crea la solicitud directamente en `ACEPTADA`). Un caso `ACTIVO` sin aplicaciones, o incluso con aplicaciones pero sin ningún elegido, o ya `CERRADO`/`EXPIRADO` sin elección, no aparecía en ningún lado de "Solicitudes del Tablón" — el cliente solo podía verlo desde `tablon.html` mientras estuviera entre "Mis casos".

### Solución
La vista cliente de `solicitudes-tablon.js` pasa de listar `solicitudes` a listar `casos_tablon` propios vía `api.tablon.getMisCasos()` (vista `tablon_casos_cliente`, migración 040) — **sin necesidad de ninguna migración**: esa vista ya devuelve todos los estados (`ACTIVO`/`CERRADO`/`EXPIRADO`) y ya incluye `total_aplicaciones`; el filtro por estado nunca existió ahí. Los filtros de la página pasan de ser por estado de solicitud (`PENDIENTE`/`ACEPTADA`/...) a estado de caso (`Todos`/`Activos`/`Cerrados`/`Expirados`) — `renderizarFiltros()` ahora arma los botones de `.filtro-tipo` dinámicamente según el rol en vez de tenerlos hardcodeados en el HTML, porque abogado y cliente necesitan opciones distintas en el mismo contenedor (`#filtrosEstado`).

La vista abogado no cambia: sigue listando `solicitudes` con origen Tablón y sus filtros por estado de solicitud, sin tocar.

### Se preservó "marcar completada" / "dejar reseña"
El cambio de fuente de datos (de `solicitudes` a `casos_tablon`) por sí solo hubiera eliminado la única superficie de la app donde un cliente puede cerrar y reseñar una consulta iniciada desde El Tablón (`tablon-caso.html` nunca tuvo esas acciones). Para no perder esa funcionalidad, `cargarMisCasos()` trae en paralelo `getMisCasos()` y `getSolicitudesCliente('tablon')`, arma un mapa `caso_tablon_id → solicitud` y `generarCasoClienteCard()` embebe las acciones de esa solicitud (si existe) dentro de la tarjeta del caso vía `generarAccionesSolicitudCliente()` — mismo markup y lógica que tenía la tarjeta de solicitud que se eliminó, solo que ahora vive dentro de la tarjeta del caso en lugar de ser una tarjeta aparte.

---

## 29. Límite de solicitudes directas y origen independiente del Tablón

### Migración `20260719_053_limite_solicitudes_directas_y_origen_independiente.sql`
Dos cambios sobre `idx_solicitud_activa_unica` (migración 006), el índice único que hasta ahora impedía más de una solicitud activa (`PENDIENTE`/`ACEPTADA`) por par cliente-abogado, sin distinguir origen:

1. **Límite de solicitudes directas: de 1 a 3 activas simultáneas.** Un índice único solo puede garantizar "como máximo 1 fila" — para "como máximo 3" hace falta un trigger que cuente, mismo patrón que `fn_verificar_limite_casos_tablon` (§17). `fn_verificar_limite_solicitudes_directas()` (`BEFORE INSERT ON solicitudes`) cuenta las solicitudes directas activas (`caso_tablon_id IS NULL`) del par cliente-abogado y rechaza el INSERT a partir de la cuarta, con `RAISE EXCEPTION ... USING HINT = 'LIMITE_SOLICITUDES_DIRECTAS'` — mismo mecanismo de hint que `LIMITE_CASOS_TABLON` (§17/§24). La función retorna inmediatamente sin contar nada si `NEW.caso_tablon_id IS NOT NULL`: el límite es exclusivo de solicitudes directas.

2. **Origen directa y origen Tablón dejan de compartir el control de actividad.** `idx_solicitud_activa_unica` se reemplaza por `idx_solicitud_activa_unica_tablon`, con la misma condición de estado pero acotada a `caso_tablon_id IS NOT NULL` — el origen Tablón conserva el límite de 1 activa simultánea (un cliente no debería tener dos consultas activas con el mismo abogado elegidas desde dos casos distintos del Tablón a la vez), pero ya no choca contra una solicitud directa activa con ese mismo abogado, ni viceversa. Esto vuelve innecesaria (pero no incorrecta) la rama `EXCEPTION WHEN unique_violation` que la migración 052 agregó a `fn_crear_solicitud_desde_tablon` para el caso directa-choca-con-tablon — esa rama ahora solo se activa en el caso tablon-choca-con-tablon, que sigue siendo válido.

### Frontend
`api.solicitudes.crearSolicitud()` (`frontend/js/api.js`) distingue `error.hint === 'LIMITE_SOLICITUDES_DIRECTAS'` antes de caer al chequeo genérico de `error.code === '23505'` (que en la práctica ya no se dispara para solicitudes directas, solo queda como red de seguridad). El mensaje del trigger se agregó a `MENSAJES_ERROR_CONOCIDOS` en `frontend/js/utils.js` para que `mensajeAmigable()` lo muestre tal cual en vez de caer al mensaje genérico de cada pantalla.

### "¿Cuándo prefiere ser contactado?"
El campo `disponibilidad_horaria` se pedía bajo el título "Disponibilidad horaria", ambiguo sobre si se refería a la disponibilidad del cliente o del abogado. Se cambió el título (y su `aria-label`) a "¿Cuándo prefiere ser contactado?" en los tres lugares donde el cliente completa este campo: el formulario inicial de solicitud (`perfil-abogado.html`) y los formularios de edición de una solicitud ya enviada (`panel-cliente.js` y `solicitudes-directas.js`, sección "En seguimiento"/"Mis solicitudes" respectivamente). La etiqueta de solo lectura "Disponibilidad:" que ve el abogado al revisar una solicitud no se tocó — ahí no hay ambigüedad de a quién pertenece el dato.

---

## 30. Tiempo mínimo de 24h para reseñar

### Migración `20260720_054_resena_minimo_24h.sql`
`solicitudes.completada_at` ya existía desde la migración 006 y ya se setea con `now()` en `fn_revelar_contacto_al_aceptar` al transicionar `ACEPTADA → COMPLETADA` (única transición posible hacia `COMPLETADA`) — no hizo falta agregar ninguna columna ni tocar ningún trigger de `solicitudes`. Solo se extendió la política RLS `cliente_inserta_resena` (tabla `resenas`, migración 007) para exigir además `s.completada_at IS NOT NULL AND s.completada_at <= now() - INTERVAL '24 hours'`.

### Frontend: gate proactivo + mensaje de error
En vez de mostrar siempre el botón "Dejar reseña" y depender solo del error de la base de datos, `panel-cliente.js`, `solicitudes-directas.js` y `solicitudes-tablon.js` calculan `haPasadoTiempoMinimoResena(s.completada_at)` (duplicada en los tres archivos, igual que el resto de los helpers de fecha de cada uno) para decidir si mostrar el botón o, en su lugar, el texto "Podrá dejar su reseña 24 horas después de completada la consulta." Esto es solo UX — la validación real sigue viviendo en la política RLS, así que si igual se intenta el INSERT antes de tiempo (reloj desincronizado, sesión vieja abierta), `api.resenas.crearResena()` (`frontend/js/api.js`) detecta `error.code === '42501'` (`insufficient_privilege`, RLS `WITH CHECK` rechazado) y devuelve ese mismo mensaje — agregado a `MENSAJES_ERROR_CONOCIDOS` en `utils.js` para que se muestre tal cual.

---

## 31. Página de todas las notificaciones

### Qué es
`frontend/pages/notificaciones.html` + `frontend/js/notificaciones-pagina.js` — accesible desde el nuevo botón fijo "Ver todas mis notificaciones" en el pie del dropdown de la campana (reemplaza a "Marcar todas como leídas", que se quitó de ahí). Lista todas las notificaciones del usuario autenticado (cualquier rol), leídas y no leídas, agrupadas en "Hoy" / "Esta semana" / "Anteriores" (se omite el grupo si no tiene elementos), con un filtro por tipo y paginación de 20 por página.

No es una página exclusiva de un rol: reutiliza `inicializarHeader()` (§26) con el rol que sea, igual que hace `panel-admin.js` con la campana — un admin también puede llegar acá.

### `api.notificaciones.getTodas(pagina)`
Nueva función en `frontend/js/api.js`, junto a `getUltimas()` (dropdown, tope de 7) y `getNoLeidas()` (badge). Usa `.range()` de PostgREST con `{ count: 'exact' }` para paginar de a 20 sin traer toda la tabla — retorna `{ data, total, error }`, donde `total` es el conteo real (no el tamaño de la página actual), usado para calcular el total de páginas.

### Filtro por tipo: simplificación deliberada
El filtro de tipo se aplica en el cliente sobre la página ya cargada (20 filas), no como un parámetro de `getTodas()` — la paginación de la base de datos es por fecha únicamente. Es una simplificación deliberada: filtrar y paginar combinados hubiera requerido un `count` distinto por cada combinación de filtro, y en la práctica un usuario rara vez acumula más de una página de notificaciones de un tipo específico. Si en el futuro se necesita filtrar sobre el histórico completo, `getTodas()` tendría que aceptar un `tipo` opcional y aplicar `.eq('tipo', tipo)` antes del `.range()`.

### "Marcar todas como leídas": se preservó, cambió de lugar
El pedido original solo decía "eliminá el botón del dropdown" — se agregó el mismo botón en `notificaciones.html` (llama a la misma `api.notificaciones.marcarTodasLeidas()`, sin cambios) para no perder la funcionalidad, ahora en el lugar donde tiene más sentido: la página con el historial completo, no un dropdown de 7 elementos.

### CSS: `.notificaciones__lista--pagina`
La lista de la página reutiliza `.notificaciones__lista`/`.notificaciones__item` del dropdown (mismo look), pero sin `.menu-desplegable__lista` (que la posicionaría `absolute` como un popup) y con el modificador `.notificaciones__lista--pagina` (`frontend/css/main.css`) que anula `max-width`/`max-height`/`min-width` — esas restricciones existían solo para que el dropdown no ocupara toda la pantalla.

---

## 32. Sistema de favoritos para clientes

### Migración `20260721_055_favoritos.sql`
Tabla `favoritos` (`cliente_id`, `abogado_id`, `UNIQUE(cliente_id, abogado_id)`) con RLS: el cliente solo ve/inserta/borra sus propios favoritos (`cliente_inserta_favorito` exige además `rol = 'cliente'`, mismo patrón que `cliente_crea_solicitud`). GRANT `SELECT, INSERT, DELETE` — sin `UPDATE`: el toggle del frontend siempre inserta o borra, nunca actualiza una fila existente.

`panel_favoritos_cliente` es una vista nueva para la pestaña "Favoritos" (foto, nombre, especialidades, provincia), con el mismo patrón que `panel_abogados_contactados` (migración 034): join directo a `perfiles`/`abogados`/`provincias` sin bypass explícito de RLS — si un abogado favorito deja de ser visible (verificación revocada, suscripción vencida), su fila simplemente no aparece. (El advisor de seguridad marca esta vista, junto con *todas* las demás vistas del proyecto sin excepción, como `SECURITY DEFINER` — es una característica preexistente de cómo Supabase crea las vistas acá, no algo introducido por esta migración; no se tocó.)

### `api.favoritos` (`frontend/js/api.js`)
- `getMisFavoritos()` — fila completa desde `panel_favoritos_cliente`, para la pestaña "Favoritos".
- `getMisFavoritosIds()` — solo los `abogado_id` (tabla `favoritos` directo, sin join), para que `busqueda.html`/`perfil-abogado.html` sepan qué corazón pintar relleno sin traer datos públicos completos.
- `toggle(abogadoId)` — busca si ya existe, borra si sí, inserta si no. Retorna `{ esFavorito, error }`.

### Botón de favorito (corazón) — `generarBotonFavorito()` en `utils.js`
Mismo criterio que `generarCheckboxSeguimiento()`: markup compartido, cada página trae su propio listener de `click` sobre `data-accion="toggle-favorito"`. Se renderiza solo para `rol === 'cliente'` (el call site decide, la función no verifica rol):
- `busqueda.html`: una tarjeta por resultado, esquina superior derecha (`.card-abogado` pasó a `position: relative`). El estado inicial de cada corazón sale de `getMisFavoritosIds()` cargado una sola vez al entrar a la página.
- `perfil-abogado.html`: un único botón en el encabezado del perfil (`#perfilFavoritoContenedor`, `.perfil-header` también pasó a `position: relative`).
- Pestaña "Favoritos" de `panel-cliente.html`: el corazón siempre sale relleno (ya son favoritos); togglearlo ahí siempre significa quitar, y la tarjeta se recarga desde `getMisFavoritos()` tras la confirmación.

### Pestaña "Favoritos" en `panel-cliente.html`
Entre "Mis abogados" y "Mis reseñas", como pidió el módulo. `generarCardFavorito()` reutiliza la estructura visual de `generarCardAbogadoContactado()` (misma clase `.card-abogado`) pero sin el badge "Consulta activa" ni la línea "Última interacción" — esos dos campos no existen en `panel_favoritos_cliente` (no hay noción de solicitud asociada a un favorito).

---

## 33. Sistema de bloqueos

### Migraciones `20260722_056_bloqueos.sql` y `20260722_057_cliente_id_panel_solicitudes_abogado.sql`
Tabla `bloqueos` (`bloqueador_id`, `bloqueado_id`, `UNIQUE(bloqueador_id, bloqueado_id)`, `CHECK (bloqueador_id <> bloqueado_id)`). RLS: cada usuario ve/crea/borra sus propios bloqueos (los que **él** creó, no los que recibió); admin ve y borra cualquiera.

**`fn_existe_bloqueo(uuid, uuid)`** — SECURITY DEFINER, `true` si hay un bloqueo entre dos usuarios en cualquier dirección. Mismo motivo que `fn_rol_perfil` (§ migración 026): evaluarla como subquery directo contra `bloqueos` desde una política de *otra* tabla dispararía una re-evaluación de las políticas de `bloqueos`. Se usa en tres lugares — el bloqueo es bidireccional una vez creado, sin importar quién bloqueó a quién:
- `cliente_crea_solicitud` (INSERT en `solicitudes`): agrega `AND NOT fn_existe_bloqueo(cliente_id, abogado_id)`.
- `busqueda_publica_abogados` (policy en `abogados`) y `abogado_perfil_visible_busqueda` (policy en `perfiles`): agregan `AND NOT fn_existe_bloqueo(auth.uid(), id)`.
- **`busqueda_abogados` (la vista):** como toda vista de este proyecto es `SECURITY DEFINER` (bypassea el RLS de arriba), el filtro de bloqueo tuvo que repetirse también en su propio `WHERE` — si no, las dos políticas de arriba no tendrían ningún efecto real, porque tanto la búsqueda (`busqueda.js`) como el detalle individual (`perfil-abogado.js`, vía `api.abogados.getAbogado()`) consultan esta vista, no las tablas directamente. La migración reconstruye la vista a partir de `pg_get_viewdef()` sobre la definición real en producción, no del archivo de la migración 009 original — acumuló columnas (`provincia_id`, `zonas_servicio_*`, `estudio_nombre`, etc.) en migraciones posteriores que el archivo original no refleja, y `CREATE OR REPLACE VIEW` no admite quitar columnas existentes (falla con `cannot drop columns from view` si el nuevo `SELECT` tiene menos columnas que la vista real).

**Límite conocido, fuera de alcance de este módulo:** `fn_crear_solicitud_desde_tablon` es `SECURITY DEFINER` y crea la solicitud sin pasar por la política `cliente_crea_solicitud` — un bloqueo no impide (todavía) que un cliente elija a un abogado bloqueado desde El Tablón. Igual de fuera de alcance: `fn_existe_bloqueo` queda ejecutable como RPC pública (`/rest/v1/rpc/fn_existe_bloqueo`) porque necesita `GRANT EXECUTE TO anon, authenticated` para que las políticas/vista de arriba funcionen para cualquier usuario — mismo patrón y mismo trade-off que ya tienen `es_admin()` y `fn_rol_perfil()` desde antes de este módulo (el advisor de seguridad marca los tres por igual).

**`fn_cancelar_solicitudes_al_bloquear()`** (trigger `AFTER INSERT ON bloqueos`) — SECURITY DEFINER porque ninguna política de `solicitudes` permite hoy cancelar desde `ACEPTADA`, ni que la parte no dueña de la fila la cancele (`cliente_cancela_solicitud`, migración 023, solo cubre PENDIENTE→CANCELADA por el propio cliente). Cancela toda solicitud `PENDIENTE`/`ACEPTADA` entre las dos partes y limpia `cliente_telefono`/`cliente_email` si ya estaban revelados (mismo criterio de privacidad que `fn_revelar_contacto_al_aceptar` ya aplica en un rechazo).

**`panel_solicitudes_abogado` gana la columna `cliente_id`** (antes solo exponía `cliente_nombre`/`cliente_foto`): sin el id no había forma de que el botón "Bloquear cliente" del frontend supiera a quién bloquear. Agregada al final del `SELECT`, mismo criterio que la migración 039.

**`admin_bloqueos`** — vista con nombre/rol de ambas partes para el panel de administración, filtrada con `WHERE es_admin()` (mismo patrón que `admin_suscripciones`/`admin_verificaciones_pendientes`, migración 018 — las vistas de este proyecto no heredan RLS, así que filtran explícitamente).

### `api.bloqueos` (`frontend/js/api.js`)
Además de los tres pedidos (`bloquear`, `desbloquear`, `getMisBloqueos`), se agregaron `getBloqueosActivos()` y `adminDesbloquear(bloqueoId)` para el panel de administración — el admin no es `bloqueador_id`, así que no puede usar `desbloquear(usuarioId)` (que borra por `bloqueador_id = auth.uid()`); necesita borrar por el id de la fila directamente, cubierto por la política `admin_elimina_bloqueo`.

### Modal de confirmación con countdown — `frontend/js/bloqueos.js`
> **Superseded por §37.** `bloqueos.js` se fusionó en `utils.js` como `abrirModalBloqueo()` (orden de argumentos y mensaje con viñetas distintos) — el archivo ya no existe. Esta sección se conserva por el contenido de dónde vivía cada call site en su momento.

`confirmarBloqueo(usuarioId, nombre)` es un módulo nuevo, no una extensión de `confirmar()` (`utils.js`): tiene su propio contador de 9 segundos deshabilitando "Confirmar bloqueo" (`Confirmar (9)` → `Confirmar (8)` → ... → `Confirmar bloqueo` habilitado), llama a `api.bloqueos.bloquear()` directamente y resuelve el toast de resultado — mezclar eso con el `confirmar()` genérico (que solo devuelve `boolean` sin tocar la red) hubiera complicado su única otra responsabilidad. Reutilizado sin cambios en:
- `perfil-abogado.html`: botón "Bloquear" dentro de un menú de opciones (⋮) nuevo, deliberadamente discreto — esquina opuesta al corazón de favoritos (`.perfil-header__opciones`, clase `.btn-icono-sutil`). Al confirmar, oculta las acciones de esa página y redirige a `/pages/busqueda` a los 2 segundos (el abogado deja de ser visible para este cliente por RLS, así que no tiene sentido seguir en su perfil).
- `panel-abogado.js` (tarjeta de solicitud de la pestaña "En seguimiento") y `solicitudes-directas.js` (tarjeta de solicitud del abogado, el lugar real donde un abogado revisa sus consultas desde el módulo 1): "Bloquear cliente" como texto de baja prominencia al fondo de la tarjeta (`.btn-enlace-sutil`), nunca un botón primario.

---

## 34. Fix: seguimiento en El Tablón desde el cliente

### Diagnóstico
El bug reportado ("aparece error y el caso no aparece en 'En seguimiento'" al marcar seguimiento desde el cliente) tiene la misma firma que el que la migración `20260712_046_fix_recursion_definitiva_tablon.sql` ya resolvió para otras dos políticas de `aplicaciones_tablon`/`casos_tablon`: `infinite recursion detected in policy` (Postgres 42P17). Esa migración deja documentado, tras una investigación extensa en producción, que el detector de recursión de RLS **no es determinístico** — es una guardia estructural en tiempo de planeación que puede dispararse según el plan exacto que elija el optimizador, no un análisis semántico confiable. Reproducir el flujo completo hoy (`BEGIN` + `SET LOCAL ROLE authenticated` + `request.jwt.claims` + `ROLLBACK`, mismo método que usó la 046) no disparó el error — pero `cliente_elige_aplicacion_tablon` (la política detrás de `api.seguimiento.toggleTablon()` del lado del cliente) y `cliente_ve_aplicaciones_de_sus_casos` (detrás del `SELECT` de `getMisSeguimientos()`) seguían usando exactamente el patrón fágil que la 046 ya había señalado como la causa raíz en esta misma tabla: una subconsulta correlacionada contra `casos_tablon` embebida directamente en la política.

### Migración `20260723_058_fix_seguimiento_tablon.sql`
`fn_cliente_dueno_caso_tablon(uuid)` — SECURITY DEFINER, mismo principio que `fn_rol_perfil`/`es_admin`/`fn_existe_bloqueo` (bypassea el RLS de `casos_tablon` por completo al evaluarse, así que no hay ninguna subconsulta correlacionada dentro de la política en sí). Reemplaza la subconsulta embebida en `cliente_elige_aplicacion_tablon` (UPDATE) y `cliente_ve_aplicaciones_de_sus_casos` (SELECT) — mismo alcance de acceso que antes, solo cambia el mecanismo de verificación por uno estructuralmente inmune a esta clase de bug, en vez de esperar a que un cambio de plan la vuelva a disparar en producción.

### Verificación
Se probó en vivo, contra la base de datos de producción, la secuencia completa que ejecuta el frontend: `UPDATE aplicaciones_tablon SET en_seguimiento_cliente = true` → `SELECT id, caso_id FROM aplicaciones_tablon WHERE en_seguimiento_cliente = true` → `SELECT ... FROM tablon_caso_detalle WHERE id = ...` (las tres consultas de `toggleTablon()` + `getMisSeguimientos()`), y por separado el flujo de "elegir abogado" (`UPDATE aplicaciones_tablon SET estado = 'ELEGIDO'`, que también depende de `cliente_elige_aplicacion_tablon`) — ambos sin errores después del fix. No se hizo una verificación de UI end-to-end (sin acceso a navegador en esta sesión); la verificación a nivel SQL reproduce exactamente las mismas consultas que emite el frontend vía PostgREST, con el JWT de un cliente real.

---

## 35. Fix: no se podía publicar en El Tablón

### Diagnóstico
`casos_tablon.especialidad` es `NULL`-able desde la migración 052 (§25: el cliente puede no saber a qué especialidad corresponde su caso), pero el `CHECK (especialidad IN (lista))` original (migración 040) nunca cambió — un `CHECK ... IN (...)` evalúa a `NULL` (válido) cuando el valor es `NULL`, pero a `FALSE` (constraint violado) cuando el valor es una cadena vacía `''`, porque `'' IN (lista)` no es lo mismo que `NULL IN (lista)`. `tablon-publicar.html` ofrece la opción "No estoy seguro / No aplica" con `value=""` — el cliente eligiéndola manda `''`, no `null`. `api.tablon.publicarCaso()` (`frontend/js/api.js`) ya convertía `caso_comun`/`provincia` vacíos a `null` antes de insertar, pero a `especialidad` se le olvidó el mismo tratamiento en la migración 052 — quedó insertando `''` tal cual, y el `INSERT` fallaba contra el `CHECK` en cualquier publicación sin especialidad seleccionada.

Verificado en vivo contra producción (`INSERT` de prueba dentro de una transacción con `ROLLBACK`, como cliente real): `especialidad = ''` dispara `23514 check constraint "casos_tablon_especialidad_check"`; `especialidad = NULL` inserta sin error. `config_tablon` y `fn_verificar_limite_casos_tablon()` se revisaron y funcionan correctamente (no eran la causa).

### Fix
`especialidad: datos.especialidad || null` en `api.tablon.publicarCaso()` — mismo patrón que ya usaban `caso_comun`/`provincia`. Sin migración: el `CHECK` de la base de datos ya era correcto, el bug era exclusivamente que el frontend nunca normalizaba `''` a `null` antes de insertar.

---

## 36. Corazón de favorito en todas las tarjetas de abogado

`generarBotonFavorito(idSeguro, esFavorito)` (`utils.js`, §32) ya existía y ya se usaba en `busqueda.html`/`perfil-abogado.html` — esta ronda solo la extendió a los lugares que faltaban, sin cambiar la función en sí:

- **`panel-cliente.html`, pestañas "Mis abogados" e "Inicio" (Últimos abogados):** ambas listas renderizan con la misma `generarCardAbogadoContactado()`, así que agregar el corazón ahí cubre las dos secciones a la vez. `favoritosIds` se arma una vez en `inicializar()` a partir de `misFavoritos` (ya se pedía para la pestaña "Favoritos", §32 — sin round-trip extra). El toggle acá es genérico (`manejarClickFavoritoGenerico`, in-place, corazón puede quedar lleno o vacío) — deliberadamente una función distinta de `manejarClickFavorito()` de la pestaña "Favoritos", donde togglear siempre significa "quitar y recargar la lista completa" (semántica distinta, no vale la pena unificarlas).
- **`solicitudes-directas.html` (vista cliente):** corazón junto al badge de estado, agrupados en `.solicitud-item__header-derecha` (clase nueva en `main.css`) para que no se separen con el `justify-content: space-between` del header de la tarjeta.
- **`solicitudes-tablon.html` (vista cliente):** esta vista es por *caso*, no por abogado (§28) — no hay una "tarjeta de abogado" per se salvo cuando el cliente ya eligió a alguien (existe una `solicitud` asociada al caso). `generarAbogadoElegidoCard()` es una función nueva que renderiza esa identidad (avatar, nombre, corazón) solo en ese caso, insertada entre el encabezado del caso y las acciones de la solicitud embebida.

Ningún lugar necesitó tocar `api.favoritos` — `getMisFavoritosIds()` (§32) ya cubría exactamente esta necesidad en cada archivo nuevo.

---

## 37. Menú de tres puntos en tarjetas (favorito + bloqueo)

### `frontend/js/bloqueos.js` se fusionó en `utils.js`
El pedido de esta ronda quería `utils.abrirModalBloqueo(nombre, usuarioId, onConfirmar)` (antes vivía como `confirmarBloqueo(usuarioId, nombre)` en `bloqueos.js`, §33). Como el nuevo menú de tres puntos es el principal call site nuevo de esa función, y `utils.js` ya no tiene ningún problema de dependencia circular con `api.js` (que no importa nada), se movió la implementación completa a `utils.js` y se borró `bloqueos.js`. Cambios de forma respecto a la versión anterior:
- Orden de argumentos invertido: `(nombre, usuarioId, onConfirmar?)` en vez de `(usuarioId, nombre)` — se actualizaron los tres call sites existentes (`perfil-abogado.js`, `panel-abogado.js`, `solicitudes-directas.js`).
- `onConfirmar` es opcional: si se pasa, se ejecuta tras un bloqueo exitoso (para que el call site actualice su propia UI — quitar una tarjeta, refrescar una lista). La función sigue retornando `Promise<boolean>`, así que los call sites que solo necesitan el resultado (como los tres ya existentes) pueden seguir usando `await abrirModalBloqueo(nombre, id)` sin tocar más nada.
- El mensaje pasó de un párrafo plano a `<p>` + `<ul>` (viñetas) vía `mensaje.innerHTML` — el nombre del usuario se escapa con un `escaparHtmlModal()` interno antes de interpolarse (es el único dato no confiable en ese HTML; el resto del markup es fijo).

### `generarMenuTarjeta(opciones)` y `inicializarMenuTarjeta()`
`opciones` es un array de `{ texto, href?, target?, accion?, id?, dataNombre? }` — con `href` genera un `<a>` (navegación simple, ej. "Ver perfil"), sin `href` genera un `<button data-accion data-id>` para que el listener delegado de cada página decida qué hacer, reutilizando exactamente los mismos valores de `data-accion` que ya usaban el corazón (`toggle-favorito`) y el bloqueo (`bloquear-abogado`/`bloquear-cliente`) — el menú no inventa una capa de eventos nueva, se conecta a los handlers que cada página ya tenía.

Como una tarjeta puede tener el corazón Y el ítem "Marcar/Quitar de favoritos" del menú apuntando al mismo `abogado_id`, y ambos deben reflejar el mismo estado, los handlers de `toggle-favorito` de cada página dejaron de parchear el botón clickeado directamente (`btn.querySelector('svg path')...`, que además rompía si el elemento clickeado era el ítem de texto del menú, sin `<svg>`) y ahora llaman a **`actualizarControlesFavorito(abogadoId, esFavorito)`** — busca en todo el documento cualquier control con ese `data-id` (puede haber 0, 1 o 2) y actualiza cada uno según corresponda (corazón: clase + `aria-pressed` + `fill` del SVG; ítem de menú: texto).

`inicializarMenuTarjeta()` engancha, con una guardia para llamarse una sola vez por página, la apertura/cierre de *cualquier* menú de tarjeta vía delegación de eventos en `document` — nunca por instancia, porque las tarjetas se re-renderizan seguido (nuevo favorito, nuevo seguimiento, nueva página de resultados) y enganchar un listener por `<button>` obligaría a re-enganchar en cada render. Un solo click en cualquier lugar de la página cierra todos los menús abiertos, salvo que el click haya sido sobre el botón "⋮" de uno de ellos (ahí alterna abrir/cerrar ese en particular). Cada página que use `generarMenuTarjeta()` debe llamar a `inicializarMenuTarjeta()` una vez desde su `configurarEventos()`.

### Dónde se agregó
Mismos seis lugares del corazón (§36), con las opciones que tiene sentido en cada uno:
- **`busqueda.html`, `panel-cliente.html` (Mis abogados + Inicio), `solicitudes-directas.html`/`solicitudes-tablon.html` (vista cliente, tarjeta de abogado):** Ver perfil / Marcar-Quitar de favoritos / Bloquear abogado.
- **`perfil-abogado.html`:** no es una tarjeta de lista — se dejó su menú de opciones ya existente (§33) con solo "Bloquear", sin duplicar "Ver perfil" (ya estamos ahí) ni "favorito" (ya hay un corazón dedicado en el encabezado). Se actualizó su handler de favorito para usar `actualizarControlesFavorito()`, por consistencia, aunque en esa página nunca coexisten dos controles para el mismo abogado.
- **Tarjetas de cliente vistas por el abogado** (`panel-abogado.js` pestaña "En seguimiento", `solicitudes-directas.js` vista abogado, `solicitudes-tablon.js` vista abogado — esta última no tenía ninguna opción de bloqueo antes): menú con la única opción "Bloquear cliente", reemplazando el link de texto suelto (`.btn-enlace-sutil`, ya retirado del CSS por quedar sin uso) que existía en `panel-abogado.js`/`solicitudes-directas.js` desde el §33 original.

`solicitudes-tablon.js` vista abogado necesitaba `cliente_id` en `panel_solicitudes_abogado`, que ya se había agregado en la migración `20260722_057` (§33) — no hizo falta ninguna migración nueva para este módulo.

### CSS: `.card-abogado__acciones-esquina` y `.solicitud-item__header-derecha`
`.card-abogado .btn-favorito` ya no se posiciona `absolute` por sí solo — ahora hay un wrapper `.card-abogado__acciones-esquina` (flex, position:absolute en la esquina superior derecha) que agrupa el corazón y el menú para que no se superpongan. `.perfil-header .btn-favorito` no cambió (ese layout de esquinas opuestas, corazón/menú, es específico de esa página y ya funcionaba). `.solicitud-item__header-derecha` (nueva en §36) ahora también agrupa el menú junto al badge y al corazón cuando los tres coexisten.

---

## 38. Página de configuración de cuenta ("Mis bloqueos")

### Migración `20260724_059_mis_bloqueos_vista.sql`
`api.bloqueos.getMisBloqueos()` (§33) solo consultaba la tabla `bloqueos` directamente (`SELECT *`) — retornaba `bloqueador_id`/`bloqueado_id`/`created_at`, sin nombre ni foto del usuario bloqueado, que la nueva sección "Usuarios bloqueados" sí necesita. Nueva vista `mis_bloqueos`, mismo patrón que `admin_bloqueos` (migración 056): join a `perfiles` con el filtro (`bloqueador_id = auth.uid()`) en el propio `WHERE` de la vista, porque las vistas de este proyecto son `SECURITY DEFINER` y no heredan el RLS de `bloqueos`. `api.bloqueos.getMisBloqueos()` pasa a consultar esta vista en vez de la tabla — ya no necesita resolver `auth.getUser()` a mano, la vista lo hace vía `auth.uid()`.

### `frontend/pages/configuracion-cuenta.html`
Accesible para cualquier rol autenticado desde "Configuración de cuenta" en el menú de avatar del header (`header.js`, nueva entrada al final de `generarItems()`, antes de "Cerrar sesión"). Dos secciones apiladas (sin tabs, dado que hoy solo hay una con contenido real):
- **"Usuarios bloqueados":** tarjetas con foto/iniciales, nombre y fecha de bloqueo (reutiliza las clases `.card-abogado` genéricas, no específicas de abogado), con botón "Desbloquear" → `api.bloqueos.desbloquear(usuarioId)` (ya existía, sin cambios) y el toast pedido ("Se ha desbloqueado a [nombre]. Ahora puede volver a ver su perfil y enviarle solicitudes.").
- **"Preferencias":** placeholder ("Próximamente"), sin lógica en `configuracion-cuenta.js` todavía — queda documentado para cuando se defina qué preferencias va a tener.

---

## 39. Fixes y mejoras de smoke test (2026-07-25)

Ronda de 7 módulos detectados durante smoke test, cada uno con su propio commit en `main`. Migraciones nuevas: `20260725_061_verificacion_pendiente_automatica.sql`, `062_notificacion_nueva_solicitud_url.sql`, `063_visibilidad_publica_abogado.sql`, `064_visualizaciones_tablon.sql` — todas aplicadas vía Supabase MCP.

### Módulo 1 — Mensaje y redirección post-registro abogado
`mostrarConfirmacion()` (`registro.js`) acepta ahora un cuarto parámetro opcional `{ redireccionAutomatica }`, usado solo en el flujo de abogado (cliente y estudio no cambian). Cuando es `true`, muestra el toast "Registro exitoso..." y arranca `iniciarRedireccionAutomatica()`: un contador visible de 5 segundos (`#contadorRedireccion`) que redirige a `/` al llegar a 0.

### Módulo 2 — Verificación pendiente automática
Diagnóstico confirmado en producción vía MCP: `fn_crear_fila_abogado` nunca insertaba en `verificaciones` — la única vía era `enviarDocumentosVerificacion()`, que solo corre si el `signUp` devuelve sesión de inmediato (nunca ocurre con confirmación de correo obligatoria). Resultado: ningún abogado nuevo generaba fila, así que `admin_verificaciones_pendientes` siempre estaba vacía.

Fix: `fn_crear_fila_abogado` gana un segundo bloque `BEGIN/EXCEPTION` (subtransacción independiente, mismo criterio que el bloque de referidos ya existente) que inserta una fila `PENDIENTE` vacía al crear el abogado. Para no duplicar esa fila si el signUp sí trae sesión activa, `enviarDocumentosVerificacion()` (`api.js`) ahora busca la fila `PENDIENTE` existente del abogado y la actualiza (`UPDATE`) en vez de insertar una nueva — requirió una política RLS nueva, `abogado_actualiza_verificacion_pendiente` (UPDATE, solo mientras `estado='PENDIENTE'`, congela `estado`/`revisado_por`/`revisado_at`/`motivo_rechazo`, mismo patrón "congelado" que `20260707_033_editar_solicitud.sql`). La migración incluye un backfill de los abogados existentes sin ninguna fila en `verificaciones`.

### Módulo 3 — Ocultar formulario de solicitud tras envío
`perfil-abogado.html`: nuevo botón "Hacer otra consulta a este abogado" en `.mensaje-confirmacion__botones` (junto a "Ver mi panel"/"Volver a la búsqueda"). Al enviar la solicitud, se ocultan tanto `#formSolicitud` como `#tituloSolicitud` (antes solo se ocultaba el formulario, el título "Solicitar consulta" quedaba visible sobre la confirmación). El botón nuevo llama a `reiniciarFormularioSolicitud()` (`form.reset()` + contador + error limpios) y vuelve a mostrar título y formulario.

### Módulo 4 — Redirección tras login desde perfil de abogado
`perfil-abogado.js` agrega un listener sobre cualquier `a[href="/"]` de la página (cubre tanto el "Iniciar sesión" del header como "Inicie sesión para contactar a este abogado" de `#seccionSinSesion`) que guarda `sessionStorage.setItem('redirect_after_login', window.location.href)` antes de navegar. `app.js`, en `manejarIngresar()`, revisa ese valor tras un login exitoso (después de validar que el rol coincide con el flujo elegido) y redirige ahí en vez de al panel por rol, limpiando la clave. Sin cambios en `index.html` — el mecanismo es genérico y no afecta el flujo normal de login (la clave nunca se setea si no se pasó primero por un enlace `href="/"` de una página anónima).

### Módulo 5 — Notificación de nueva solicitud lleva a la solicitud concreta
`fn_notificar_nueva_solicitud()` arma `url_destino` con el id de la solicitud en vez de apuntar siempre a `/pages/panel-abogado?tab=solicitudes`. Como esta misma función también se dispara para solicitudes creadas desde El Tablón (`fn_crear_solicitud_desde_tablon` hace su `INSERT` sobre la misma tabla `solicitudes`), la URL se resuelve según `NEW.caso_tablon_id`: `NULL` → `/pages/solicitudes-directas?solicitud=<id>`, no `NULL` → `/pages/solicitudes-tablon?solicitud=<id>` (esa página no resalta la tarjeta, pero al menos no manda a un listado que estructuralmente no la mostraría — `solicitudes-directas.html` filtra `.is('caso_tablon_id', null)`).

`solicitudes-directas.js` lee `?solicitud=` de la URL al cargar (`resaltarSolicitudDesdeUrl()`), hace scroll a la tarjeta (`#solicitud-<id>`, id nuevo en el `<article>`) y le agrega la clase `.solicitud-item--resaltada` (borde/fondo dorado) por 3 segundos.

### Módulo 6 — Visibilidad pública configurable con preview
Migración `063`: `abogados.visible_publico` (boolean, default `false`) y `abogados.campos_publicos` (jsonb, default con `foto`/`especialidades`/`provincia`/`rating` en `true` y `precio`/`zonas_servicio` en `false`). Ambas columnas son de edición libre por el propio abogado — `abogado_update_propio` no las congela, solo `verificacion`/`suscripcion_vigente_hasta`/`codigo_referido`.

**La restricción es exclusiva de visitantes sin sesión.** La vista `busqueda_abogados` (única superficie de lectura de `anon`, que no tiene ningún GRANT directo sobre la tabla `abogados`) gana en el `WHERE` la condición `(auth.uid() IS NOT NULL OR visible_publico = true)` — un cliente con sesión sigue viendo todos los abogados verificados con suscripción vigente, sin ningún cambio. Los campos foto/especialidades/provincia-cantón/precio/rating/zonas_servicio se enmascaran a `NULL` (o `0`/`'{}'` según tipo) solo cuando `auth.uid() IS NULL`, según cada flag de `campos_publicos` — nunca para sesiones autenticadas. `busqueda.js`/`perfil-abogado.js` no necesitaron ningún cambio: ya manejaban con gracia campos `null`/vacíos (avatar con iniciales, sin chips de especialidad, sin precio, "Sin reseñas", etc.).

`editar-perfil-abogado.html` agrega la sección "Visibilidad pública": toggle principal (`.toggle-switch`, reutilizado de `toggleDisponible`), seis checkboxes (`.radio-pills--multiple`, mismo componente que especialidades) y un preview en vivo a la derecha en desktop (`.visibilidad-publica__layout`, grid `1.2fr 1fr` desde 900px) que reutiliza el markup de `.card-abogado` de `busqueda.js`. El preview reacciona a cualquier campo que aparezca en la tarjeta (especialidades/precio/provincia/cantón de `formPerfil`, zonas de servicio, y los checkboxes de visibilidad) sin necesidad de guardar — lee directamente los inputs del DOM, no un estado separado. Guarda con `api.abogados.actualizarPerfilAbogado({ visible_publico, campos_publicos })` (mismo endpoint que el resto del perfil, ambos campos se agregaron a su lista blanca), en un formulario (`#formVisibilidad`) independiente del formulario principal.

### Módulo 7 — Contador de visualizaciones en El Tablón
Migración `064`: `casos_tablon.visualizaciones` (integer, default `0`), incrementada por la función `registrar_visualizacion_caso_tablon(p_caso_id)` (`SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`) — ni el cliente dueño ni un abogado tienen ningún permiso de `UPDATE` general sobre `casos_tablon` (solo `cliente_cierra_caso_tablon` para la transición a `CERRADO`), así que incrementar el contador necesita este mecanismo, mismo criterio que otras funciones `SECURITY DEFINER` de utilidad acotada (`fn_existe_bloqueo`, `validar_codigo_referido`). La columna se agregó al final de las tres vistas que la exponen (`tablon_casos_abogado`, `tablon_casos_cliente`, `tablon_caso_detalle`) — `solicitudes-tablon.html` (vista cliente) no necesitó ningún cambio de backend porque ya consume `tablon_casos_cliente` completa (§28).

`tablon-caso.js` llama a `api.tablon.registrarVisualizacion(casoId)` sin esperar la respuesta (fire-and-forget: es una métrica secundaria, no debe retrasar ni bloquear la carga de la página si falla) e incrementa `casoActual.visualizaciones` localmente en 1 para reflejarlo de inmediato en la cabecera, sin volver a consultar el detalle. `generarContadorVisualizaciones(total)` (ícono de ojo SVG inline + número, `utils.js`) se reutiliza en la tarjeta de `tablon.html` (ambas vistas, cliente y abogado), en la cabecera de `tablon-caso.html` y en la tarjeta de `solicitudes-tablon.html` (vista cliente).

---

*Actualizar este archivo con cada decisión técnica relevante*
