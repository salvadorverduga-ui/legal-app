// panel-cliente.js
// Lógica de la página panel-cliente.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';
import { inicializarNotificaciones } from './notificaciones.js';

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

const SECCIONES = ['Perfil', 'Solicitudes', 'Abogados', 'Resenas'];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;         // fila propia de la tabla perfiles
let solicitudesActuales = [];    // caché local; las acciones actualizan sin refetch
let estadoFiltroActivo = '';     // '' = todas
let solicitudConFormularioAbierto = null; // id de la solicitud con el form de reseña visible
let solicitudConEdicionAbierta = null;    // id de la solicitud con el form de edición visible

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
  rellenarFormularioPerfil();
  inicializarNotificaciones();

  const [resenas, abogadosContactados] = await Promise.all([
    api.resenas.getMisResenas(),
    api.solicitudes.getAbogadosContactados(),
    cargarSolicitudes(),
  ]);
  renderizarResenas(resenas);
  renderizarAbogadosContactados(abogadosContactados);

  mostrarContenido();
  configurarEventos();
  aplicarTabDesdeUrl();
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
  document.getElementById('solicitudesLista').addEventListener('submit', manejarSubmitEditar);
  document.getElementById('solicitudesLista').addEventListener('input', manejarInputSolicitudes);

  document.getElementById('btnCambiarFoto').addEventListener('click', () => {
    document.getElementById('inputFoto').click();
  });
  document.getElementById('inputFoto').addEventListener('change', manejarCambioFoto);

  document.getElementById('formPerfil').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarGuardarPerfil();
  });
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

// Activa la pestaña indicada en ?tab= (ej. desde una notificación), si es válida.
function aplicarTabDesdeUrl() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (!tab) return;
  const seccion = SECCIONES.find(nombre => nombre.toLowerCase() === tab.toLowerCase());
  if (seccion) cambiarTab(seccion);
}

// ─── Cabecera: identidad ──────────────────────────────────────────────────────
function renderizarCabecera() {
  const avatarHtml = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);
  document.getElementById('cabeceraAvatar').innerHTML = avatarHtml;
  document.getElementById('perfilFotoAvatar').innerHTML = avatarHtml;
  document.getElementById('cabeceraNombre').textContent = perfilActual.nombre_completo;
}

// ─── Mi perfil: foto ──────────────────────────────────────────────────────────
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
  renderizarCabecera();
  estadoEl.textContent = 'Foto actualizada.';
  toast.exito('Foto actualizada.');
  e.target.value = '';
}

// ─── Mi perfil: formulario ────────────────────────────────────────────────────
function rellenarFormularioPerfil() {
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
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const telefono = document.getElementById('perfilTelefono').value.trim();
  const provincia = document.getElementById('perfilProvincia').value;
  const ciudad = document.getElementById('perfilCiudad').value.trim();

  const { data, error } = await api.perfiles.actualizarPerfil({
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
    exitoEl.hidden = false;
    toast.exito('Perfil guardado.');
  }

  btn.disabled = false;
  btn.textContent = 'Guardar cambios';
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
        <span class="campo__etiqueta">Disponibilidad horaria</span>
        <div class="radio-pills" role="radiogroup" aria-label="Disponibilidad horaria">
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

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div class="solicitud-item__cliente">
          <div class="solicitud-item__avatar">${avatarHtml}</div>
          <div>
            <p class="solicitud-item__nombre">${escaparHtml(s.abogado_nombre)}</p>
            <p class="solicitud-item__fecha">Enviada ${formatearTiempoTranscurrido(s.created_at)} · ${formatearFecha(s.created_at)}</p>
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

const OPCIONES_DISPONIBILIDAD = ['Mañana', 'Tarde', 'Indiferente'];

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

  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, data);
  solicitudConEdicionAbierta = null;
  renderizarSolicitudes();
  toast.exito('Solicitud actualizada.');
}

// ─── Mis abogados ─────────────────────────────────────────────────────────────
function renderizarAbogadosContactados(lista) {
  const contenedor = document.getElementById('abogadosContactadosLista');
  const vacio = document.getElementById('estadoSinAbogadosContactados');

  if (!lista || lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarCardAbogadoContactado).join('');
}

function generarCardAbogadoContactado(ab) {
  const avatarHtml = generarAvatarHtml(ab.abogado_foto, ab.abogado_nombre);
  const idSeguro = escaparAtrib(ab.abogado_id);

  const especialidades = (ab.abogado_especialidades ?? []).slice(0, 3);
  const extras = (ab.abogado_especialidades?.length ?? 0) - 3;
  const especialidadesHtml = especialidades
    .map(e => `<span class="chip">${escaparHtml(e)}</span>`)
    .join('');
  const masHtml = extras > 0 ? `<span class="chip chip--mas">+${extras}</span>` : '';

  const activaHtml = ab.tiene_solicitud_activa
    ? '<span class="badge badge--estado-aceptada">Consulta activa</span>'
    : '';

  return `
    <article class="card-abogado" role="listitem">
      <div class="card-abogado__header">
        <div class="card-abogado__avatar">${avatarHtml}</div>
        <div class="card-abogado__meta">
          <div class="card-abogado__badges">${activaHtml}</div>
          <h3 class="card-abogado__nombre">${escaparHtml(ab.abogado_nombre)}</h3>
          ${ab.abogado_provincia ? `<p class="card-abogado__ubicacion">${escaparHtml(ab.abogado_provincia)}</p>` : ''}
        </div>
      </div>

      ${especialidades.length ? `
        <div class="card-abogado__especialidades">
          ${especialidadesHtml}${masHtml}
        </div>
      ` : ''}

      <div class="card-abogado__footer">
        <p class="card-abogado__precio">Última interacción: ${formatearFecha(ab.ultima_interaccion)}</p>
        <div class="solicitud-item__acciones">
          <a href="/pages/perfil-abogado?id=${idSeguro}" class="btn btn--secundario btn--sm">Ver perfil</a>
          <a href="/pages/perfil-abogado?id=${idSeguro}" class="btn btn--primario btn--sm">Nueva consulta</a>
        </div>
      </div>
    </article>
  `;
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
