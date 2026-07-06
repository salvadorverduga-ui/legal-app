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
| Email | Resend o SendGrid (a definir) |
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
│   │   └── utils.js           ← helpers globales
│   └── pages/
│       ├── busqueda.html
│       ├── perfil-abogado.html
│       ├── solicitud.html
│       ├── panel-abogado.html
│       ├── panel-estudio.html
│       ├── panel-admin.html
│       └── registro.html
├── supabase/
│   └── migrations/            ← archivos SQL en orden cronológico
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
RESEND_API_KEY=                # o SendGrid
PAYPHONE_API_KEY=
```

Nunca commitear `.env` — está en `.gitignore`.

---

## 11. Pendientes técnicos por definir

- [ ] Nombre del proyecto y dominio definitivo
- [ ] Proveedor de notificaciones push (Web Push API nativo vs OneSignal)
- [ ] Proveedor de email transaccional (Resend vs SendGrid)
- [ ] Estrategia de cron para expiración de solicitudes (Supabase cron vs cron-job.org)
- [ ] Flujo de pago PayPhone — integración específica
- [ ] Estructura definitiva de tablas (diseñar antes de primera migración)

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

*Actualizar este archivo con cada decisión técnica relevante*
