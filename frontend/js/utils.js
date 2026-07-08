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

function mostrarToast(mensaje, tipo) {
  const contenedor = obtenerContenedorToasts();

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast--${tipo}`;
  toastEl.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  toastEl.textContent = mensaje;
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
  exito: (mensaje) => mostrarToast(mensaje, 'exito'),
  error: (mensaje) => mostrarToast(mensaje, 'error'),
  info:  (mensaje) => mostrarToast(mensaje, 'info'),
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
