// configuracion-cuenta.js
// Lógica de configuracion-cuenta.html: hoy solo la sección "Usuarios
// bloqueados" (CLAUDE.md módulo 4 de la ronda de fixes) — la sección
// "Preferencias" es un placeholder sin lógica todavía. Accesible para
// cualquier rol autenticado desde "Configuración de cuenta" en el menú de
// avatar del header (header.js). Importa todo desde api.js — nunca
// consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, rutaPanelPropio } from './utils.js';
import { inicializarHeader } from './header.js';

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[configuracion-cuenta] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  const perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual) {
    window.location.href = '/';
    return;
  }

  document.getElementById('btnVolverPanel').href = rutaPanelPropio(perfilActual.rol);

  let urlPerfilPublico;
  if (perfilActual.rol === 'abogado') {
    const abogadoActual = await api.abogados.getPerfilPropio();
    urlPerfilPublico = abogadoActual ? `/pages/perfil-abogado?id=${abogadoActual.id}` : undefined;
  }
  inicializarHeader({
    rol: perfilActual.rol,
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico,
  });

  await cargarBloqueados();

  mostrarContenido();
  configurarEventos();
}

function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarContenido() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoPanel').hidden = false;
}

function configurarEventos() {
  document.getElementById('bloqueadosLista').addEventListener('click', manejarClickDesbloquear);
}

// ─── Usuarios bloqueados ────────────────────────────────────────────────────
async function cargarBloqueados() {
  const misBloqueos = await api.bloqueos.getMisBloqueos();
  renderizarBloqueados(misBloqueos);
}

function renderizarBloqueados(lista) {
  const contenedor = document.getElementById('bloqueadosLista');
  const vacio = document.getElementById('estadoSinBloqueados');

  if (!lista || lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarCardBloqueado).join('');
}

function generarCardBloqueado(b) {
  const avatarHtml = generarAvatarHtml(b.bloqueado_foto, b.bloqueado_nombre);
  const idSeguro = escaparAtrib(b.bloqueado_id);
  const nombreSeguro = escaparAtrib(b.bloqueado_nombre);

  return `
    <article class="card-abogado" role="listitem">
      <div class="card-abogado__header">
        <div class="card-abogado__avatar">${avatarHtml}</div>
        <div class="card-abogado__meta">
          <h3 class="card-abogado__nombre">${escaparHtml(b.bloqueado_nombre)}</h3>
          <p class="card-abogado__ubicacion">Bloqueado el ${formatearFecha(b.created_at)}</p>
        </div>
      </div>
      <div class="card-abogado__footer">
        <div class="solicitud-item__acciones">
          <button class="btn btn--secundario btn--sm" type="button"
            data-accion="desbloquear" data-id="${idSeguro}" data-nombre="${nombreSeguro}">
            Desbloquear
          </button>
        </div>
      </div>
    </article>
  `;
}

async function manejarClickDesbloquear(e) {
  const btn = e.target.closest('[data-accion="desbloquear"]');
  if (!btn) return;

  const errorEl = document.getElementById('errorBloqueos');
  errorEl.textContent = '';
  btn.disabled = true;

  const { error } = await api.bloqueos.desbloquear(btn.dataset.id);

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo desbloquear. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    btn.disabled = false;
    return;
  }

  const nombre = btn.dataset.nombre;
  await cargarBloqueados();
  toast.exito(`Se ha desbloqueado a ${nombre}. Ahora puede volver a ver su perfil y enviarle solicitudes.`);
}

// ─── Helpers de presentación ──────────────────────────────────────────────
function generarAvatarHtml(fotoPath, nombre) {
  const fotoUrl = fotoPath ? api.storage.getPublicUrl('avatares', fotoPath) : null;
  return fotoUrl
    ? `<img src="${escaparAtrib(fotoUrl)}" alt="Foto de ${escaparAtrib(nombre)}">`
    : `<div class="avatar-placeholder" aria-hidden="true">${escaparHtml(obtenerIniciales(nombre))}</div>`;
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

function formatearFecha(fechaIso) {
  if (!fechaIso) return '';
  return new Date(fechaIso).toLocaleDateString('es-EC', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

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
