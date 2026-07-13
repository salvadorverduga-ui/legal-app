// notificaciones.js
// Componente de notificaciones internas (CLAUDE.md módulo 5): ícono de
// campana en el header, badge de no leídas, dropdown con las notificaciones
// pendientes y actualización en tiempo real vía Supabase Realtime.
//
// Uso desde cada panel (panel-abogado.js, panel-cliente.js, panel-admin.js),
// una vez confirmados sesión y rol, y con el <nav class="nav-usuario"> ya
// presente en el DOM:
//   import { inicializarNotificaciones } from './notificaciones.js';
//   inicializarNotificaciones();

import * as api from './api.js';

const ICONO_CAMPANA = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
`;

const LIMITE_DROPDOWN = 7;

let notificacionesActuales = []; // últimas LIMITE_DROPDOWN, leídas y no leídas — lista visible del dropdown
let conteoNoLeidas = 0;          // cuenta real de no leídas (puede ser mayor a LIMITE_DROPDOWN) — badge de la campana
let canalRealtime = null;
let dropdownAbierto = false;

/**
 * Inyecta el botón de campana + dropdown junto al nombre de usuario del
 * header, carga las notificaciones no leídas y se suscribe a Realtime.
 * Debe llamarse una sola vez por página, después de verificar sesión y rol.
 */
export async function inicializarNotificaciones() {
  const nav = document.querySelector('.nav-usuario');
  if (!nav) return;

  const contenedor = document.createElement('div');
  contenedor.className = 'menu-desplegable notificaciones';
  contenedor.innerHTML = `
    <button class="notificaciones__boton" id="btnNotificaciones" type="button"
      aria-haspopup="true" aria-expanded="false" aria-controls="listaNotificaciones"
      aria-label="Notificaciones">
      ${ICONO_CAMPANA}
      <span class="notificaciones__badge" id="badgeNotificaciones" hidden></span>
    </button>
    <div class="menu-desplegable__lista notificaciones__lista" id="listaNotificaciones" hidden>
      <div class="notificaciones__header">
        <span>Notificaciones</span>
      </div>
      <div class="notificaciones__items" id="notificacionesItems"></div>
      <p class="notificaciones__vacio" id="notificacionesVacio" hidden>No tiene notificaciones.</p>
      <div class="notificaciones__pie" id="notificacionesPie" hidden>
        <button class="notificaciones__marcar-todas" id="btnMarcarTodasLeidas" type="button">
          Marcar todas como leídas
        </button>
      </div>
    </div>
  `;

  // En paneles con menú de perfil (menu-perfil.js), la campana se ubica justo
  // antes del avatar. En páginas que aún muestran el nombre en texto plano
  // (ej. panel-admin.html), se mantiene el comportamiento anterior.
  const menuPerfil = nav.querySelector('#menuPerfil');
  const nombreUsuario = nav.querySelector('.nav-usuario__nombre');
  if (menuPerfil) {
    menuPerfil.insertAdjacentElement('beforebegin', contenedor);
  } else if (nombreUsuario) {
    nombreUsuario.insertAdjacentElement('afterend', contenedor);
  } else {
    nav.insertBefore(contenedor, nav.firstChild);
  }

  document.getElementById('btnNotificaciones').addEventListener('click', alternarDropdown);
  document.getElementById('btnMarcarTodasLeidas').addEventListener('click', manejarMarcarTodasLeidas);
  document.getElementById('notificacionesItems').addEventListener('click', manejarClickNotificacion);
  document.addEventListener('click', cerrarDropdownSiEsExterno);

  await cargarNotificaciones();

  canalRealtime = api.notificaciones.escucharNuevas((nueva) => {
    notificacionesActuales = [nueva, ...notificacionesActuales].slice(0, LIMITE_DROPDOWN);
    conteoNoLeidas += 1;
    renderizar();
  });
}

/**
 * Cancela la suscripción de Realtime. No es necesario en el MVP (cada
 * panel es una carga de página completa, no una SPA), pero queda
 * disponible para cuando se necesite desmontar el componente.
 */
export function detenerNotificaciones() {
  api.notificaciones.dejarDeEscuchar(canalRealtime);
  canalRealtime = null;
}

async function cargarNotificaciones() {
  const [ultimas, noLeidas] = await Promise.all([
    api.notificaciones.getUltimas(LIMITE_DROPDOWN),
    api.notificaciones.getNoLeidas(),
  ]);
  notificacionesActuales = ultimas;
  conteoNoLeidas = noLeidas.length;
  renderizar();
}

function renderizar() {
  const badge = document.getElementById('badgeNotificaciones');
  const items = document.getElementById('notificacionesItems');
  const vacio = document.getElementById('notificacionesVacio');
  const pie = document.getElementById('notificacionesPie');
  if (!badge || !items || !vacio || !pie) return;

  badge.textContent = conteoNoLeidas > 9 ? '9+' : String(conteoNoLeidas);
  badge.hidden = conteoNoLeidas === 0;

  const total = notificacionesActuales.length;
  pie.hidden = total === 0;

  if (total === 0) {
    items.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  items.innerHTML = notificacionesActuales.map(generarItem).join('');
}

function generarItem(n) {
  const idSeguro = escaparAtrib(n.id);
  const urlSegura = escaparAtrib(n.url_destino || '');
  const claseLeida = n.leida ? ' notificaciones__item--leida' : '';

  return `
    <button class="notificaciones__item${claseLeida}" type="button" data-id="${idSeguro}" data-url="${urlSegura}">
      <p class="notificaciones__item-titulo">${escaparHtml(n.titulo)}</p>
      <p class="notificaciones__item-mensaje">${escaparHtml(n.mensaje)}</p>
      <p class="notificaciones__item-fecha">${formatearFecha(n.created_at)}</p>
    </button>
  `;
}

function alternarDropdown() {
  dropdownAbierto = !dropdownAbierto;
  document.getElementById('listaNotificaciones').hidden = !dropdownAbierto;
  document.getElementById('btnNotificaciones').setAttribute('aria-expanded', String(dropdownAbierto));
}

function cerrarDropdown() {
  dropdownAbierto = false;
  document.getElementById('listaNotificaciones').hidden = true;
  document.getElementById('btnNotificaciones').setAttribute('aria-expanded', 'false');
}

function cerrarDropdownSiEsExterno(e) {
  if (!dropdownAbierto) return;
  const contenedor = document.querySelector('.notificaciones');
  if (contenedor && !contenedor.contains(e.target)) cerrarDropdown();
}

async function manejarClickNotificacion(e) {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;

  const { id, url } = btn.dataset;

  // Las notificaciones leídas quedan visibles en el dropdown (atenuadas),
  // no se ocultan — solo se marca la propia y se ajusta el badge.
  const entrada = notificacionesActuales.find(n => n.id === id);
  if (entrada && !entrada.leida) {
    await api.notificaciones.marcarLeida(id);
    entrada.leida = true;
    conteoNoLeidas = Math.max(0, conteoNoLeidas - 1);
    renderizar();
  }
  cerrarDropdown();

  if (url) window.location.href = url;
}

async function manejarMarcarTodasLeidas() {
  await api.notificaciones.marcarTodasLeidas();
  notificacionesActuales = notificacionesActuales.map(n => ({ ...n, leida: true }));
  conteoNoLeidas = 0;
  renderizar();
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
function formatearFecha(fechaIso) {
  if (!fechaIso) return '';
  return new Date(fechaIso).toLocaleString('es-EC', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Seguridad: escapado de HTML ──────────────────────────────────────────────
function escaparHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escaparAtrib(str) {
  return escaparHtml(str);
}
