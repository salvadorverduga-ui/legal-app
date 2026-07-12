// utils.js
// Helpers globales reutilizables en toda la app (ver CLAUDE.md §7).
//
// toast: notificaciones de feedback visual no bloqueantes.
// Uso desde cualquier página:
//   import { toast } from './utils.js';
//   toast.exito('Perfil guardado.');
//   toast.error('No se pudo guardar. Intente de nuevo.');
//   toast.info('Disponibilidad actualizada.');

const DURACION_MS = 4000;

let contenedorToasts = null;

function obtenerContenedorToasts() {
  if (contenedorToasts) return contenedorToasts;

  contenedorToasts = document.createElement('div');
  contenedorToasts.className = 'toast-contenedor';
  contenedorToasts.setAttribute('aria-live', 'polite');
  contenedorToasts.setAttribute('aria-atomic', 'true');
  document.body.appendChild(contenedorToasts);

  return contenedorToasts;
}

// opciones.html === true: el mensaje incluye markup de confianza (ej. un
// enlace interno armado por el propio código, nunca texto de usuario) y se
// inserta con innerHTML en lugar de textContent.
function mostrarToast(mensaje, tipo, opciones = {}) {
  const contenedor = obtenerContenedorToasts();

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast--${tipo}`;
  toastEl.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  if (opciones.html) {
    toastEl.innerHTML = mensaje;
  } else {
    toastEl.textContent = mensaje;
  }
  toastEl.addEventListener('click', () => cerrarToast(toastEl));

  contenedor.appendChild(toastEl);

  // Forzar reflow antes de agregar la clase visible para que la transición de entrada se aplique.
  requestAnimationFrame(() => toastEl.classList.add('toast--visible'));

  setTimeout(() => cerrarToast(toastEl), DURACION_MS);
}

function cerrarToast(toastEl) {
  if (!toastEl.isConnected) return;
  toastEl.classList.remove('toast--visible');
  toastEl.addEventListener('transitionend', () => toastEl.remove(), { once: true });
}

export const toast = {
  exito: (mensaje, opciones) => mostrarToast(mensaje, 'exito', opciones),
  error: (mensaje, opciones) => mostrarToast(mensaje, 'error', opciones),
  info:  (mensaje, opciones) => mostrarToast(mensaje, 'info', opciones),
};

// ─── Mensajes de error amigables ───────────────────────────────────────────────
// api.js retorna en la mayoría de los casos el error crudo de Supabase/Postgres
// (en inglés, con detalles internos de la base de datos). Mostrar error.message
// directamente en la UI expondría esos detalles técnicos al usuario. Esta lista
// blanca son los pocos mensajes que api.js ya construye a mano en español y que
// sí son seguros de mostrar tal cual; cualquier otro error cae al mensaje por
// defecto que indique cada pantalla.
const MENSAJES_ERROR_CONOCIDOS = new Set([
  'El archivo debe ser JPG, PNG o WEBP.',
  'El archivo no debe superar los 10MB.',
  'No hay sesión activa.',
  'Ya dejó una reseña para esta solicitud.',
  'No se encontró la solicitud.',
]);

export function mensajeAmigable(error, mensajePorDefecto) {
  if (error?.message && MENSAJES_ERROR_CONOCIDOS.has(error.message)) {
    return error.message;
  }
  return mensajePorDefecto;
}

// ─── Ruta del panel propio según rol ────────────────────────────────────────
// El logo "LegalEC" del header debe llevar siempre al panel del usuario
// autenticado, o a la landing si no hay sesión. Misma tabla de rutas que
// app.js usa para redirigir después del login.
const RUTAS_PANEL_POR_ROL = {
  cliente: '/pages/panel-cliente',
  abogado: '/pages/panel-abogado',
  estudio: '/pages/panel-estudio',
  admin:   '/pages/panel-admin',
};

export function rutaPanelPropio(rol) {
  return RUTAS_PANEL_POR_ROL[rol] ?? '/';
}
