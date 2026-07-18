// header.js
// Header centralizado: un único componente decide el estado del <nav
// class="nav-usuario"> del <header class="encabezado"> en toda la app, para
// que nunca aparezcan "Salir" e "Iniciar sesión" a la vez ni el nombre en
// texto plano sin foto (bug que tenían busqueda.html/perfil-abogado.html/
// panel-admin.html con markup hardcodeado independiente).
//
// Reemplaza a menu-perfil.js. Sigue delegando la campana de notificaciones a
// notificaciones.js (se inserta antes de #menuPerfil, sin cambios ahí).
//
// Uso en páginas donde el caller ya resolvió sesión y perfil (paneles,
// El Tablón, solicitudes, referidos, cambiar-contraseña):
//   import { inicializarHeader } from './header.js';
//   inicializarHeader({ rol: perfil.rol, nombre: perfil.nombre_completo, fotoPath: perfil.foto_url });
//
// Uso en páginas públicas donde puede o no haber sesión (busqueda,
// perfil-abogado, landing una vez confirmado que no hay sesión):
//   const datos = await inicializarHeader();  // resuelve sesión internamente
//
// Uso en páginas que nunca deben mostrar el estado autenticado aunque haya
// una sesión de recuperación de contraseña activa (recuperar/nueva-contraseña):
//   inicializarHeader({ forzarAnonimo: true });

import * as api from './api.js';
import { rutaPanelPropio } from './utils.js';
import { inicializarNotificaciones } from './notificaciones.js';

/**
 * Renderiza el <nav class="nav-usuario"> según el estado de sesión y
 * devuelve los datos de usuario usados ({ rol, nombre, fotoPath,
 * urlPerfilPublico }) o null si se renderizó el estado anónimo.
 */
export async function inicializarHeader(opciones = {}) {
  const { rol, nombre, fotoPath, urlPerfilPublico, forzarAnonimo = false } = opciones;

  const nav = document.querySelector('.nav-usuario');
  if (!nav) return null;

  let datosUsuario = null;

  if (forzarAnonimo) {
    datosUsuario = null;
  } else if (rol) {
    // El caller ya resolvió sesión y perfil (patrón de los paneles).
    datosUsuario = { rol, nombre, fotoPath, urlPerfilPublico };
  } else {
    // Página pública: resolver sesión acá mismo.
    const sesion = await api.auth.getSession();
    if (sesion) {
      const perfil = await api.perfiles.getPerfilActual();
      if (perfil) {
        datosUsuario = { rol: perfil.rol, nombre: perfil.nombre_completo, fotoPath: perfil.foto_url };
      }
    }
  }

  const logo = document.querySelector('.logo');
  if (logo) logo.href = datosUsuario ? rutaPanelPropio(datosUsuario.rol) : '/';

  nav.innerHTML = '';

  if (datosUsuario) {
    renderizarAutenticado(nav, datosUsuario);
    inicializarNotificaciones();
  } else {
    renderizarAnonimo(nav);
  }

  return datosUsuario;
}

/**
 * Actualiza la foto (o iniciales) mostrada en el avatar del header. Llamar
 * después de subir una foto de perfil nueva, en páginas donde el header ya
 * está inicializado en estado autenticado.
 */
export function actualizarAvatarHeader(fotoPath, nombre) {
  const el = document.getElementById('menuPerfilAvatar');
  if (!el) return;
  el.innerHTML = generarAvatarHtml(fotoPath, nombre);
}

// ─── Estado anónimo ─────────────────────────────────────────────────────────
function renderizarAnonimo(nav) {
  nav.insertAdjacentHTML('beforeend', `
    <a class="btn btn--secundario btn--sm" href="/" style="${ESTILO_BOTON_HEADER}">Iniciar sesión</a>
  `);
}

// ─── Estado autenticado ──────────────────────────────────────────────────────
function renderizarAutenticado(nav, { rol, nombre, fotoPath, urlPerfilPublico }) {
  nav.insertAdjacentHTML('beforeend', generarEnlacesRapidos(rol));

  if (rol === 'admin') {
    nav.insertAdjacentHTML('beforeend', generarMenuVerComo());
  }

  const contenedor = document.createElement('div');
  contenedor.className = 'menu-desplegable menu-perfil';
  contenedor.id = 'menuPerfil';
  contenedor.innerHTML = `
    <button class="menu-perfil__boton" id="btnMenuPerfil" type="button"
      aria-haspopup="true" aria-expanded="false" aria-controls="listaMenuPerfil"
      aria-label="Menú de perfil">
      <span class="menu-perfil__avatar" id="menuPerfilAvatar"></span>
    </button>
    <ul class="menu-desplegable__lista" id="listaMenuPerfil" role="menu" hidden>
      ${generarItems(rol, urlPerfilPublico)}
    </ul>
  `;

  nav.appendChild(contenedor);
  actualizarAvatarHeader(fotoPath, nombre);

  configurarMenuDesplegable(contenedor, document.getElementById('btnMenuPerfil'), document.getElementById('listaMenuPerfil'));

  if (rol === 'admin') {
    const menuVerComo = document.getElementById('menuVerComo');
    configurarMenuDesplegable(menuVerComo, document.getElementById('btnVerComo'), document.getElementById('listaVerComo'));
  }

  document.getElementById('btnCerrarSesionMenu').addEventListener('click', async () => {
    await api.auth.cerrarSesion();
    window.location.href = '/';
  });
}

// Menú desplegable genérico: abre/cierra con click en el botón, cierra al
// hacer click afuera o con Escape. Reutilizado por el menú de perfil y,
// para el admin, por "Ver como".
function configurarMenuDesplegable(contenedor, boton, lista) {
  function cerrarMenu() {
    lista.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
  }

  function abrirMenu() {
    lista.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
  }

  boton.addEventListener('click', () => {
    if (lista.hidden) abrirMenu();
    else cerrarMenu();
  });

  document.addEventListener('click', (e) => {
    if (!contenedor.contains(e.target)) cerrarMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarMenu();
  });
}

// Estilo inline usado en todo el header para botones secundarios sobre el
// fondo oscuro de .encabezado.
const ESTILO_BOTON_HEADER = 'border-color: rgba(255,255,255,0.4); color: rgba(255,255,255,0.85);';

// El Tablón y En seguimiento son accesos comunes a cliente y abogado — se
// insertan antes del avatar en cada página que usa este header.
function generarEnlacesRapidos(rol) {
  if (rol !== 'cliente' && rol !== 'abogado') return '';
  const rutaSeguimiento = `${rutaPanelPropio(rol)}?tab=seguimiento`;
  return `
    <a class="btn btn--secundario btn--sm" href="/pages/tablon" style="${ESTILO_BOTON_HEADER}">El Tablón</a>
    <a class="btn btn--secundario btn--sm" href="${escaparAtrib(rutaSeguimiento)}" style="${ESTILO_BOTON_HEADER}">En seguimiento</a>
  `;
}

// "Ver como" (solo admin): navegación en pestañas nuevas, no cambia el rol
// ni la sesión del admin. Antes vivía inline en panel-admin.html/.js.
function generarMenuVerComo() {
  return `
    <div class="menu-desplegable" id="menuVerComo">
      <button class="btn btn--secundario btn--sm" id="btnVerComo" type="button"
        aria-haspopup="true" aria-expanded="false" aria-controls="listaVerComo"
        style="${ESTILO_BOTON_HEADER}">
        Ver como
      </button>
      <ul class="menu-desplegable__lista" id="listaVerComo" role="menu" hidden>
        <li role="none">
          <a role="menuitem" class="menu-desplegable__item" href="/pages/busqueda" target="_blank" rel="noopener noreferrer">
            Ver como cliente
          </a>
        </li>
        <li role="none">
          <a role="menuitem" class="menu-desplegable__item" href="/pages/panel-abogado" target="_blank" rel="noopener noreferrer">
            Ver como abogado
          </a>
        </li>
      </ul>
    </div>
  `;
}

function generarItems(rol, urlPerfilPublico) {
  const rutaPropia = rutaPanelPropio(rol);

  const itemVerPerfilPublico = (rol === 'abogado' && urlPerfilPublico)
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="${escaparAtrib(urlPerfilPublico)}" target="_blank" rel="noopener noreferrer">Ver mi perfil público</a></li>`
    : '';

  const itemEditarPerfil = (rol === 'cliente' || rol === 'abogado')
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="${rutaPropia}?tab=perfil">Editar perfil</a></li>`
    : '';

  const itemReferir = rol === 'abogado'
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="/pages/referidos">Referir un colega</a></li>`
    : '';

  return `
    ${itemVerPerfilPublico}
    ${itemEditarPerfil}
    ${itemReferir}
    <li role="none"><a role="menuitem" class="menu-desplegable__item" href="/pages/cambiar-contrasena">Cambiar contraseña</a></li>
    <li role="none"><button role="menuitem" class="menu-desplegable__item" id="btnCerrarSesionMenu" type="button">Cerrar sesión</button></li>
  `;
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
function generarAvatarHtml(fotoPath, nombre) {
  const fotoUrl = fotoPath ? api.storage.getPublicUrl('avatares', fotoPath) : null;
  return fotoUrl
    ? `<img src="${escaparAtrib(fotoUrl)}" alt="Foto de ${escaparAtrib(nombre)}">`
    : `<span class="avatar-placeholder" aria-hidden="true">${escaparHtml(obtenerIniciales(nombre))}</span>`;
}

function obtenerIniciales(nombre) {
  if (!nombre) return '?';
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
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
