// notificaciones-pagina.js
// Lógica de notificaciones.html: todas las notificaciones del usuario
// autenticado, agrupadas por fecha (Hoy / Esta semana / Anteriores), con
// filtro por tipo y paginación de 20 por página (CLAUDE.md módulo 6).
// A diferencia del dropdown de la campana (notificaciones.js), acá se
// listan tanto leídas como no leídas sin límite de 7.
//
// El filtro por tipo se aplica sobre la página ya cargada (api.js solo
// pagina por fecha, no por tipo) — simplificación documentada en CLAUDE.md
// §31: es infrecuente que un usuario tenga muchas páginas de notificaciones,
// así que filtrar dentro de la página actual es suficiente para el caso de uso.
//
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, rutaPanelPropio } from './utils.js';
import { inicializarHeader } from './header.js';

const ETIQUETAS_TIPO = {
  nueva_solicitud:          'Nueva solicitud',
  solicitud_aceptada:       'Solicitud aceptada',
  solicitud_rechazada:      'Solicitud rechazada',
  solicitud_expirada:       'Solicitud expirada',
  solicitud_cancelada:      'Solicitud cancelada',
  verificacion_aprobada:    'Verificación aprobada',
  verificacion_rechazada:   'Verificación rechazada',
  suscripcion_inactiva:     'Suscripción inactiva',
  tablon_nueva_aplicacion:  'Nueva aplicación en El Tablón',
  tablon_elegido:           'Elegido en El Tablón',
  tablon_caso_cerrado:      'Caso de El Tablón cerrado',
  tablon_caso_expirado:     'Caso de El Tablón expirado',
};

let paginaActual = 1;
let totalNotificaciones = 0;
let notificacionesActuales = [];
let tipoFiltroActivo = '';

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[notificaciones-pagina] Error al cargar configuración:', err);
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

  poblarFiltroTipo();
  await cargarPagina(1);

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

function poblarFiltroTipo() {
  const select = document.getElementById('filtroTipo');
  Object.entries(ETIQUETAS_TIPO).forEach(([valor, etiqueta]) => {
    const option = document.createElement('option');
    option.value = valor;
    option.textContent = etiqueta;
    select.appendChild(option);
  });
}

function configurarEventos() {
  document.getElementById('filtroTipo').addEventListener('change', (e) => {
    tipoFiltroActivo = e.target.value;
    renderizar();
  });

  document.getElementById('btnMarcarTodasLeidas').addEventListener('click', manejarMarcarTodasLeidas);

  document.getElementById('gruposNotificaciones').addEventListener('click', manejarClickNotificacion);

  document.getElementById('btnPaginaAnterior').addEventListener('click', () => {
    if (paginaActual > 1) cargarPagina(paginaActual - 1);
  });
  document.getElementById('btnPaginaSiguiente').addEventListener('click', () => {
    if (paginaActual < totalPaginas()) cargarPagina(paginaActual + 1);
  });
}

function totalPaginas() {
  return Math.max(1, Math.ceil(totalNotificaciones / 20));
}

async function cargarPagina(pagina) {
  const { data, total } = await api.notificaciones.getTodas(pagina);
  paginaActual = pagina;
  notificacionesActuales = data;
  totalNotificaciones = total;
  renderizar();
}

function renderizar() {
  const lista = tipoFiltroActivo
    ? notificacionesActuales.filter(n => n.tipo === tipoFiltroActivo)
    : notificacionesActuales;

  const contenedor = document.getElementById('gruposNotificaciones');
  const vacio = document.getElementById('estadoSinNotificaciones');
  const textoVacio = document.getElementById('textoSinNotificaciones');

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    textoVacio.textContent = notificacionesActuales.length === 0
      ? 'Aún no tiene notificaciones.'
      : 'No hay notificaciones de este tipo en esta página.';
  } else {
    vacio.hidden = true;
    contenedor.innerHTML = agruparPorFecha(lista).map(generarGrupoHtml).join('');
  }

  renderizarPaginacion();
}

// Agrupa en "Hoy" / "Esta semana" / "Anteriores", en ese orden, omitiendo
// grupos vacíos.
function agruparPorFecha(lista) {
  const hoy = [];
  const estaSemana = [];
  const anteriores = [];
  const ahora = Date.now();
  const inicioHoy = new Date().setHours(0, 0, 0, 0);
  const haceUnaSemana = ahora - 7 * 24 * 60 * 60 * 1000;

  lista.forEach(n => {
    const fecha = new Date(n.created_at).getTime();
    if (fecha >= inicioHoy) hoy.push(n);
    else if (fecha >= haceUnaSemana) estaSemana.push(n);
    else anteriores.push(n);
  });

  return [
    { titulo: 'Hoy', items: hoy },
    { titulo: 'Esta semana', items: estaSemana },
    { titulo: 'Anteriores', items: anteriores },
  ].filter(grupo => grupo.items.length > 0);
}

function generarGrupoHtml(grupo) {
  return `
    <h2 class="panel-inicio__seccion-titulo">${escaparHtml(grupo.titulo)}</h2>
    <div class="notificaciones__lista notificaciones__lista--pagina">
      <div class="notificaciones__items">
        ${grupo.items.map(generarItem).join('')}
      </div>
    </div>
  `;
}

function generarItem(n) {
  const idSeguro = escaparAtrib(n.id);
  const urlSegura = escaparAtrib(n.url_destino || '');
  const claseLeida = n.leida ? ' notificaciones__item--leida' : '';

  return `
    <button class="notificaciones__item${claseLeida}" type="button" data-id="${idSeguro}" data-url="${urlSegura}">
      <p class="notificaciones__item-titulo">${escaparHtml(n.titulo)}</p>
      <p class="notificaciones__item-mensaje">${escaparHtml(n.mensaje)}</p>
      <p class="notificaciones__item-fecha">${formatearFechaHora(n.created_at)}</p>
    </button>
  `;
}

function renderizarPaginacion() {
  const paginacion = document.getElementById('paginacion');
  const paginas = totalPaginas();

  paginacion.hidden = totalNotificaciones === 0;
  document.getElementById('textoPagina').textContent = `Página ${paginaActual} de ${paginas}`;
  document.getElementById('btnPaginaAnterior').disabled = paginaActual <= 1;
  document.getElementById('btnPaginaSiguiente').disabled = paginaActual >= paginas;
}

async function manejarClickNotificacion(e) {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;

  const { id, url } = btn.dataset;

  const entrada = notificacionesActuales.find(n => n.id === id);
  if (entrada && !entrada.leida) {
    await api.notificaciones.marcarLeida(id);
    entrada.leida = true;
    renderizar();
  }

  if (url) window.location.href = url;
}

async function manejarMarcarTodasLeidas() {
  await api.notificaciones.marcarTodasLeidas();
  notificacionesActuales = notificacionesActuales.map(n => ({ ...n, leida: true }));
  renderizar();
  toast.exito('Todas las notificaciones se marcaron como leídas.');
}

// ─── Helpers de presentación ──────────────────────────────────────────────
function formatearFechaHora(fechaIso) {
  if (!fechaIso) return '';
  return new Date(fechaIso).toLocaleString('es-EC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Seguridad: escapado de HTML ──────────────────────────────────────────
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
