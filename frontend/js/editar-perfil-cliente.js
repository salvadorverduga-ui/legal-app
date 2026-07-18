// editar-perfil-cliente.js
// Lógica de editar-perfil-cliente.html: página independiente de edición de
// perfil, antes la pestaña "Mi perfil" de panel-cliente.html (CLAUDE.md §2,
// módulo 2). Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';
import { inicializarHeader, actualizarAvatarHeader } from './header.js';

let perfilActual = null;

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[editar-perfil-cliente] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || perfilActual.rol !== 'cliente') {
    window.location.href = '/';
    return;
  }

  inicializarHeader({ rol: 'cliente', nombre: perfilActual.nombre_completo, fotoPath: perfilActual.foto_url });

  renderizarFoto();
  rellenarFormulario();

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
  document.getElementById('btnCambiarFoto').addEventListener('click', () => {
    document.getElementById('inputFoto').click();
  });
  document.getElementById('inputFoto').addEventListener('change', manejarCambioFoto);

  document.getElementById('formPerfil').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarGuardarPerfil();
  });
}

// ─── Foto ──────────────────────────────────────────────────────────────────
function renderizarFoto() {
  document.getElementById('perfilFotoAvatar').innerHTML = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);
}

const FOTO_TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

async function manejarCambioFoto(e) {
  const archivo = e.target.files[0];
  if (!archivo) return;

  const estadoEl = document.getElementById('fotoEstado');

  if (!archivo.type.startsWith('image/')) {
    const mensaje = 'El archivo debe ser una imagen.';
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
    e.target.value = '';
    return;
  }

  if (archivo.size > FOTO_TAMANO_MAXIMO_BYTES) {
    const mensaje = 'La imagen no debe superar los 10MB.';
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
    e.target.value = '';
    return;
  }

  estadoEl.textContent = 'Subiendo foto...';

  const { url, error } = await api.perfiles.subirFotoPerfil(archivo);

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo subir la foto. Intente de nuevo.');
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
    e.target.value = '';
    return;
  }

  perfilActual.foto_url = url;
  renderizarFoto();
  actualizarAvatarHeader(perfilActual.foto_url, perfilActual.nombre_completo);
  estadoEl.textContent = 'Foto actualizada.';
  toast.exito('Foto actualizada.');
  e.target.value = '';
}

// ─── Formulario ────────────────────────────────────────────────────────────
function rellenarFormulario() {
  document.getElementById('perfilNombre').value = perfilActual.nombre_completo ?? '';
  document.getElementById('perfilTelefono').value = perfilActual.telefono ?? '';
  document.getElementById('perfilProvincia').value = perfilActual.provincia ?? '';
  document.getElementById('perfilCiudad').value = perfilActual.ciudad ?? '';
}

async function manejarGuardarPerfil() {
  const btn = document.getElementById('btnGuardarPerfil');
  const errorEl = document.getElementById('errorPerfil');
  const exitoEl = document.getElementById('exitoPerfil');

  errorEl.textContent = '';
  exitoEl.hidden = true;

  const nombre_completo = document.getElementById('perfilNombre').value.trim();
  if (!nombre_completo) {
    errorEl.textContent = 'Ingrese su nombre completo.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const telefono = document.getElementById('perfilTelefono').value.trim();
  const provincia = document.getElementById('perfilProvincia').value;
  const ciudad = document.getElementById('perfilCiudad').value.trim();

  const { data, error } = await api.perfiles.actualizarPerfil({
    nombre_completo,
    telefono: telefono || null,
    provincia: provincia || null,
    ciudad: ciudad || null,
  });

  if (error) {
    const mensaje = mensajeAmigable(error, 'Ocurrió un error. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
  } else {
    perfilActual = data;
    actualizarAvatarHeader(perfilActual.foto_url, perfilActual.nombre_completo);
    exitoEl.hidden = false;
    toast.exito('Perfil guardado.');
  }

  btn.disabled = false;
  btn.textContent = 'Guardar cambios';
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
