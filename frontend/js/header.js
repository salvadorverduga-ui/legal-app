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
import { rutaPanelPropio, aplicarEstadoDeshabilitado, inicializarTooltipsDeshabilitados, toast } from './utils.js';
import { inicializarNotificaciones } from './notificaciones.js';

// Cancela la suscripción anterior antes de resuscribirse -- inicializarHeader()
// podría en teoría llamarse más de una vez en la misma carga de página
// (defensivo; hoy cada página lo llama una sola vez).
let cancelarEscuchaInboxHeader = null;

// Mismo mensaje que panel-abogado.js usa para el acceso rápido "Ver mi
// perfil público" del dashboard (CLAUDE.md §44 módulo 3) — acá se repite
// para el ítem homónimo del menú de avatar, para que ambos digan lo mismo.
const MENSAJE_PERFIL_PUBLICO_NO_DISPONIBLE =
  'Su perfil público no está disponible hasta que su cuenta sea verificada por el administrador.';

/**
 * Renderiza el <nav class="nav-usuario"> según el estado de sesión y
 * devuelve los datos de usuario usados ({ rol, nombre, fotoPath,
 * urlPerfilPublico }) o null si se renderizó el estado anónimo.
 */
export async function inicializarHeader(opciones = {}) {
  const { rol, nombre, fotoPath, urlPerfilPublico, forzarAnonimo = false, abogadoNoVerificado = false } = opciones;

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
    renderizarAutenticado(nav, { ...datosUsuario, abogadoNoVerificado });
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
  // /?mostrar_login=true (no solo /) para que app.js abra el formulario de
  // login directamente, sin pasar por la selección de rol — necesario
  // incluso en index.html mismo, donde un href="/" liso es un autoenlace
  // que no hace nada visible al hacer clic (ver CLAUDE.md §45).
  nav.insertAdjacentHTML('beforeend', `
    <a class="btn btn--secundario btn--sm" href="/?mostrar_login=true" style="${ESTILO_BOTON_HEADER}">Iniciar sesión</a>
  `);
}

// ─── Estado autenticado ──────────────────────────────────────────────────────
function renderizarAutenticado(nav, { rol, nombre, fotoPath, urlPerfilPublico, abogadoNoVerificado }) {
  nav.insertAdjacentHTML('beforeend', generarEnlacesRapidos(rol));

  // Los enlaces recién insertados por generarEnlacesRapidos() se deshabilitan
  // acá (no en el HTML) porque aplicarEstadoDeshabilitado() opera sobre
  // elementos ya en el DOM. Solo aplica a un abogado no verificado — un
  // cliente nunca recibe este flag en true.
  if (rol === 'abogado' && abogadoNoVerificado) {
    aplicarEstadoDeshabilitado(nav.querySelector('#navEnlaceTablon'), true);
    aplicarEstadoDeshabilitado(nav.querySelector('#navEnlaceSeguimiento'), true);
    aplicarEstadoDeshabilitado(nav.querySelector('#navEnlaceMensajes'), true);
    inicializarTooltipsDeshabilitados();
  }

  if (rol === 'cliente' || rol === 'abogado') {
    cargarBadgeMensajes();
    if (cancelarEscuchaInboxHeader) cancelarEscuchaInboxHeader();
    cancelarEscuchaInboxHeader = api.mensajes.escucharInbox(() => cargarBadgeMensajes());
  }

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
      ${generarItems(rol, urlPerfilPublico, abogadoNoVerificado)}
    </ul>
  `;

  nav.appendChild(contenedor);
  actualizarAvatarHeader(fotoPath, nombre);

  configurarMenuDesplegable(contenedor, document.getElementById('btnMenuPerfil'), document.getElementById('listaMenuPerfil'));

  // "Ver mi perfil público" bloqueado: no navega (preventDefault sobre el
  // propio target="_blank"), muestra un toast en vez de un tooltip — mismo
  // criterio que el acceso rápido homónimo del dashboard (panel-abogado.js).
  if (rol === 'abogado' && abogadoNoVerificado) {
    document.getElementById('menuItemVerPerfilPublico')?.addEventListener('click', (e) => {
      e.preventDefault();
      toast.info(MENSAJE_PERFIL_PUBLICO_NO_DISPONIBLE);
    });
  }

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

// El Tablón, Mensajes y En seguimiento son accesos comunes a cliente y
// abogado — se insertan antes del avatar en cada página que usa este header.
function generarEnlacesRapidos(rol) {
  if (rol !== 'cliente' && rol !== 'abogado') return '';
  const rutaSeguimiento = `${rutaPanelPropio(rol)}?tab=seguimiento`;
  return `
    <a class="btn btn--secundario btn--sm" id="navEnlaceTablon" href="/pages/tablon" style="${ESTILO_BOTON_HEADER}">El Tablón</a>
    <a class="btn btn--secundario btn--sm" id="navEnlaceMensajes" href="/pages/mensajes" style="${ESTILO_BOTON_HEADER}">
      Mensajes
      <span class="badge-chat-no-leidos" id="navBadgeMensajes" hidden></span>
    </a>
    <a class="btn btn--secundario btn--sm" id="navEnlaceSeguimiento" href="${escaparAtrib(rutaSeguimiento)}" style="${ESTILO_BOTON_HEADER}">En seguimiento</a>
  `;
}

// Suma unread_count de todos los asuntos del usuario (inbox_view, migración
// 092/094) para el badge del link "Mensajes". Se recalcula por completo en
// cada evento de escucharInbox() -- el payload crudo de conversations no
// trae unread_count ya resuelto, mismo criterio que el refresco del inbox
// en frontend/js/mensajes.js (Parte 6).
async function cargarBadgeMensajes() {
  const badge = document.getElementById('navBadgeMensajes');
  if (!badge) return;

  const inbox = await api.mensajes.getInbox();
  const total = inbox.reduce((acc, item) => acc + (item.unread_count > 0 ? item.unread_count : 0), 0);

  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
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

// Página dedicada de edición por rol (CLAUDE.md módulo 2) — antes ambos
// paneles resolvían esto con una pestaña interna en `?tab=perfil`.
const RUTA_EDITAR_PERFIL_POR_ROL = {
  cliente: '/pages/editar-perfil-cliente',
  abogado: '/pages/editar-perfil-abogado',
};

function generarItems(rol, urlPerfilPublico, abogadoNoVerificado) {
  const bloquearPerfilPublico = rol === 'abogado' && abogadoNoVerificado;
  const claseDeshabilitado = bloquearPerfilPublico ? ' menu-desplegable__item--deshabilitado' : '';
  const itemVerPerfilPublico = (rol === 'abogado' && urlPerfilPublico)
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item${claseDeshabilitado}" id="menuItemVerPerfilPublico" href="${escaparAtrib(urlPerfilPublico)}" target="_blank" rel="noopener noreferrer" aria-disabled="${bloquearPerfilPublico}">Ver mi perfil público</a></li>`
    : '';

  const rutaEditarPerfil = RUTA_EDITAR_PERFIL_POR_ROL[rol];
  const itemEditarPerfil = rutaEditarPerfil
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="${rutaEditarPerfil}">Editar perfil</a></li>`
    : '';

  const itemReferir = rol === 'abogado'
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="/pages/referidos">Referir un colega</a></li>`
    : '';

  return `
    ${itemVerPerfilPublico}
    ${itemEditarPerfil}
    ${itemReferir}
    <li role="none"><a role="menuitem" class="menu-desplegable__item" href="/pages/cambiar-contrasena">Cambiar contraseña</a></li>
    <li role="none"><a role="menuitem" class="menu-desplegable__item" href="/pages/configuracion-cuenta">Configuración de cuenta</a></li>
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
