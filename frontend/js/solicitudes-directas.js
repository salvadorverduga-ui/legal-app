// solicitudes-directas.js
// Lógica de la página solicitudes-directas.html: listado con filtros de estado
// de las solicitudes normales (no originadas en El Tablón — ver caso_tablon_id,
// migración 20260714_049), para cliente o abogado según el rol autenticado.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, rutaPanelPropio, confirmar, generarCheckboxSeguimiento, MENSAJE_AGREGADO_SEGUIMIENTO } from './utils.js';
import { inicializarHeader } from './header.js';

const ORIGEN = 'directa';

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

const OPCIONES_DISPONIBILIDAD = ['Mañana', 'Tarde', 'Indiferente'];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;
let rolActual = null;                 // 'cliente' | 'abogado'
let solicitudesActuales = [];         // caché local; las acciones actualizan sin refetch
let estadoFiltroActivo = '';          // '' = todas
let solicitudConFormularioAbierto = null; // cliente: id con el form de reseña visible
let solicitudConEdicionAbierta = null;    // cliente: id con el form de edición visible

// ─── Entry point ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[solicitudes-directas] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || (perfilActual.rol !== 'cliente' && perfilActual.rol !== 'abogado')) {
    window.location.href = '/';
    return;
  }
  rolActual = perfilActual.rol;

  document.getElementById('btnVolverSolicitudes').href = `${rutaPanelPropio(rolActual)}?tab=solicitudes`;
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

  document.getElementById('subtituloSolicitudes').textContent = rolActual === 'abogado'
    ? 'Consultas que los clientes le enviaron directamente.'
    : 'Consultas que envió directamente a un abogado.';
  document.getElementById('textoSinSolicitudes').textContent = rolActual === 'abogado'
    ? 'Cuando un cliente le envíe una consulta directa, aparecerá aquí.'
    : 'Busque un abogado desde El Tablón o la búsqueda para enviar su primera consulta directa.';

  await cargarSolicitudes();

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
  document.querySelectorAll('.filtro-tipo__btn').forEach(btn => {
    btn.addEventListener('click', () => cambiarFiltroSolicitudes(btn.dataset.estado));
  });

  const contenedor = document.getElementById('solicitudesLista');
  contenedor.addEventListener('click', manejarClickSolicitudes);
  contenedor.addEventListener('submit', manejarSubmitResena);
  contenedor.addEventListener('submit', manejarSubmitEditar);
  contenedor.addEventListener('input', manejarInputSolicitudes);
}

// ─── Solicitudes ──────────────────────────────────────────────────────────────
async function cargarSolicitudes() {
  solicitudesActuales = rolActual === 'abogado'
    ? await api.solicitudes.getSolicitudesAbogado(ORIGEN)
    : await api.solicitudes.getSolicitudesCliente(ORIGEN);

  renderizarSolicitudes();
}

function cambiarFiltroSolicitudes(estado) {
  estadoFiltroActivo = estado;
  document.querySelectorAll('.filtro-tipo__btn').forEach(btn => {
    btn.classList.toggle('filtro-tipo__btn--activo', btn.dataset.estado === estado);
  });
  renderizarSolicitudes();
}

function renderizarSolicitudes() {
  const lista = solicitudesActuales.filter(s => !estadoFiltroActivo || s.estado === estadoFiltroActivo);
  const contenedor = document.getElementById('solicitudesLista');
  const vacio = document.getElementById('estadoSinSolicitudes');
  const textoVacio = document.getElementById('textoSinSolicitudes');

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    textoVacio.textContent = solicitudesActuales.length === 0
      ? textoVacio.textContent
      : 'No hay solicitudes en este estado.';
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarSolicitudCard).join('');
}

function generarSolicitudCard(s) {
  return rolActual === 'abogado' ? generarSolicitudCardAbogado(s) : generarSolicitudCardCliente(s);
}

// ─── Tarjeta: vista abogado ────────────────────────────────────────────────────
function generarSolicitudCardAbogado(s) {
  const avatarHtml = generarAvatarHtml(s.cliente_foto, s.cliente_nombre);
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

  const telefonoHtml = s.cliente_telefono
    ? `Teléfono: <strong>${escaparHtml(s.cliente_telefono)}</strong>`
    : 'El cliente no registró teléfono — puede contactarlo por email.';

  const contactoHtml = s.estado === 'ACEPTADA'
    ? `
      <div class="solicitud-item__contacto">
        Contacto revelado — correo: <strong>${escaparHtml(s.cliente_email ?? 'No registrado')}</strong>.
        ${telefonoHtml}
      </div>
    `
    : '';

  const accionesHtml = s.estado === 'PENDIENTE' ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--primario btn--sm" type="button" data-accion="aceptar" data-id="${idSeguro}">
        Aceptar
      </button>
      <button class="btn btn--secundario btn--sm" type="button" data-accion="mostrar-rechazo" data-id="${idSeguro}">
        Rechazar
      </button>
    </div>
    <div class="solicitud-item__rechazo" id="rechazo-${idSeguro}" hidden>
      <div class="campo">
        <label for="motivo-${idSeguro}" class="campo__etiqueta">Motivo del rechazo (opcional)</label>
        <textarea id="motivo-${idSeguro}" class="campo__input solicitud-item__motivo" rows="2" maxlength="300"></textarea>
      </div>
      <div class="solicitud-item__acciones">
        <button class="btn btn--secundario btn--sm" type="button" data-accion="confirmar-rechazo" data-id="${idSeguro}">
          Confirmar rechazo
        </button>
        <button class="btn btn--secundario btn--sm" type="button" data-accion="cancelar-rechazo" data-id="${idSeguro}">
          Cancelar
        </button>
      </div>
    </div>
  ` : '';

  const seguimientoHtml = generarCheckboxSeguimiento(idSeguro, s.en_seguimiento_abogado);

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div class="solicitud-item__cliente">
          <div class="solicitud-item__avatar">${avatarHtml}</div>
          <div>
            <p class="solicitud-item__nombre">${escaparHtml(s.cliente_nombre)}</p>
            <p class="solicitud-item__fecha">${formatearFechaHora(s.created_at)}</p>
          </div>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      ${detalleHtml}
      ${motivoRechazoHtml}
      ${contactoHtml}
      ${accionesHtml}
      ${seguimientoHtml}
    </article>
  `;
}

// ─── Tarjeta: vista cliente ─────────────────────────────────────────────────────
function generarSolicitudCardCliente(s) {
  const avatarHtml = generarAvatarHtml(s.abogado_foto, s.abogado_nombre);
  const claseEstado = CLASE_ESTADO_SOLICITUD[s.estado] ?? 'badge--estado-expirada';
  const etiquetaEstado = ETIQUETAS_ESTADO_SOLICITUD[s.estado] ?? s.estado;
  const idSeguro = escaparAtrib(s.id);
  const abogadoIdSeguro = escaparAtrib(s.abogado_id);

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
  const sinResenaAun = s.estado === 'COMPLETADA' && !s.tiene_resena;
  const puedeReseñar = sinResenaAun && haPasadoTiempoMinimoResena(s.completada_at);
  const esperaResenaHtml = (sinResenaAun && !puedeReseñar)
    ? '<p class="campo__ayuda">Podrá dejar su reseña 24 horas después de completada la consulta.</p>'
    : '';
  const puedeCancelar = s.estado === 'PENDIENTE';
  const formularioAbierto = solicitudConFormularioAbierto === s.id;
  const edicionAbierta = solicitudConEdicionAbierta === s.id;

  const completarHtml = puedeCompletar ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--primario btn--sm" type="button" data-accion="marcar-completada" data-id="${idSeguro}">
        Marcar consulta como completada
      </button>
    </div>
  ` : '';

  const cancelarHtml = puedeCancelar ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--secundario btn--sm" type="button" data-accion="mostrar-editar" data-id="${idSeguro}">
        Editar solicitud
      </button>
      <button class="btn btn--secundario btn--sm" type="button" data-accion="cancelar-solicitud" data-id="${idSeguro}">
        Cancelar solicitud
      </button>
    </div>
    <form class="formulario-edicion" id="formEditar-${idSeguro}" data-id="${idSeguro}" ${edicionAbierta ? '' : 'hidden'}>
      <div class="campo">
        <label for="descripcion-editar-${idSeguro}" class="campo__etiqueta">Descripción del caso (opcional)</label>
        <textarea id="descripcion-editar-${idSeguro}" class="campo__input" rows="4" maxlength="500"
          placeholder="Describa brevemente su situación...">${escaparHtml(s.descripcion_caso ?? '')}</textarea>
        <p class="campo__contador" id="contadorEditar-${idSeguro}">${(s.descripcion_caso ?? '').length} / 500</p>
      </div>
      <div class="campo">
        <span class="campo__etiqueta">¿Cuándo prefiere ser contactado?</span>
        <div class="radio-pills" role="radiogroup" aria-label="¿Cuándo prefiere ser contactado?">
          ${generarOpcionesDisponibilidad(idSeguro, s.disponibilidad_horaria)}
        </div>
      </div>
      <p class="campo__error" id="errorEditar-${idSeguro}" role="alert" aria-live="polite"></p>
      <div class="solicitud-item__acciones">
        <button type="submit" class="btn btn--primario btn--sm">Guardar cambios</button>
        <button type="button" class="btn btn--secundario btn--sm" data-accion="cancelar-editar" data-id="${idSeguro}">
          Cancelar
        </button>
      </div>
    </form>
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

  const tiempoRestanteHtml = s.estado === 'PENDIENTE'
    ? `<p class="solicitud-item__tiempo-restante${esTiempoRestanteUrgente(s.expires_at) ? ' solicitud-item__tiempo-restante--urgente' : ''}">${formatearTiempoRestante(s.expires_at)}</p>`
    : '';

  const seguimientoHtml = generarCheckboxSeguimiento(idSeguro, s.en_seguimiento_cliente);

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div class="solicitud-item__cliente">
          <div class="solicitud-item__avatar">${avatarHtml}</div>
          <div>
            <p class="solicitud-item__nombre"><a href="/pages/perfil-abogado?id=${abogadoIdSeguro}">${escaparHtml(s.abogado_nombre)}</a></p>
            <p class="solicitud-item__fecha">Enviada ${formatearTiempoTranscurrido(s.created_at)} · ${formatearFechaHora(s.created_at)}</p>
            ${tiempoRestanteHtml}
          </div>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      ${detalleHtml}
      ${motivoRechazoHtml}
      ${completarHtml}
      ${cancelarHtml}
      ${buscarOtroHtml}
      ${esperaResenaHtml}
      ${accionesHtml}
      ${seguimientoHtml}
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

function generarOpcionesDisponibilidad(idSeguro, seleccionActual) {
  return OPCIONES_DISPONIBILIDAD.map(opcion => {
    const marcada = (seleccionActual || 'Indiferente') === opcion;
    return `
      <label class="radio-pills__opcion">
        <input type="radio" name="disponibilidad-editar-${idSeguro}" value="${opcion}" ${marcada ? 'checked' : ''}>
        <span>${opcion}</span>
      </label>
    `;
  }).join('');
}

// ─── Clicks e inputs ────────────────────────────────────────────────────────────
function manejarClickSolicitudes(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;

  const { accion, id } = btn.dataset;

  if (accion === 'toggle-seguimiento') return manejarToggleSeguimiento(id);

  if (rolActual === 'abogado') {
    if (accion === 'aceptar') manejarAceptarSolicitud(id);
    if (accion === 'mostrar-rechazo') document.getElementById(`rechazo-${id}`).hidden = false;
    if (accion === 'cancelar-rechazo') document.getElementById(`rechazo-${id}`).hidden = true;
    if (accion === 'confirmar-rechazo') {
      const motivo = document.getElementById(`motivo-${id}`).value;
      manejarRechazarSolicitud(id, motivo);
    }
    return;
  }

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
  if (accion === 'mostrar-editar') {
    solicitudConEdicionAbierta = id;
    renderizarSolicitudes();
  }
  if (accion === 'cancelar-editar') {
    solicitudConEdicionAbierta = null;
    renderizarSolicitudes();
  }
}

function manejarInputSolicitudes(e) {
  const textarea = e.target.closest('.formulario-edicion textarea');
  if (!textarea) return;

  const form = textarea.closest('.formulario-edicion');
  const contador = document.getElementById(`contadorEditar-${form.dataset.id}`);
  if (contador) contador.textContent = `${textarea.value.length} / 500`;
}

function actualizarSolicitudLocal(id, datosActualizados) {
  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, datosActualizados);
}

async function manejarToggleSeguimiento(id) {
  const { data, error } = await api.seguimiento.toggleSolicitud(id, rolActual);

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar el seguimiento. Intente de nuevo.'));
    return;
  }

  actualizarSolicitudLocal(id, data);
  renderizarSolicitudes();
  toast.info(
    (rolActual === 'abogado' ? data.en_seguimiento_abogado : data.en_seguimiento_cliente)
      ? MENSAJE_AGREGADO_SEGUIMIENTO
      : 'Quitado de seguimiento.'
  );
}

// ─── Acciones: abogado ───────────────────────────────────────────────────────
async function manejarAceptarSolicitud(id) {
  const errorEl = document.getElementById('errorSolicitudes');
  errorEl.textContent = '';

  const { data, error } = await api.solicitudes.aceptarSolicitud(id);
  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo aceptar la solicitud. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    return;
  }

  actualizarSolicitudLocal(id, data);
  renderizarSolicitudes();
  toast.exito('Solicitud aceptada.');
}

async function manejarRechazarSolicitud(id, motivo) {
  const errorEl = document.getElementById('errorSolicitudes');
  errorEl.textContent = '';

  const { data, error } = await api.solicitudes.rechazarSolicitud(id, motivo);
  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo rechazar la solicitud. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    return;
  }

  actualizarSolicitudLocal(id, data);
  renderizarSolicitudes();
  toast.info('Solicitud rechazada.');
}

// ─── Acciones: cliente ────────────────────────────────────────────────────────
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

  actualizarSolicitudLocal(id, data);
  renderizarSolicitudes();
  toast.exito('Consulta marcada como completada.');
}

async function manejarCancelarSolicitud(id) {
  const confirmado = await confirmar('¿Cancelar esta solicitud? Esta acción no se puede deshacer.');
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

  actualizarSolicitudLocal(id, data);
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

  const { error } = await api.resenas.crearResena(id, { calificacion, comentario });

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
}

async function manejarSubmitEditar(e) {
  const form = e.target.closest('.formulario-edicion');
  if (!form) return;
  e.preventDefault();

  const id = form.dataset.id;
  const errorEl = document.getElementById(`errorEditar-${id}`);
  const btnGuardar = form.querySelector('button[type="submit"]');
  errorEl.textContent = '';

  const descripcion_caso = document.getElementById(`descripcion-editar-${id}`).value.trim();
  const disponibilidad_horaria = form.querySelector(`input[name="disponibilidad-editar-${id}"]:checked`)?.value ?? '';

  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Guardando...';

  const { data, error } = await api.solicitudes.editar(id, { descripcion_caso, disponibilidad_horaria });

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo guardar la solicitud. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Guardar cambios';
    return;
  }

  actualizarSolicitudLocal(id, data);
  solicitudConEdicionAbierta = null;
  renderizarSolicitudes();
  toast.exito('Solicitud actualizada.');
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
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

function formatearFechaHora(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  return `${formatearFecha(fechaIso)}, ${hora}:${minutos}`;
}

// Tiempo transcurrido desde que se envió la solicitud (created_at), en
// unidades legibles ("hace unos minutos", "hace 3 horas", "hace 2 días").
function formatearTiempoTranscurrido(fechaIso) {
  if (!fechaIso) return '';
  const minutos = Math.floor((Date.now() - new Date(fechaIso).getTime()) / 60000);

  if (minutos < 1) return 'hace unos instantes';
  if (minutos < 60) return `hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;

  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

// Tiempo que le queda al abogado para responder antes de que la solicitud
// expire automáticamente (solicitudes.expires_at = created_at + 48h, ver
// migración 20260625_006_solicitudes.sql).
function formatearTiempoRestante(expiresAtIso) {
  if (!expiresAtIso) return '';
  const minutosRestantes = Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 60000);

  if (minutosRestantes <= 0) return 'El plazo de respuesta está por vencer.';
  if (minutosRestantes < 60) {
    return `Quedan ${minutosRestantes} ${minutosRestantes === 1 ? 'minuto' : 'minutos'} para que el abogado responda.`;
  }

  const horasRestantes = Math.floor(minutosRestantes / 60);
  return `Quedan ${horasRestantes} ${horasRestantes === 1 ? 'hora' : 'horas'} para que el abogado responda.`;
}

// Umbral visual de urgencia: menos de 6 horas restantes para responder.
function esTiempoRestanteUrgente(expiresAtIso) {
  if (!expiresAtIso) return false;
  const horasRestantes = (new Date(expiresAtIso).getTime() - Date.now()) / 3600000;
  return horasRestantes < 6;
}

// CLAUDE.md módulo 5: espejo del mínimo de 24h que exige la política RLS
// "cliente_inserta_resena" (solo controla la visibilidad del botón; la
// validación real vive en la base de datos).
function haPasadoTiempoMinimoResena(completadaAtIso) {
  if (!completadaAtIso) return false;
  return Date.now() - new Date(completadaAtIso).getTime() >= 24 * 60 * 60 * 1000;
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
