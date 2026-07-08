// panel-cliente.js
// Lógica de la página panel-cliente.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';

// ─── Etiquetas y estilos por estado ───────────────────────────────────────────
const ETIQUETAS_ESTADO_SOLICITUD = {
  PENDIENTE:  'Pendiente',
  ACEPTADA:   'Aceptada',
  COMPLETADA: 'Completada',
  'RESEÑADA': 'Reseñada',
  RECHAZADA:  'Rechazada',
  EXPIRADA:   'Expirada',
  CANCELADA:  'Cancelada',
};

const CLASE_ESTADO_SOLICITUD = {
  PENDIENTE:  'badge--estado-pendiente',
  ACEPTADA:   'badge--estado-aceptada',
  COMPLETADA: 'badge--estado-completada',
  'RESEÑADA': 'badge--estado-resenada',
  RECHAZADA:  'badge--estado-rechazada',
  EXPIRADA:   'badge--estado-expirada',
  CANCELADA:  'badge--estado-cancelada',
};

const SECCIONES = ['Solicitudes', 'Resenas'];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;         // fila propia de la tabla perfiles
let solicitudesActuales = [];    // caché local; las acciones actualizan sin refetch
let estadoFiltroActivo = '';     // '' = todas
let solicitudConFormularioAbierto = null; // id de la solicitud con el form de reseña visible

// ─── Entry point ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  // 1. Inicializar Supabase con la configuración de /api/config
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[panel-cliente] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  // 2. Verificar autenticación — redirigir si no hay sesión
  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  // 3. Verificar rol — este panel es solo para clientes
  perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || perfilActual.rol !== 'cliente') {
    window.location.href = '/';
    return;
  }

  document.getElementById('nombreUsuario').textContent = perfilActual.nombre_completo;
  renderizarCabecera();

  const [resenas] = await Promise.all([
    api.resenas.getMisResenas(),
    cargarSolicitudes(),
  ]);
  renderizarResenas(resenas);

  mostrarContenido();
  configurarEventos();
}

// ─── Control de estados visuales ─────────────────────────────────────────────
function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarContenido() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoPanel').hidden = false;
}

// ─── Configuración de eventos ─────────────────────────────────────────────────
function configurarEventos() {
  document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
    await api.auth.cerrarSesion();
    window.location.href = '/';
  });

  SECCIONES.forEach(nombre => {
    document.getElementById(`tab${nombre}`).addEventListener('click', () => cambiarTab(nombre));
  });

  document.querySelectorAll('#seccionSolicitudes .filtro-tipo__btn').forEach(btn => {
    btn.addEventListener('click', () => cambiarFiltroSolicitudes(btn.dataset.estado));
  });

  document.getElementById('solicitudesLista').addEventListener('click', manejarClickSolicitudes);
  document.getElementById('solicitudesLista').addEventListener('submit', manejarSubmitResena);
}

// ─── Navegación por secciones ─────────────────────────────────────────────────
function cambiarTab(seccion) {
  SECCIONES.forEach(nombre => {
    const esActiva = nombre === seccion;
    document.getElementById(`tab${nombre}`).classList.toggle('panel-tab--activo', esActiva);
    document.getElementById(`tab${nombre}`).setAttribute('aria-selected', String(esActiva));
    document.getElementById(`seccion${nombre}`).hidden = !esActiva;
  });
}

// ─── Cabecera: identidad ──────────────────────────────────────────────────────
function renderizarCabecera() {
  const avatarHtml = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);
  document.getElementById('cabeceraAvatar').innerHTML = avatarHtml;
  document.getElementById('cabeceraNombre').textContent = perfilActual.nombre_completo;
}

// ─── Solicitudes ──────────────────────────────────────────────────────────────
async function cargarSolicitudes() {
  solicitudesActuales = await api.solicitudes.getSolicitudesCliente();
  renderizarSolicitudes();
}

function cambiarFiltroSolicitudes(estado) {
  estadoFiltroActivo = estado;
  document.querySelectorAll('#seccionSolicitudes .filtro-tipo__btn').forEach(btn => {
    btn.classList.toggle('filtro-tipo__btn--activo', btn.dataset.estado === estado);
  });
  renderizarSolicitudes();
}

function renderizarSolicitudes() {
  const lista = solicitudesActuales.filter(s => !estadoFiltroActivo || s.estado === estadoFiltroActivo);
  const contenedor = document.getElementById('solicitudesLista');
  const vacio = document.getElementById('estadoSinSolicitudes');

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarSolicitudCard).join('');
}

function generarSolicitudCard(s) {
  const avatarHtml = generarAvatarHtml(s.abogado_foto, s.abogado_nombre);
  const claseEstado = CLASE_ESTADO_SOLICITUD[s.estado] ?? 'badge--estado-expirada';
  const etiquetaEstado = ETIQUETAS_ESTADO_SOLICITUD[s.estado] ?? s.estado;
  const idSeguro = escaparAtrib(s.id);

  const detalleHtml = [
    s.descripcion_caso
      ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Caso:</span> ${escaparHtml(s.descripcion_caso)}</p>`
      : '',
    s.disponibilidad_horaria
      ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Disponibilidad:</span> ${escaparHtml(s.disponibilidad_horaria)}</p>`
      : '',
  ].join('');

  const motivoRechazoHtml = (s.estado === 'RECHAZADA' && s.motivo_rechazo)
    ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Motivo:</span> ${escaparHtml(s.motivo_rechazo)}</p>`
    : '';

  const puedeCompletar = s.estado === 'ACEPTADA';
  const puedeReseñar = s.estado === 'COMPLETADA' && !s.tiene_resena;
  const puedeCancelar = s.estado === 'PENDIENTE';
  const formularioAbierto = solicitudConFormularioAbierto === s.id;

  const completarHtml = puedeCompletar ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--primario btn--sm" type="button" data-accion="marcar-completada" data-id="${idSeguro}">
        Marcar consulta como completada
      </button>
    </div>
  ` : '';

  const cancelarHtml = puedeCancelar ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--secundario btn--sm" type="button" data-accion="cancelar-solicitud" data-id="${idSeguro}">
        Cancelar solicitud
      </button>
    </div>
  ` : '';

  const buscarOtroHtml = (s.estado === 'RECHAZADA' || s.estado === 'EXPIRADA') ? `
    <div class="solicitud-item__acciones">
      <a href="/pages/busqueda" class="btn btn--secundario btn--sm">Buscar otro abogado</a>
    </div>
  ` : '';

  const accionesHtml = puedeReseñar ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--primario btn--sm" type="button" data-accion="mostrar-resena" data-id="${idSeguro}">
        Dejar reseña
      </button>
    </div>
    <form class="formulario-resena" id="formResena-${idSeguro}" data-id="${idSeguro}" ${formularioAbierto ? '' : 'hidden'}>
      <div class="campo">
        <span class="campo__etiqueta">Calificación</span>
        <div class="rating-input" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">
          ${generarEstrellasInput(idSeguro)}
        </div>
      </div>
      <div class="campo">
        <label for="comentario-${idSeguro}" class="campo__etiqueta">Comentario (opcional)</label>
        <textarea id="comentario-${idSeguro}" class="campo__input" rows="3" maxlength="500"
          placeholder="Cuente su experiencia con este abogado..."></textarea>
      </div>
      <p class="campo__error" id="errorResena-${idSeguro}" role="alert" aria-live="polite"></p>
      <div class="solicitud-item__acciones">
        <button type="submit" class="btn btn--primario btn--sm">Enviar reseña</button>
        <button type="button" class="btn btn--secundario btn--sm" data-accion="cancelar-resena" data-id="${idSeguro}">
          Cancelar
        </button>
      </div>
    </form>
  ` : '';

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div class="solicitud-item__cliente">
          <div class="solicitud-item__avatar">${avatarHtml}</div>
          <div>
            <p class="solicitud-item__nombre">${escaparHtml(s.abogado_nombre)}</p>
            <p class="solicitud-item__fecha">${formatearFecha(s.created_at)}</p>
          </div>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      ${detalleHtml}
      ${motivoRechazoHtml}
      ${completarHtml}
      ${cancelarHtml}
      ${buscarOtroHtml}
      ${accionesHtml}
    </article>
  `;
}

// Orden 5→1 en el DOM: junto con flex-direction: row-reverse en CSS, esto
// permite resaltar con :checked ~ label / :hover ~ label todas las estrellas
// hasta la seleccionada, sin JavaScript adicional.
function generarEstrellasInput(idSeguro) {
  let html = '';
  for (let valor = 5; valor >= 1; valor--) {
    const inputId = `cal-${idSeguro}-${valor}`;
    html += `
      <input type="radio" id="${inputId}" name="calificacion-${idSeguro}" value="${valor}" class="rating-input__radio">
      <label for="${inputId}" class="rating-input__estrella">
        <span aria-hidden="true">&#9733;</span>
        <span class="sr-only">${valor} ${valor === 1 ? 'estrella' : 'estrellas'}</span>
      </label>
    `;
  }
  return html;
}

function manejarClickSolicitudes(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;

  const { accion, id } = btn.dataset;

  if (accion === 'marcar-completada') manejarMarcarCompletada(id);
  if (accion === 'cancelar-solicitud') manejarCancelarSolicitud(id);
  if (accion === 'mostrar-resena') {
    solicitudConFormularioAbierto = id;
    renderizarSolicitudes();
  }
  if (accion === 'cancelar-resena') {
    solicitudConFormularioAbierto = null;
    renderizarSolicitudes();
  }
}

async function manejarMarcarCompletada(id) {
  const errorEl = document.getElementById('errorSolicitudes');
  errorEl.textContent = '';

  const { data, error } = await api.solicitudes.completarSolicitud(id);
  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo marcar la consulta como completada. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    return;
  }

  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, data);
  renderizarSolicitudes();
  toast.exito('Consulta marcada como completada.');
}

async function manejarCancelarSolicitud(id) {
  const confirmado = window.confirm('¿Cancelar esta solicitud? Esta acción no se puede deshacer.');
  if (!confirmado) return;

  const errorEl = document.getElementById('errorSolicitudes');
  errorEl.textContent = '';

  const { data, error } = await api.solicitudes.cancelar(id);
  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo cancelar la solicitud. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    return;
  }

  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, data);
  renderizarSolicitudes();
  toast.exito('Solicitud cancelada.');
}

async function manejarSubmitResena(e) {
  const form = e.target.closest('.formulario-resena');
  if (!form) return;
  e.preventDefault();

  const id = form.dataset.id;
  const errorEl = document.getElementById(`errorResena-${id}`);
  const btnEnviar = form.querySelector('button[type="submit"]');
  errorEl.textContent = '';

  const calificacionSeleccionada = form.querySelector(`input[name="calificacion-${id}"]:checked`);
  if (!calificacionSeleccionada) {
    errorEl.textContent = 'Seleccione una calificación de 1 a 5 estrellas.';
    return;
  }

  const calificacion = Number(calificacionSeleccionada.value);
  const comentario = document.getElementById(`comentario-${id}`).value.trim();

  btnEnviar.disabled = true;
  btnEnviar.textContent = 'Enviando...';

  const { data, error } = await api.resenas.crearResena(id, { calificacion, comentario });

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo enviar la reseña. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    btnEnviar.disabled = false;
    btnEnviar.textContent = 'Enviar reseña';
    return;
  }

  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) {
    entrada.tiene_resena = true;
    entrada.estado = 'RESEÑADA';
  }
  solicitudConFormularioAbierto = null;
  renderizarSolicitudes();
  toast.exito('Reseña enviada.');

  const resenas = await api.resenas.getMisResenas();
  renderizarResenas(resenas);
}

// ─── Reseñas ──────────────────────────────────────────────────────────────────
function renderizarResenas(lista) {
  const contenedor = document.getElementById('resenasLista');
  const vacio = document.getElementById('estadoSinResenas');

  if (!lista || lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarResenaItem).join('');
}

function generarResenaItem(r) {
  const avatarHtml = generarAvatarHtml(r.abogado_foto, r.abogado_nombre);

  const respuestaHtml = r.respuesta_abogado
    ? `
      <div class="resena-item__respuesta">
        <p class="resena-item__respuesta-titulo">Respuesta del abogado</p>
        <p>${escaparHtml(r.respuesta_abogado)}</p>
      </div>
    `
    : '';

  return `
    <article class="resena-item">
      <div class="resena-item__header">
        <div class="resena-item__avatar" aria-hidden="true">${avatarHtml}</div>
        <div class="resena-item__meta">
          <p class="solicitud-item__nombre">${escaparHtml(r.abogado_nombre)}</p>
          <div class="rating">
            ${generarEstrellas(r.calificacion, 1)}
          </div>
          <p class="resena-item__fecha">${formatearFecha(r.created_at)}</p>
        </div>
      </div>
      ${r.comentario ? `<p class="resena-item__comentario">${escaparHtml(r.comentario)}</p>` : ''}
      ${respuestaHtml}
    </article>
  `;
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
function generarAvatarHtml(fotoPath, nombre) {
  const fotoUrl = fotoPath ? api.storage.getPublicUrl('avatares', fotoPath) : null;
  return fotoUrl
    ? `<img src="${escaparAtrib(fotoUrl)}" alt="Foto de ${escaparAtrib(nombre)}">`
    : `<div class="avatar-placeholder" aria-hidden="true">${escaparHtml(obtenerIniciales(nombre))}</div>`;
}

function generarEstrellas(rating, total) {
  if (!total || total === 0) {
    return `
      <span class="rating__estrellas rating__estrellas--vacio" aria-label="Sin reseñas">
        &#9733;&#9733;&#9733;&#9733;&#9733;
      </span>
    `;
  }

  const redondeado = Math.min(5, Math.max(0, Math.round(rating)));
  const llenas = '&#9733;'.repeat(redondeado);
  const vacias = '&#9734;'.repeat(5 - redondeado);

  return `
    <span class="rating__estrellas" aria-label="${rating} de 5 estrellas">
      ${llenas}${vacias}
    </span>
  `;
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

// ─── Seguridad: escapado de HTML ──────────────────────────────────────────────
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
