// utils.js
// Helpers globales reutilizables en toda la app (ver CLAUDE.md §7).
//
// toast: notificaciones de feedback visual no bloqueantes.
// Uso desde cualquier página:
//   import { toast } from './utils.js';
//   toast.exito('Perfil guardado.');
//   toast.error('No se pudo guardar. Intente de nuevo.');
//   toast.info('Disponibilidad actualizada.');

import * as api from './api.js';

// Mensaje del toast al marcar una solicitud o aplicación como "en
// seguimiento" — mismo texto en los botones de seguimiento de paneles,
// solicitudes-directas/tablon.js y tablon-caso.js/tablon.js.
export const MENSAJE_AGREGADO_SEGUIMIENTO =
  'Agregado a seguimiento. En esta sección puede hacer un seguimiento rápido de sus solicitudes y casos más importantes.';

// ─── Checkbox de seguimiento (esquina inferior derecha de la tarjeta) ──────────
// Reemplaza al botón "Seguimiento"/"En seguimiento" en todas las tarjetas de
// solicitudes y de casos de El Tablón. idSeguro debe venir ya escapado por el
// call site (mismo criterio que el resto de cada template string); el listener
// de "change" en cada página llama a data-accion="toggle-seguimiento".
export function generarCheckboxSeguimiento(idSeguro, marcado) {
  return `
    <div class="seguimiento-check">
      <label class="seguimiento-check__etiqueta">
        <input type="checkbox" class="seguimiento-check__input" data-accion="toggle-seguimiento"
          data-id="${idSeguro}" ${marcado ? 'checked' : ''}>
        <span>Marcar para seguimiento</span>
      </label>
      <p class="seguimiento-check__ayuda">
        Las solicitudes y casos marcados aparecen en su sección "En seguimiento" para acceso rápido.
      </p>
    </div>
  `;
}

// ─── Botón de favorito (corazón) ───────────────────────────────────────────
// Reutilizado en las tarjetas de busqueda.html y en el encabezado de
// perfil-abogado.html — solo se renderiza para clientes con sesión activa
// (el call site decide eso, esta función no verifica rol). idSeguro debe
// venir ya escapado por el call site. El listener de "click" en cada página
// llama a data-accion="toggle-favorito".
export function generarBotonFavorito(idSeguro, esFavorito) {
  return `
    <button class="btn-favorito${esFavorito ? ' btn-favorito--activo' : ''}" type="button"
      data-accion="toggle-favorito" data-id="${idSeguro}"
      aria-pressed="${esFavorito}" aria-label="${esFavorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-10-9.3C.5 8.4 2 4.5 5.7 4c2-.3 3.7.6 4.9 2.2C11.8 4.6 13.5 3.7 15.5 4c3.7.5 5.2 4.4 3.7 7.7-2.5 4.7-10 9.3-10 9.3z"
          fill="${esFavorito ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    </button>
  `;
}

// ─── Sincronizar corazón + ítem de menú de un mismo abogado ────────────────
// generarBotonFavorito() (el corazón) y el ítem "Marcar/Quitar de
// favoritos" del menú de tres puntos (generarMenuTarjeta()) representan el
// mismo estado para el mismo abogado, y pueden coexistir en la misma
// tarjeta. En vez de sincronizarlos a mano en cada call site, esta función
// busca en todo el documento cualquier control de favorito para ese
// abogado_id (puede haber 0, 1 o 2) y actualiza cada uno según su tipo.
export function actualizarControlesFavorito(abogadoId, esFavorito) {
  document
    .querySelectorAll(`[data-accion="toggle-favorito"][data-id="${abogadoId}"]`)
    .forEach(el => {
      const svgPath = el.querySelector('svg path');
      if (svgPath) {
        // Es el corazón (generarBotonFavorito).
        el.classList.toggle('btn-favorito--activo', esFavorito);
        el.setAttribute('aria-pressed', String(esFavorito));
        el.setAttribute('aria-label', esFavorito ? 'Quitar de favoritos' : 'Agregar a favoritos');
        svgPath.setAttribute('fill', esFavorito ? 'currentColor' : 'none');
      } else {
        // Es el ítem de texto del menú de tres puntos.
        el.textContent = esFavorito ? 'Quitar de favoritos' : 'Marcar como favorito';
      }
    });
}

// ─── Menú de tres puntos (⋮) en tarjetas ────────────────────────────────────
// Reutilizado en cualquier tarjeta de abogado o de cliente que necesite un
// menú de opciones (Ver perfil, favorito, bloquear...). Cada opción es
// { texto, href?, target?, accion?, id? } — con href genera un <a> (para
// navegación simple, ej. "Ver perfil"); sin href genera un <button> con
// data-accion/data-id para que el listener delegado de cada página decida
// qué hacer (mismo patrón que el resto de las tarjetas: toggle-favorito,
// toggle-seguimiento, bloquear-abogado, etc.).
export function generarMenuTarjeta(opciones) {
  const itemsHtml = opciones.map(o => {
    if (o.href) {
      const targetAttrs = o.target ? ` target="${o.target}" rel="noopener noreferrer"` : '';
      return `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="${o.href}"${targetAttrs}>${o.texto}</a></li>`;
    }
    return `
      <li role="none">
        <button role="menuitem" class="menu-desplegable__item" type="button"
          data-accion="${o.accion}" data-id="${o.id ?? ''}"${o.dataNombre ? ` data-nombre="${o.dataNombre}"` : ''}>
          ${o.texto}
        </button>
      </li>
    `;
  }).join('');

  return `
    <div class="menu-desplegable menu-tarjeta">
      <button class="btn-icono-sutil menu-tarjeta__boton" type="button"
        aria-haspopup="true" aria-expanded="false" aria-label="Más opciones">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
        </svg>
      </button>
      <ul class="menu-desplegable__lista" role="menu" hidden>
        ${itemsHtml}
      </ul>
    </div>
  `;
}

// Engancha, una sola vez por página (guardia interna), la apertura/cierre de
// CUALQUIER menú de tarjeta vía delegación de eventos en document — las
// tarjetas se re-renderizan seguido (nuevo favorito, nuevo seguimiento...),
// así que no tiene sentido enganchar un listener por instancia. Llamar una
// vez desde configurarEventos() de cada página que use generarMenuTarjeta().
let menuTarjetaInicializado = false;

export function inicializarMenuTarjeta() {
  if (menuTarjetaInicializado) return;
  menuTarjetaInicializado = true;

  document.addEventListener('click', (e) => {
    const boton = e.target.closest('.menu-tarjeta__boton');
    if (boton) {
      const lista = boton.nextElementSibling;
      const yaAbierto = !lista.hidden;
      cerrarMenusTarjeta();
      if (!yaAbierto) {
        lista.hidden = false;
        boton.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    // Cualquier otro click (afuera de un menú, o sobre uno de sus ítems)
    // cierra los menús abiertos. Los listeners delegados de cada página
    // (sobre contenedores más específicos, más abajo en el árbol) ya
    // procesaron el data-accion del ítem antes de que este listener en
    // document se ejecute — el evento burbujea de adentro hacia afuera.
    cerrarMenusTarjeta();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarMenusTarjeta();
  });
}

function cerrarMenusTarjeta() {
  document.querySelectorAll('.menu-tarjeta__boton[aria-expanded="true"]').forEach(boton => {
    boton.setAttribute('aria-expanded', 'false');
    if (boton.nextElementSibling) boton.nextElementSibling.hidden = true;
  });
}

// ─── Modal de confirmación de bloqueo (countdown 9s) ────────────────────────
// Reemplaza a frontend/js/bloqueos.js (fusionado acá para que conviva con
// generarMenuTarjeta(), su principal call site desde esta ronda de cambios).
const SEGUNDOS_ESPERA_BLOQUEO = 9;

let elementosModalBloqueo = null;

function obtenerModalBloqueo() {
  if (elementosModalBloqueo) return elementosModalBloqueo;

  const overlay = document.createElement('div');
  overlay.className = 'modal-confirmar-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-confirmar" role="alertdialog" aria-modal="true" aria-labelledby="modalBloqueoMensaje">
      <div class="modal-confirmar__mensaje" id="modalBloqueoMensaje"></div>
      <div class="modal-confirmar__acciones">
        <button type="button" class="btn btn--secundario btn--sm" id="modalBloqueoCancelar">Cancelar</button>
        <button type="button" class="btn btn--primario btn--sm" id="modalBloqueoConfirmar" disabled></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  elementosModalBloqueo = {
    overlay,
    mensaje: overlay.querySelector('#modalBloqueoMensaje'),
    btnCancelar: overlay.querySelector('#modalBloqueoCancelar'),
    btnConfirmar: overlay.querySelector('#modalBloqueoConfirmar'),
  };
  return elementosModalBloqueo;
}

/**
 * Abre el modal de confirmación de bloqueo para `nombre`. El botón
 * "Confirmar bloqueo" queda deshabilitado con un contador de 9 segundos
 * ("Confirmar (9)", "Confirmar (8)"... hasta "Confirmar bloqueo" habilitado).
 * Si se confirma, llama a api.bloqueos.bloquear(usuarioId), muestra un toast
 * con el resultado y, si tuvo éxito, ejecuta onConfirmar() (opcional) para
 * que el call site actualice su propia UI (quitar la tarjeta, refrescar una
 * lista, redirigir, etc.).
 * Retorna Promise<boolean> — true si el bloqueo se confirmó y se guardó.
 */
export function abrirModalBloqueo(nombre, usuarioId, onConfirmar) {
  const { overlay, mensaje, btnCancelar, btnConfirmar } = obtenerModalBloqueo();

  mensaje.innerHTML = `
    <p>¿Está seguro de que desea bloquear a ${escaparHtmlModal(nombre)}? Al hacerlo:</p>
    <ul class="modal-confirmar__lista">
      <li>No podrá ver su perfil</li>
      <li>No podrá enviarle solicitudes</li>
      <li>No aparecerá en sus búsquedas</li>
      <li>Todas las solicitudes activas entre ustedes serán canceladas automáticamente</li>
    </ul>
  `;

  let segundosRestantes = SEGUNDOS_ESPERA_BLOQUEO;
  btnConfirmar.disabled = true;
  btnConfirmar.textContent = `Confirmar (${segundosRestantes})`;

  const intervalo = setInterval(() => {
    segundosRestantes -= 1;
    if (segundosRestantes <= 0) {
      clearInterval(intervalo);
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar bloqueo';
    } else {
      btnConfirmar.textContent = `Confirmar (${segundosRestantes})`;
    }
  }, 1000);

  const elementoConFocoPrevio = document.activeElement;

  return new Promise((resolve) => {
    function cerrar() {
      clearInterval(intervalo);
      overlay.hidden = true;
      btnCancelar.removeEventListener('click', manejarCancelar);
      btnConfirmar.removeEventListener('click', manejarConfirmar);
      overlay.removeEventListener('click', manejarClickOverlay);
      document.removeEventListener('keydown', manejarTecla);
      if (elementoConFocoPrevio instanceof HTMLElement) elementoConFocoPrevio.focus();
    }

    async function manejarConfirmar() {
      if (btnConfirmar.disabled) return;
      btnConfirmar.disabled = true;

      const { error } = await api.bloqueos.bloquear(usuarioId);
      cerrar();

      if (error) {
        toast.error(mensajeAmigable(error, 'No se pudo bloquear a este usuario. Intente de nuevo.'));
        resolve(false);
        return;
      }

      toast.exito(
        `Bloqueó a ${nombre}. Ya no podrán verse ni contactarse, y sus solicitudes activas fueron canceladas.`
      );
      onConfirmar?.();
      resolve(true);
    }

    function manejarCancelar() {
      cerrar();
      resolve(false);
    }

    function manejarClickOverlay(e) {
      if (e.target === overlay) {
        cerrar();
        resolve(false);
      }
    }

    function manejarTecla(e) {
      if (e.key === 'Escape') {
        cerrar();
        resolve(false);
      }
    }

    btnCancelar.addEventListener('click', manejarCancelar);
    btnConfirmar.addEventListener('click', manejarConfirmar);
    overlay.addEventListener('click', manejarClickOverlay);
    document.addEventListener('keydown', manejarTecla);

    overlay.hidden = false;
    btnCancelar.focus();
  });
}

function escaparHtmlModal(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  'Ya tiene 3 solicitudes activas con este abogado. Espere una respuesta o cancele alguna antes de enviar una nueva.',
  'Podrá dejar su reseña 24 horas después de completada la consulta.',
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
