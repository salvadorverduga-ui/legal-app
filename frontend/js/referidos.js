// referidos.js
// Lógica de la página referidos.html — programa de referidos entre
// abogados (migración 20260712_043_referidos.sql). Solo accesible para
// abogados; se llega desde "Referir un colega" en el menú de perfil.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast } from './utils.js';
import { inicializarHeader } from './header.js';

const ETIQUETAS_ESTADO_REFERIDO = {
  PENDIENTE:  'Pendiente',
  COMPLETADO: 'Completado',
};

const CLASE_ESTADO_REFERIDO = {
  PENDIENTE:  'badge--estado-pendiente',
  COMPLETADO: 'badge--estado-aceptada',
};

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[referidos] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  const perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || perfilActual.rol !== 'abogado') {
    window.location.href = '/';
    return;
  }

  const abogadoActual = await api.abogados.getPerfilPropio();
  if (!abogadoActual?.codigo_referido) {
    mostrarError();
    return;
  }

  inicializarHeader({
    rol: 'abogado',
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico: `/pages/perfil-abogado?id=${abogadoActual.id}`,
  });

  document.getElementById('linkReferido').value = `${window.location.origin}/registro?ref=${abogadoActual.codigo_referido}`;

  const misReferidos = await api.referidos.getMisReferidos();
  renderizarReferidos(misReferidos);

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
  document.getElementById('btnCopiarLink').addEventListener('click', manejarCopiarLink);
}

async function manejarCopiarLink() {
  const input = document.getElementById('linkReferido');
  const estadoEl = document.getElementById('estadoCopiado');

  try {
    await navigator.clipboard.writeText(input.value);
    estadoEl.textContent = 'Link copiado.';
    toast.exito('Link copiado.');
  } catch (err) {
    console.error('[referidos] No se pudo copiar el link:', err);
    input.select();
    estadoEl.textContent = 'No se pudo copiar automáticamente. Selecciónelo y copie manualmente.';
    toast.error('No se pudo copiar el link.');
  }
}

// ─── Referidos enviados ────────────────────────────────────────────────────────
function renderizarReferidos(lista) {
  const contenedor = document.getElementById('referidosLista');
  const vacio = document.getElementById('estadoSinReferidos');

  if (!lista || lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarReferidoCard).join('');
}

function generarReferidoCard(r) {
  const claseEstado = CLASE_ESTADO_REFERIDO[r.estado] ?? 'badge--estado-pendiente';
  const etiquetaEstado = ETIQUETAS_ESTADO_REFERIDO[r.estado] ?? r.estado;

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="solicitud-item__nombre">${escaparHtml(r.referido_email ?? 'Correo no disponible')}</p>
          <p class="solicitud-item__fecha">${formatearFecha(r.created_at)}</p>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
    </article>
  `;
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
function formatearFecha(fechaIso) {
  if (!fechaIso) return '';
  return new Date(fechaIso).toLocaleDateString('es-EC', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
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
