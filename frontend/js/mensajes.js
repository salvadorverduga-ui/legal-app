// mensajes.js
// Lógica de mensajes.html: bandeja de conversaciones (inbox_view) de chat v2
// -- asunto (matters) → conversación (conversations) → mensajes (messages),
// migraciones 20260818_092/094. Página de rol dual (cliente o abogado, mismo
// criterio que tablon.js/solicitudes-directas.js): inbox_view ya resuelve
// contraparte_nombre/title según quién consulta, así que el renderizado acá
// no distingue rol salvo para el texto del estado vacío.
//
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { rutaPanelPropio } from './utils.js';
import { inicializarHeader } from './header.js';

// ─── Estado de la página ──────────────────────────────────────────────────
let rolActual = null;
let inboxActual = [];             // caché local, tal como la devuelve getInbox()
let filtroActivo = 'todos';       // 'todos' | 'no_leidos' | 'activos'
let terminoBusqueda = '';
let cancelarEscuchaInbox = null;

const FILTROS = ['filtroTodos', 'filtroNoLeidos', 'filtroActivos'];

// ─── Entry point ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[mensajes] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  const perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || (perfilActual.rol !== 'cliente' && perfilActual.rol !== 'abogado')) {
    window.location.href = '/';
    return;
  }
  rolActual = perfilActual.rol;

  document.getElementById('btnVolverPanel').href = rutaPanelPropio(rolActual);

  let urlPerfilPublico;
  if (rolActual === 'abogado') {
    const abogadoActual = await api.abogados.getPerfilPropio();
    urlPerfilPublico = abogadoActual ? `/pages/perfil-abogado?id=${abogadoActual.id}` : undefined;
  }
  inicializarHeader({
    rol: rolActual,
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico,
  });

  document.getElementById('textoSinConversaciones').textContent = rolActual === 'abogado'
    ? 'Sus chats aparecerán aquí cuando acepte una solicitud de un cliente.'
    : 'Sus chats aparecerán aquí cuando un abogado acepte su solicitud.';

  await cargarInbox();

  mostrarContenido();
  configurarEventos();

  // Realtime: cualquier mensaje nuevo en cualquiera de mis conversaciones
  // dispara fn_actualizar_last_message_at (UPDATE en conversations) -- se
  // refresca el inbox completo en vez de intentar parchear una fila, porque
  // el payload crudo de conversations no trae ni el preview ni el
  // unread_count ya resueltos (esos viven en inbox_view, no en la tabla).
  // Sin desmontaje explícito al salir de la página -- cada página de esta
  // app es una carga completa, no una SPA (mismo criterio que
  // notificaciones.js); cancelarEscuchaInbox queda igual disponible por si
  // hiciera falta más adelante.
  cancelarEscuchaInbox = api.mensajes.escucharInbox(() => cargarInbox());
}

// ─── Control de estados visuales ─────────────────────────────────────────
function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarContenido() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoPanel').hidden = false;
}

// ─── Configuración de eventos ─────────────────────────────────────────────
function configurarEventos() {
  FILTROS.forEach(id => {
    document.getElementById(id).addEventListener('click', () => cambiarFiltro(id));
  });

  document.getElementById('buscarContraparte').addEventListener('input', (e) => {
    terminoBusqueda = e.target.value.trim().toLowerCase();
    renderizar();
  });

  document.getElementById('inboxLista').addEventListener('click', manejarClickFila);
}

function cambiarFiltro(idBoton) {
  const mapa = { filtroTodos: 'todos', filtroNoLeidos: 'no_leidos', filtroActivos: 'activos' };
  filtroActivo = mapa[idBoton];

  FILTROS.forEach(id => {
    const activo = id === idBoton;
    const boton = document.getElementById(id);
    boton.classList.toggle('filtro-tipo__btn--activo', activo);
    boton.setAttribute('aria-selected', String(activo));
  });

  renderizar();
}

// ─── Carga e inbox ─────────────────────────────────────────────────────────
async function cargarInbox() {
  inboxActual = await api.mensajes.getInbox();
  renderizar();
}

function filtrarInbox() {
  return inboxActual.filter(item => {
    if (filtroActivo === 'no_leidos' && !(item.unread_count > 0)) return false;
    if (filtroActivo === 'activos' && item.status !== 'active') return false;
    if (terminoBusqueda && !(item.contraparte_nombre ?? '').toLowerCase().includes(terminoBusqueda)) return false;
    return true;
  });
}

function renderizar() {
  const skeleton = document.getElementById('inboxSkeleton');
  const lista = document.getElementById('inboxLista');
  const vacio = document.getElementById('estadoSinConversaciones');
  const tituloVacio = document.getElementById('tituloSinConversaciones');

  skeleton.hidden = true;

  const filtrada = filtrarInbox();

  if (filtrada.length === 0) {
    lista.hidden = true;
    lista.innerHTML = '';
    vacio.hidden = false;
    tituloVacio.textContent = inboxActual.length === 0
      ? 'No tiene conversaciones activas'
      : 'Sin resultados';
    return;
  }

  vacio.hidden = true;
  lista.hidden = false;
  lista.innerHTML = filtrada.map(generarFilaHtml).join('');
}

function generarFilaHtml(item) {
  const idSeguro = escaparAtrib(item.conversation_id);
  const avatarHtml = generarAvatarHtml(item.contraparte_foto, item.contraparte_nombre);
  const noLeido = item.unread_count > 0;

  const badgesHtml = [
    item.status === 'closed' ? '<span class="badge badge--estado-cancelada">Cerrado</span>' : '',
    item.source_type === 'tablon' ? '<span class="badge badge--estudio">Tablón</span>' : '',
  ].join('');

  const badgeNoLeidosHtml = noLeido
    ? `<span class="inbox-item__no-leidos">${item.unread_count > 99 ? '99+' : item.unread_count}</span>`
    : '';

  return `
    <button class="inbox-item${noLeido ? ' inbox-item--no-leido' : ''}" type="button" data-id="${idSeguro}">
      <div class="inbox-item__avatar">${avatarHtml}</div>
      <div class="inbox-item__cuerpo">
        <div class="inbox-item__linea-superior">
          <p class="inbox-item__nombre">${escaparHtml(item.contraparte_nombre)}</p>
          <span class="inbox-item__tiempo">${escaparHtml(formatearTiempoRelativo(item.last_message_at))}</span>
        </div>
        <p class="inbox-item__titulo">${escaparHtml(item.title)}</p>
        <p class="inbox-item__preview">${escaparHtml(generarPreview(item.last_message_preview))}</p>
        <div class="inbox-item__badges">${badgesHtml}</div>
      </div>
      ${badgeNoLeidosHtml}
    </button>
  `;
}

function manejarClickFila(e) {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  window.location.href = `/pages/conversacion?id=${encodeURIComponent(btn.dataset.id)}`;
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

// Máximo 50 caracteres + "..." (solo si se truncó) -- si el asunto todavía
// no tiene ningún mensaje, last_message_preview viene NULL.
function generarPreview(texto) {
  if (!texto) return 'Sin mensajes todavía.';
  const limpio = texto.trim();
  return limpio.length > 50 ? `${limpio.slice(0, 50)}...` : limpio;
}

// "hace 5 min" / "hace 3 h" (mismo día) / "ayer" / "15 ago" (más viejo).
function formatearTiempoRelativo(fechaIso) {
  if (!fechaIso) return '';

  const fecha = new Date(fechaIso);
  const ahora = new Date();
  const diffMin = Math.floor((ahora - fecha) / 60000);

  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (esMismoDia(fecha, ahora)) return `hace ${Math.floor(diffMin / 60)} h`;

  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  if (esMismoDia(fecha, ayer)) return 'ayer';

  return fecha.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' }).replace('.', '');
}

function esMismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ─── Seguridad: escapado de HTML ──────────────────────────────────────────
// Usadas en template strings para prevenir XSS con datos provenientes de la BD.
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
