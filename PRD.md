# PRD — Plataforma Legal Ecuador
**Versión:** 0.3 | **Última actualización:** Julio 2026
**Estado:** Documento vivo — actualizar con cada decisión de diseño o arquitectura

---

## 1. Visión General

Plataforma digital que conecta abogados con clientes en Ecuador mediante un modelo de solicitud mediada. Los abogados pagan una suscripción mensual; los clientes acceden gratis.

**Hipótesis central:**
> Los abogados ecuatorianos pagarán una suscripción mensual por acceder a clientes verificados y calificados a través de una plataforma confiable.

**Mercado:** Ecuador únicamente (v1)
**Publicación:** Web (dominio propio) + Google Play Store (Capacitor, V2)
**Arquitectura:** Una sola app, un solo repositorio, roles diferenciados por tipo de usuario

---

## 2. Actores del Sistema

### 2.1 Cliente (gratuito)
- Registro simple: nombre completo, correo y contraseña — **sin cédula** (persona natural en MVP)
- Acceso completo a búsqueda y solicitudes sin costo
- Puede dejar reseñas solo después de una solicitud COMPLETADA
- Perfil empresa/negocio: V2

### 2.2 Abogado independiente
- Suscripción mensual: **$11,99/mes**
- Registro con cédula (identificador único de persona natural) + número de carnet de abogado
- Perfil con foto, especialidades, ciudad, descripción, precio de consulta
- Requiere verificación de carnet antes de ser visible
- Toggle: Disponible / No disponible
- Puede crear o unirse a una red de colaboradores

### 2.3 Estudio jurídico

| Plan | Abogados incluidos | Precio/mes |
|---|---|---|
| Estudio Pequeño | Hasta 3 | $29,99 |
| Estudio Mediano | Hasta 8 | $59,99 |
| Estudio Grande | Ilimitados | $99,99 |

- Registro con RUC (identificador único de la entidad) — el representante legal no da cédula en este formulario
- Perfil propio (logo, nombre, descripción, especialidades)
- Verificación como entidad + verificación individual de cada miembro
- Solo visible cuando el estudio está verificado Y tiene al menos un miembro verificado

### 2.4 Red de colaboradores
- Asociación informal entre abogados independientes
- Sin costo extra — cada miembro paga su $11,99 individual
- Badge visual en cada perfil: "Colabora con X, Y, Z"
- La red desaparece si algún miembro no renueva

### 2.5 Administrador
- Panel para aprobar/rechazar verificaciones
- Vista de suscripciones activas y vencidas
- Moderación de reseñas
- Métricas: solicitudes enviadas, aceptadas, rechazadas, tasa de conversión

---

## 3. Flujo de Contacto (Solicitud Mediada)

Ninguna de las partes ve los datos de contacto de la otra hasta que existe un match explícito.

### 3.1 Flujo paso a paso
1. Cliente busca por especialidad, caso frecuente o zona geográfica
2. Ve listado mixto con badge visual diferenciador
3. Entra al perfil y toca "Solicitar consulta"
4. Completa: descripción breve (opcional) + disponibilidad horaria
5. Abogado recibe notificación push + email
6. Abogado **acepta** → se revelan datos de contacto del cliente
7. Abogado **rechaza** → cliente recibe "no disponible en este momento"
8. Consulta ocurre offline (WhatsApp, llamada, presencial)
9. X días después, la app pide reseña al cliente

### 3.2 Estados de una solicitud
```
PENDIENTE → ACEPTADA → COMPLETADA → RESEÑADA
              ↓
           RECHAZADA
              ↓
         EXPIRADA (sin respuesta en 48h)
```

### 3.3 Visibilidad de datos por etapa

| Momento | Cliente ve del abogado | Abogado ve del cliente |
|---|---|---|
| Antes de solicitar | Nombre, foto, especialidad, ciudad, rating | Nada |
| Solicitud enviada | Confirmación de envío | Nombre, descripción, disponibilidad |
| Abogado acepta | Confirmación | Teléfono y/o email |
| Abogado rechaza | "No disponible" | — |

---

## 4. Búsqueda y Resultados

### 4.1 Ejes de búsqueda
- Por especialidad jurídica (Derecho de familia, Laboral, Mercantil, etc.)
- Por caso frecuente (Divorcio, Herencia, Pensión alimenticia, Despido, etc.)
- Por zona geográfica / provincia

Los tres ejes son combinables como filtros. **El sistema de tags debe diseñarse bien desde el inicio — refactorizarlo es costoso.**

### 4.2 Presentación (Opción C — listado mixto)
- Abogados, estudios y redes en listado unificado
- Badge visual por tipo: individual / 🏢 Estudio / 👥 Red
- Orden: rating + reseñas + disponibilidad activa
- Filtros opcionales: Solo abogados / Solo estudios / Ciudad / Especialidad

---

## 5. Verificación de Identidad Profesional

### 5.1 Abogado individual
- Sube carnet de abogado + cédula al registrarse
- Estado PENDIENTE: no visible, no recibe solicitudes
- Revisión manual por administrador (MVP)
- Tiempo estimado visible: **24–48 horas hábiles**
- Al aprobar: badge VERIFICADO ✓
- Al rechazar: notificación con motivo + posibilidad de volver a subir

### 5.2 Estudio jurídico
- Sube: RUC + nombramiento representante legal + carnet del representante
- Cada miembro pasa verificación individual
- Visible solo cuando estudio verificado + al menos un miembro verificado

### 5.3 Estados de verificación

| Estado | Visible | Recibe solicitudes |
|---|---|---|
| PENDIENTE | No | No |
| VERIFICADO | Sí (si toggle = Disponible) | Sí |
| RECHAZADO | No | No |
| SUSPENDIDO | No | No |

---

## 6. Modelo de Suscripción

### 6.1 Planes

| Plan | Precio/mes | Notas |
|---|---|---|
| Abogado Individual | $11,99 | Acceso completo, solicitudes ilimitadas |
| Estudio Pequeño | $29,99 | Hasta 3 abogados |
| Estudio Mediano | $59,99 | Hasta 8 abogados |
| Estudio Grande | $99,99 | Ilimitados |
| Red de Colaboradores | Sin costo extra | Cada uno paga su individual |
| Cliente | Gratis | Siempre |

### 6.2 Vencimiento de suscripción
- **Período de gracia: 4 días** desde la fecha de vencimiento
- Al día 5: perfil oculto de búsquedas inmediatamente, no recibe solicitudes
- Las reseñas se **conservan** — solo se ocultan mientras el perfil está inactivo
- Al renovar: perfil vuelve a ser visible automáticamente con todas sus reseñas

### 6.3 Visibilidad server-side (RLS — forma fuerte)
Un perfil de abogado se devuelve desde la base de datos **únicamente** si cumple todas estas condiciones simultáneamente:

```sql
verificacion = 'VERIFICADO'
AND toggle_disponible = true
AND (
  suscripcion_vigente_hasta >= CURRENT_DATE
  OR suscripcion_vigente_hasta >= CURRENT_DATE - INTERVAL '4 days'  -- período de gracia
)
```

**Esto se implementa como política RLS en Supabase, no como filtro en el frontend.** Ningún perfil inactivo sale de la base de datos independientemente de cómo se haga la consulta.

### 6.4 Fase de lanzamiento — Beta gratuita
Los primeros abogados entran gratis. El cobro se activa con aviso previo de 15 días. La gratuidad se comunica como privilegio de los primeros en entrar.

Durante la fase Beta, el administrador activa manualmente la suscripción desde Supabase ejecutando: `UPDATE abogados SET suscripcion_vigente_hasta = CURRENT_DATE + INTERVAL '30 days' WHERE id = '[id]'`. La automatización vía PayPhone se implementa en V2.

### 6.5 Métodos de pago
- MVP: transferencia bancaria manual o PayPhone
- V2: Stripe

---

## 7. Sistema de Reseñas
- Solo puede reseñar quien tuvo una solicitud en estado COMPLETADA
- Calificación: 1–5 estrellas + comentario opcional
- El abogado puede responder públicamente
- Administrador puede moderar y eliminar
- Mecanismo de impugnación: el abogado reporta para revisión
- Las reseñas se conservan aunque el perfil esté inactivo por vencimiento

---

## 8. Gestión de Disponibilidad
- Toggle: Disponible / No disponible en el panel del abogado
- No disponible: no aparece en búsquedas, no recibe solicitudes
- Sin topes de solicitudes — el abogado gestiona su carga con el toggle
- Solicitudes expiradas sistemáticas: notificación automática (umbral a definir en V2)

---

## 9. Stack Técnico

| Capa | Tecnología | Notas |
|---|---|---|
| Base de datos + Auth | Supabase | RLS activado en todas las tablas |
| Backend / API | Supabase Edge Functions | Lógica de negocio serverless |
| Frontend | Vanilla HTML/CSS/JS | Sin frameworks, sin build steps |
| Hosting | Vercel | Auto-deploy desde rama main |
| Notificaciones push | Web Push API / OneSignal | A definir |
| Email transaccional | Resend o SendGrid | Confirmaciones, notificaciones |
| Pagos MVP | PayPhone o transferencia manual | Stripe en V2 |
| Mobile (V2) | Capacitor | Wrapper nativo sobre web app |
| Almacenamiento docs | Supabase Storage | Carnets, logos, fotos de perfil |

### 9.1 Repositorio e infraestructura
- Repositorio: GitHub (rama `main` para producción, `feature/*` para desarrollo)
- Web: Vercel — auto-deploy en push a `main`
- Base de datos: Supabase (proyecto a crear)

---

## 10. Seguridad (no negociable)

Estas tres reglas se aplican desde el día 1 y Claude Code debe respetarlas en cada decisión:

### 10.1 Row Level Security (RLS)
- Activado en **todas** las tablas sin excepción
- Ningún dato se expone sin una política explícita que lo autorice
- La visibilidad de perfiles se controla a nivel de base de datos, no de frontend

### 10.2 CORS restringido
- Supabase solo acepta solicitudes provenientes del dominio de la app
- Ningún origen externo no autorizado puede consultar la API

### 10.3 Security Headers (vía vercel.json)
- `Content-Security-Policy` — solo recursos de dominios autorizados
- `X-Frame-Options: DENY` — bloquea clickjacking
- `X-Content-Type-Options: nosniff` — el navegador no adivina tipos de archivo
- `Strict-Transport-Security` — fuerza HTTPS siempre

---

## 11. Consideraciones Legales (Ecuador)

**Posicionamiento:** la plataforma es un servicio de conexión, NO un prestador de servicios jurídicos. Este disclaimer va en T&C, en la app, y en toda comunicación pública.

### Puntos críticos
- **LOPDP:** política de privacidad obligatoria desde día 1, base legal para tratamiento de datos, datos de verificación profesional bajo resguardo especial
- **RUA (Registro Único de Abogados):** no existe API pública — verificación manual en MVP
- **Reseñas:** T&C con safe harbor para contenido de terceros, mecanismo de impugnación
- **Mala praxis:** la plataforma NO es canal de denuncias — redirigir al Tribunal Disciplinario del Foro de Abogados. Incluir explícitamente en T&C

---

## 12. Alcance MVP vs. V2

### MVP
- [ ] Registro de clientes (persona natural)
- [ ] Registro de abogados individuales con verificación
- [ ] Registro de estudios jurídicos con verificación
- [ ] Registro de redes de colaboradores
- [ ] Búsqueda por especialidad, caso frecuente y zona
- [ ] Resultados mixtos con badge visual
- [ ] Perfil completo de abogado / estudio
- [ ] Flujo de solicitud mediada con estados y notificaciones
- [ ] Sistema de reseñas verificadas
- [ ] Toggle disponible / no disponible
- [ ] Período de gracia de 4 días al vencer suscripción
- [ ] Panel de administración (verificaciones + suscripciones + moderación)
- [ ] Suscripciones con pago manual o PayPhone
- [ ] RLS en todas las tablas
- [ ] CORS restringido
- [ ] Security Headers
- [ ] Web-first responsive

### V2
- [ ] App nativa iOS / Android (Capacitor)
- [ ] Registro de clientes como empresa/negocio
- [ ] Chat interno
- [ ] Agenda / citas dentro de la app
- [ ] Tier premium / lujo
- [ ] Stripe
- [ ] Filtros avanzados
- [ ] Tasa de respuesta como métrica pública
- [ ] Pagos de consultas dentro de la app
- [ ] Subdominios separados por rol (app. / abogados.)

---

## 13. Métricas Clave del MVP

| Métrica | Meta inicial |
|---|---|
| Abogados verificados activos | 50 en 3 meses de beta |
| Solicitudes enviadas / mes | Crecer mes a mes |
| Tasa de aceptación | > 60% |
| Tasa de conversión a reseña | > 30% |
| Tasa de expiración de solicitudes | < 15% |
| Abogados que convierten a pago post-beta | > 30% de beta |

---

## 14. Preguntas Abiertas

| # | Pregunta | Prioridad |
|---|---|---|
| 1 | ¿Nombre de la app y dominio? | Alta |
| 2 | ¿El nombre del cliente en reseñas aparece completo o como iniciales? | Media |
| 3 | ¿Un abogado puede pertenecer a un estudio Y a una red simultáneamente? | Media |
| 4 | ¿Cuántos días esperar para pedir reseña post-solicitud aceptada? | Media |
| 5 | ¿Cuál es el umbral de solicitudes expiradas para suspender automáticamente? | Baja (V2) |
| 6 | ¿El precio de consulta inicial en el perfil es obligatorio u opcional? | Media |
| 7 | ¿Cómo se gestiona el representante legal de un estudio si cambia? | Media |

---

*Documento vivo — actualizar con cada decisión de diseño o arquitectura*
