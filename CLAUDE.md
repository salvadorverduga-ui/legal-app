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
| Email | Resend — vía Supabase Edge Function `notificar-solicitud` (ver §13) |
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
│   └── config.js              ← Vercel Function: expone SUPABASE_URL/ANON_KEY sin commitearlas
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
│   │   ├── busqueda.js        ← lógica de busqueda.html
│   │   ├── perfil-abogado.js  ← lógica de perfil-abogado.html
│   │   ├── panel-abogado.js   ← lógica de panel-abogado.html
│   │   ├── panel-cliente.js   ← lógica de panel-cliente.html
│   │   ├── panel-admin.js     ← lógica de panel-admin.html
│   │   └── registro.js        ← lógica de registro.html
│   └── pages/
│       ├── busqueda.html
│       ├── perfil-abogado.html
│       ├── panel-cliente.html
│       ├── panel-abogado.html
│       ├── panel-admin.html
│       └── registro.html
├── supabase/
│   ├── config.toml            ← project_id para el Supabase CLI (link/deploy)
│   ├── migrations/            ← archivos SQL en orden cronológico
│   └── functions/
│       └── notificar-solicitud/
│           └── index.ts       ← Edge Function: emails de solicitud vía Resend (ver §13)
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

- [ ] MÓDULO 1 — General: favicon, página 404, toasts de feedback, mensajes de error amigables
- [ ] MÓDULO 2 — Cliente: confirmación post-solicitud, CTA después de rechazo/expiración, cancelar solicitud pendiente
- [ ] MÓDULO 3 — Abogado: preview del perfil público, alerta de vencimiento de suscripción, onboarding para abogado nuevo, formulario de perfil con progreso visual
- [ ] MÓDULO 4 — Admin: búsqueda/filtro en verificaciones, log de acciones del admin
- [ ] MÓDULO 5 — Notificaciones internas: sistema de notificaciones en la interfaz para cada tipo de usuario (nueva solicitud, solicitud aceptada/rechazada, verificación aprobada/rechazada, suscripción próxima a vencer)

Marcar cada ítem como `[x]` a medida que se completa el módulo correspondiente.

---

*Actualizar este archivo con cada decisión técnica relevante*
