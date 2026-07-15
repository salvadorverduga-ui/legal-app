// utils.js
// Helpers globales reutilizables en toda la app (ver CLAUDE.md §7).
//
// toast: notificaciones de feedback visual no bloqueantes.
// Uso desde cualquier página:
//   import { toast } from './utils.js';
//   toast.exito('Perfil guardado.');
//   toast.error('No se pudo guardar. Intente de nuevo.');
//   toast.info('Disponibilidad actualizada.');

// Mensaje del toast al marcar una solicitud o aplicación como "en
// seguimiento" — mismo texto en los botones de seguimiento de paneles,
// solicitudes-directas/tablon.js y tablon-caso.js/tablon.js.
export const MENSAJE_AGREGADO_SEGUIMIENTO =
  'Agregado a seguimiento. En esta sección puede hacer un seguimiento rápido de sus solicitudes y casos más importantes.';

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

// ─── Modal de confirmación propio ────────────────────────────────────────────
// Reemplaza a window.confirm() — CLAUDE.md §7 prohíbe los diálogos del
// sistema (window.confirm/alert/prompt) en toda la app.
// Uso desde cualquier página:
//   import { confirmar } from './utils.js';
//   const ok = await confirmar('¿Cancelar esta solicitud? Esta acción no se puede deshacer.');
//   if (!ok) return;

let elementosModalConfirmar = null;

function obtenerModalConfirmar() {
  if (elementosModalConfirmar) return elementosModalConfirmar;

  const overlay = document.createElement('div');
  overlay.className = 'modal-confirmar-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-confirmar" role="alertdialog" aria-modal="true" aria-labelledby="modalConfirmarMensaje">
      <p class="modal-confirmar__mensaje" id="modalConfirmarMensaje"></p>
      <div class="modal-confirmar__acciones">
        <button type="button" class="btn btn--secundario btn--sm" id="modalConfirmarBtnCancelar"></button>
        <button type="button" class="btn btn--primario btn--sm" id="modalConfirmarBtnConfirmar"></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  elementosModalConfirmar = {
    overlay,
    mensaje: overlay.querySelector('#modalConfirmarMensaje'),
    btnCancelar: overlay.querySelector('#modalConfirmarBtnCancelar'),
    btnConfirmar: overlay.querySelector('#modalConfirmarBtnConfirmar'),
  };
  return elementosModalConfirmar;
}

/**
 * Muestra un modal de confirmación propio y retorna una Promise que resuelve
 * true (confirmó) o false (canceló, cerró con Escape o hizo clic fuera).
 * opciones: { textoConfirmar?: string, textoCancelar?: string }
 */
export function confirmar(mensaje, opciones = {}) {
  const { textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar' } = opciones;
  const { overlay, mensaje: mensajeEl, btnCancelar, btnConfirmar } = obtenerModalConfirmar();

  mensajeEl.textContent = mensaje;
  btnCancelar.textContent = textoCancelar;
  btnConfirmar.textContent = textoConfirmar;

  const elementoConFocoPrevio = document.activeElement;

  return new Promise((resolve) => {
    function cerrar(resultado) {
      overlay.hidden = true;
      btnCancelar.removeEventListener('click', manejarCancelar);
      btnConfirmar.removeEventListener('click', manejarConfirmar);
      overlay.removeEventListener('click', manejarClickOverlay);
      document.removeEventListener('keydown', manejarTecla);
      if (elementoConFocoPrevio instanceof HTMLElement) elementoConFocoPrevio.focus();
      resolve(resultado);
    }

    function manejarCancelar() { cerrar(false); }
    function manejarConfirmar() { cerrar(true); }
    function manejarClickOverlay(e) {
      if (e.target === overlay) cerrar(false);
    }
    function manejarTecla(e) {
      if (e.key === 'Escape') cerrar(false);
    }

    btnCancelar.addEventListener('click', manejarCancelar);
    btnConfirmar.addEventListener('click', manejarConfirmar);
    overlay.addEventListener('click', manejarClickOverlay);
    document.addEventListener('keydown', manejarTecla);

    overlay.hidden = false;
    btnConfirmar.focus();
  });
}
