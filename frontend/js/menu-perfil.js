// menu-perfil.js
// Menú desplegable de perfil en el header: foto (o iniciales) en círculo,
// con accesos según el rol del usuario. Reemplaza al nombre de usuario en
// texto plano que tenían panel-cliente.html y panel-abogado.html.
//
// Uso desde cada panel, después de confirmar sesión y rol, con el
// <nav class="nav-usuario"> ya presente en el DOM:
//   import { inicializarMenuPerfil, actualizarAvatarMenuPerfil } from './menu-perfil.js';
//   inicializarMenuPerfil({ rol: 'abogado', nombre, fotoPath, urlPerfilPublico });

import * as api from './api.js';
import { rutaPanelPropio } from './utils.js';

/**
 * Inyecta el botón de avatar + menú desplegable en el header y conecta
 * el cierre de sesión. urlPerfilPublico solo se usa (y es obligatorio)
 * cuando rol === 'abogado'.
 */
export function inicializarMenuPerfil({ rol, nombre, fotoPath, urlPerfilPublico }) {
  const nav = document.querySelector('.nav-usuario');
  if (!nav) return;

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
  actualizarAvatarMenuPerfil(fotoPath, nombre);

  const boton = document.getElementById('btnMenuPerfil');
  const lista = document.getElementById('listaMenuPerfil');

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

  document.getElementById('btnCerrarSesionMenu').addEventListener('click', async () => {
    await api.auth.cerrarSesion();
    window.location.href = '/';
  });
}

/**
 * Actualiza la foto (o iniciales) mostrada en el botón del menú. Llamar
 * después de subir una foto de perfil nueva.
 */
export function actualizarAvatarMenuPerfil(fotoPath, nombre) {
  const el = document.getElementById('menuPerfilAvatar');
  if (!el) return;
  el.innerHTML = generarAvatarHtml(fotoPath, nombre);
}

function generarItems(rol, urlPerfilPublico) {
  const rutaPropia = rutaPanelPropio(rol);

  const itemVerPerfilPublico = rol === 'abogado'
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="${escaparAtrib(urlPerfilPublico)}" target="_blank" rel="noopener noreferrer">Ver mi perfil público</a></li>`
    : '';

  const itemReferir = rol === 'abogado'
    ? `<li role="none"><a role="menuitem" class="menu-desplegable__item" href="/pages/referidos">Referir un colega</a></li>`
    : '';

  return `
    ${itemVerPerfilPublico}
    <li role="none"><a role="menuitem" class="menu-desplegable__item" href="${rutaPropia}?tab=perfil">Editar perfil</a></li>
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
