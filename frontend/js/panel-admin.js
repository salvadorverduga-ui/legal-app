// panel-admin.js
// Lógica de la página panel-admin.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { inicializarNotificaciones } from './notificaciones.js';

// ─── Etiquetas y estilos ───────────────────────────────────────────────────
const ETIQUETAS_TIPO_SOLICITANTE = {
  abogado: 'Abogado individual',
  estudio: 'Estudio jurídico',
};

const ETIQUETAS_ESTADO_SUSCRIPCION = {
  ACTIVA:     { texto: 'Activa',     clase: 'badge--verificado' },
  VENCIDA:    { texto: 'Vencida',    clase: 'badge--rechazado' },
  CANCELADA:  { texto: 'Cancelada',  clase: 'badge--pendiente' },
};

const ETIQUETAS_TIPO_SUSCRIPCION = {
  ABOGADO_INDIVIDUAL: 'Abogado individual',
  ESTUDIO_PEQUENO:    'Estudio pequeño',
  ESTUDIO_MEDIANO:    'Estudio mediano',
  ESTUDIO_GRANDE:     'Estudio grande',
};

const ETIQUETAS_METRICAS = {
  total_abogados_verificados: 'Abogados verificados',
  total_clientes:             'Clientes registrados',
  total_solicitudes_mes:      'Solicitudes este mes',
  tasa_aceptacion:            'Tasa de aceptación',
};

const ETIQUETAS_ACCION_LOG = {
  APROBAR:  { texto: 'Aprobó verificación',  clase: 'badge--verificado' },
  RECHAZAR: { texto: 'Rechazó verificación', clase: 'badge--rechazado' },
};

const SECCIONES = ['Verificaciones', 'Suscripciones', 'Metricas', 'LogAcciones'];

// ─── Estado de la página ──────────────────────────────────────────────────
let perfilActual = null;              // fila propia de la tabla perfiles
let verificacionesActuales = [];      // caché local; las acciones actualizan sin refetch
let verificacionConRechazoAbierto = null; // id de la verificación con el campo de motivo visible
let busquedaVerificaciones = '';       // texto de búsqueda por nombre (abogado o estudio)
let tipoFiltroVerificacion = '';       // '' = todos | 'abogado' | 'estudio'

// ─── Entry point ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  // 1. Inicializar Supabase con la configuración de /api/config
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[panel-admin] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  // 2. Verificar autenticación — redirigir si no hay sesión
  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  // 3. Verificar rol — este panel es solo para administradores
  perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || perfilActual.rol !== 'admin') {
    window.location.href = '/';
    return;
  }

  document.getElementById('nombreUsuario').textContent = perfilActual.nombre_completo;
  inicializarNotificaciones();

  await Promise.all([
    cargarVerificaciones(),
    cargarSuscripciones(),
    cargarMetricas(),
    cargarLogAcciones(),
  ]);

  mostrarContenido();
  configurarEventos();
}

// ─── Control de estados visuales ───────────────────────────────────────────
function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarContenido() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoPanel').hidden = false;
}

// ─── Configuración de eventos ───────────────────────────────────────────────
function configurarEventos() {
  document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
    await api.auth.cerrarSesion();
    window.location.href = '/';
  });

  SECCIONES.forEach(nombre => {
    document.getElementById(`tab${nombre}`).addEventListener('click', () => cambiarTab(nombre));
  });

  document.getElementById('verificacionesLista').addEventListener('click', manejarClickVerificaciones);

  document.getElementById('buscarVerificaciones').addEventListener('input', (e) => {
    busquedaVerificaciones = e.target.value.trim().toLowerCase();
    renderizarVerificaciones();
  });

  document.getElementById('filtroTipoVerificacion').addEventListener('change', (e) => {
    tipoFiltroVerificacion = e.target.value;
    renderizarVerificaciones();
  });

  configurarMenuVerComo();
}

// ─── Menú "Ver como" ────────────────────────────────────────────────────────
// Solo navegación en pestañas nuevas; no cambia el rol ni la sesión del admin.
function configurarMenuVerComo() {
  const contenedor = document.getElementById('menuVerComo');
  const boton = document.getElementById('btnVerComo');
  const lista = document.getElementById('listaVerComo');

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

// ─── Navegación por secciones ───────────────────────────────────────────────
function cambiarTab(seccion) {
  SECCIONES.forEach(nombre => {
    const esActiva = nombre === seccion;
    document.getElementById(`tab${nombre}`).classList.toggle('panel-tab--activo', esActiva);
    document.getElementById(`tab${nombre}`).setAttribute('aria-selected', String(esActiva));
    document.getElementById(`seccion${nombre}`).hidden = !esActiva;
  });
}

// ─── Verificaciones pendientes ──────────────────────────────────────────────
async function cargarVerificaciones() {
  verificacionesActuales = await api.admin.getVerificacionesPendientes();
  await renderizarVerificaciones();
}

function filtrarVerificaciones() {
  return verificacionesActuales.filter(v => {
    const coincideTipo = !tipoFiltroVerificacion || v.tipo === tipoFiltroVerificacion;

    const nombre = `${v.nombre_solicitante ?? ''} ${v.nombre_estudio ?? ''}`.toLowerCase();
    const coincideBusqueda = !busquedaVerificaciones || nombre.includes(busquedaVerificaciones);

    return coincideTipo && coincideBusqueda;
  });
}

async function renderizarVerificaciones() {
  const contenedor = document.getElementById('verificacionesLista');
  const vacio = document.getElementById('estadoSinVerificaciones');
  const vacioTitulo = vacio.querySelector('.estado-vacio__titulo');
  const vacioTexto = vacio.querySelector('p:not(.estado-vacio__titulo)');
  const lista = filtrarVerificaciones();

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    const hayFiltroActivo = Boolean(busquedaVerificaciones || tipoFiltroVerificacion);
    vacioTitulo.textContent = hayFiltroActivo ? 'Sin resultados' : 'Sin verificaciones pendientes';
    vacioTexto.textContent = hayFiltroActivo
      ? 'No hay verificaciones que coincidan con la búsqueda.'
      : 'No hay solicitudes de verificación esperando revisión.';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  const tarjetas = await Promise.all(lista.map(generarVerificacionCard));
  contenedor.innerHTML = tarjetas.join('');
}

async function generarVerificacionCard(v) {
  const idSeguro = escaparAtrib(v.id);
  const etiquetaTipo = ETIQUETAS_TIPO_SOLICITANTE[v.tipo] ?? v.tipo;

  const nombreMostrado = v.tipo === 'estudio'
    ? `${escaparHtml(v.nombre_estudio)} <span class="verificacion-item__detalle-etiqueta">(representante: ${escaparHtml(v.nombre_solicitante)})</span>`
    : escaparHtml(v.nombre_solicitante);

  const documentosHtml = await generarEnlacesDocumentos(v);
  const rechazoAbierto = verificacionConRechazoAbierto === v.id;

  return `
    <article class="verificacion-item">
      <div class="verificacion-item__header">
        <div>
          <span class="badge badge--${v.tipo === 'estudio' ? 'estudio' : 'individual'}">${etiquetaTipo}</span>
          <p class="verificacion-item__nombre">${nombreMostrado}</p>
          <p class="verificacion-item__fecha">Solicitado el ${formatearFecha(v.created_at)}</p>
        </div>
      </div>
      ${documentosHtml}
      <div class="verificacion-item__acciones">
        <button class="btn btn--primario btn--sm" type="button" data-accion="aprobar" data-id="${idSeguro}">
          Aprobar
        </button>
        <button class="btn btn--secundario btn--sm" type="button" data-accion="mostrar-rechazo" data-id="${idSeguro}">
          Rechazar
        </button>
      </div>
      <div class="verificacion-item__rechazo" id="rechazo-${idSeguro}" ${rechazoAbierto ? '' : 'hidden'}>
        <div class="campo">
          <label for="motivo-${idSeguro}" class="campo__etiqueta">Motivo del rechazo</label>
          <textarea id="motivo-${idSeguro}" class="campo__input" rows="2" maxlength="300"
            placeholder="Explique por qué se rechaza esta verificación..."></textarea>
        </div>
        <div class="verificacion-item__acciones">
          <button class="btn btn--secundario btn--sm" type="button" data-accion="confirmar-rechazo" data-id="${idSeguro}">
            Confirmar rechazo
          </button>
          <button class="btn btn--secundario btn--sm" type="button" data-accion="cancelar-rechazo" data-id="${idSeguro}">
            Cancelar
          </button>
        </div>
      </div>
    </article>
  `;
}

async function generarEnlacesDocumentos(v) {
  const DOCUMENTOS = [
    { path: v.doc_carnet_url,       etiqueta: 'Carné de abogado' },
    { path: v.doc_cedula_url,       etiqueta: 'Cédula de identidad' },
    { path: v.doc_ruc_url,          etiqueta: 'RUC' },
    { path: v.doc_nombramiento_url, etiqueta: 'Nombramiento del representante legal' },
  ].filter(doc => doc.path);

  if (DOCUMENTOS.length === 0) return '';

  // verificacion-docs es un bucket privado (documentos de identidad) — se accede
  // con URLs firmadas de corta duración, no con getPublicUrl (ver frontend/js/api.js).
  const enlacesHtml = await Promise.all(DOCUMENTOS.map(async doc => {
    const url = await api.storage.getUrlFirmada('verificacion-docs', doc.path);
    if (!url) return '';
    return `<a class="enlace-documento" href="${escaparAtrib(url)}" target="_blank" rel="noopener noreferrer">${escaparHtml(doc.etiqueta)}</a>`;
  }));

  return `<div class="verificacion-item__documentos">${enlacesHtml.join('')}</div>`;
}

function manejarClickVerificaciones(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;

  const { accion, id } = btn.dataset;

  if (accion === 'aprobar') manejarAprobarVerificacion(id);
  if (accion === 'mostrar-rechazo') {
    verificacionConRechazoAbierto = id;
    renderizarVerificaciones();
  }
  if (accion === 'cancelar-rechazo') {
    verificacionConRechazoAbierto = null;
    renderizarVerificaciones();
  }
  if (accion === 'confirmar-rechazo') {
    const motivo = document.getElementById(`motivo-${id}`).value;
    manejarRechazarVerificacion(id, motivo);
  }
}

async function manejarAprobarVerificacion(id) {
  const errorEl = document.getElementById('errorVerificaciones');
  errorEl.textContent = '';

  const { error } = await api.admin.aprobarVerificacion(id);
  if (error) {
    errorEl.textContent = error.message ?? 'No se pudo aprobar la verificación. Intente de nuevo.';
    return;
  }

  await eliminarVerificacionLocal(id);
}

async function manejarRechazarVerificacion(id, motivo) {
  const errorEl = document.getElementById('errorVerificaciones');
  errorEl.textContent = '';

  if (!motivo.trim()) {
    document.getElementById(`motivo-${id}`).focus();
    errorEl.textContent = 'Indique el motivo del rechazo.';
    return;
  }

  const { error } = await api.admin.rechazarVerificacion(id, motivo);
  if (error) {
    errorEl.textContent = error.message ?? 'No se pudo rechazar la verificación. Intente de nuevo.';
    return;
  }

  verificacionConRechazoAbierto = null;
  await eliminarVerificacionLocal(id);
}

async function eliminarVerificacionLocal(id) {
  verificacionesActuales = verificacionesActuales.filter(v => v.id !== id);
  await renderizarVerificaciones();
}

// ─── Suscripciones ──────────────────────────────────────────────────────────
async function cargarSuscripciones() {
  const errorEl = document.getElementById('errorSuscripciones');
  const contenedor = document.getElementById('suscripcionesLista');
  const vacio = document.getElementById('estadoSinSuscripciones');

  const suscripciones = await api.admin.getSuscripciones();

  if (suscripciones.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  errorEl.textContent = '';
  contenedor.innerHTML = suscripciones.map(generarSuscripcionCard).join('');
}

function generarSuscripcionCard(s) {
  const estadoVisual = ETIQUETAS_ESTADO_SUSCRIPCION[s.estado] ?? ETIQUETAS_ESTADO_SUSCRIPCION.VENCIDA;
  const etiquetaPlan = ETIQUETAS_TIPO_SUSCRIPCION[s.tipo] ?? s.tipo;

  return `
    <article class="suscripcion-item">
      <div class="suscripcion-item__header">
        <p class="suscripcion-item__nombre">${escaparHtml(s.nombre)}</p>
        <span class="badge ${estadoVisual.clase}">${estadoVisual.texto}</span>
      </div>
      <p class="suscripcion-item__detalle">${escaparHtml(etiquetaPlan)}</p>
      <p class="suscripcion-item__detalle">Vence el ${formatearFecha(s.fecha_vencimiento)}</p>
      <p class="suscripcion-item__detalle">Monto: $${escaparHtml(String(s.monto))}</p>
    </article>
  `;
}

// ─── Métricas ───────────────────────────────────────────────────────────────
async function cargarMetricas() {
  const errorEl = document.getElementById('errorMetricas');
  const contenedor = document.getElementById('metricasGrid');

  const metricas = await api.admin.getMetricas();

  if (!metricas) {
    errorEl.textContent = 'No se pudieron cargar las métricas.';
    contenedor.innerHTML = '';
    return;
  }

  errorEl.textContent = '';
  contenedor.innerHTML = Object.entries(ETIQUETAS_METRICAS).map(([clave, etiqueta]) => {
    const valor = clave === 'tasa_aceptacion'
      ? `${escaparHtml(String(metricas[clave] ?? 0))}%`
      : escaparHtml(String(metricas[clave] ?? 0));

    return `
      <div class="metrica-tarjeta">
        <p class="metrica-tarjeta__valor">${valor}</p>
        <p class="metrica-tarjeta__etiqueta">${escaparHtml(etiqueta)}</p>
      </div>
    `;
  }).join('');
}

// ─── Log de acciones ────────────────────────────────────────────────────────
async function cargarLogAcciones() {
  const errorEl = document.getElementById('errorLogAcciones');
  const contenedor = document.getElementById('logAccionesLista');
  const vacio = document.getElementById('estadoSinLogAcciones');

  const registros = await api.admin.getLogAcciones();

  if (registros.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  errorEl.textContent = '';
  contenedor.innerHTML = registros.map(generarLogItem).join('');
}

function generarLogItem(l) {
  const etiquetaAccion = ETIQUETAS_ACCION_LOG[l.accion] ?? { texto: l.accion, clase: 'badge--pendiente' };
  const etiquetaTipo = ETIQUETAS_TIPO_SOLICITANTE[l.tipo] ?? l.tipo;

  return `
    <article class="log-item">
      <div class="log-item__header">
        <p class="log-item__nombre">${escaparHtml(l.nombre_afectado)}</p>
        <span class="badge ${etiquetaAccion.clase}">${etiquetaAccion.texto}</span>
      </div>
      <p class="log-item__detalle">${escaparHtml(etiquetaTipo)}</p>
      <p class="log-item__detalle">Por ${escaparHtml(l.admin_nombre)} — ${formatearFechaHora(l.created_at)}</p>
    </article>
  `;
}

// ─── Helpers de presentación ────────────────────────────────────────────────
function formatearFecha(fechaIso) {
  if (!fechaIso) return '';
  return new Date(fechaIso).toLocaleDateString('es-EC', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatearFechaHora(fechaIso) {
  if (!fechaIso) return '';
  return new Date(fechaIso).toLocaleString('es-EC', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Seguridad: escapado de HTML ────────────────────────────────────────────
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
