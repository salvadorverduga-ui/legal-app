// panel-cliente.js
// Lógica de la página panel-cliente.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, generarCheckboxSeguimiento, generarBotonFavorito, MENSAJE_AGREGADO_SEGUIMIENTO } from './utils.js';
import { inicializarHeader } from './header.js';

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

const ETIQUETAS_ESTADO_CASO_TABLON = {
  ACTIVO:   'Activo',
  EXPIRADO: 'Expirado',
  CERRADO:  'Cerrado',
};

const CLASE_ESTADO_CASO_TABLON = {
  ACTIVO:   'badge--estado-aceptada',
  EXPIRADO: 'badge--estado-expirada',
  CERRADO:  'badge--estado-cancelada',
};

const SECCIONES = ['Inicio', 'Solicitudes', 'Abogados', 'Favoritos', 'Resenas', 'Seguimiento'];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;         // fila propia de la tabla perfiles
let solicitudesActuales = [];    // caché local: cuenta de activas en Inicio y estado de seguimiento
// generarSolicitudCard() (compartida con la pestaña "En seguimiento") revisa estos dos
// valores para decidir si el form de reseña/edición va abierto; en este archivo nunca
// se les asigna otra cosa que null, así que esas tarjetas siempre nacen cerradas.
const solicitudConFormularioAbierto = null;
const solicitudConEdicionAbierta = null;

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

  renderizarCabecera();
  renderizarSaludoInicio();
  inicializarHeader({ rol: 'cliente', nombre: perfilActual.nombre_completo, fotoPath: perfilActual.foto_url });

  const [resenas, abogadosContactados, ultimosAbogados, notificacionesNoLeidas, misSeguimientos, misFavoritos] = await Promise.all([
    api.resenas.getMisResenas(),
    api.solicitudes.getAbogadosContactados(),
    api.clientes.getUltimosAbogados(),
    api.notificaciones.getNoLeidas(),
    api.seguimiento.getMisSeguimientos(),
    api.favoritos.getMisFavoritos(),
    cargarSolicitudes(),
  ]);
  renderizarResenas(resenas);
  renderizarAbogadosContactados(abogadosContactados);
  renderizarUltimosAbogados(ultimosAbogados);
  renderizarResumenInicio(notificacionesNoLeidas.length);
  renderizarSeguimiento(misSeguimientos);
  renderizarFavoritos(misFavoritos);

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
  SECCIONES.forEach(nombre => {
    document.getElementById(`tab${nombre}`).addEventListener('click', () => cambiarTab(nombre));
  });

  document.querySelectorAll('[data-ir-a-tab]').forEach(el => {
    el.addEventListener('click', () => cambiarTab(el.dataset.irATab));
  });

  document.getElementById('seccionSeguimiento').addEventListener('click', manejarClickSeguimiento);
  document.getElementById('favoritosLista').addEventListener('click', manejarClickFavorito);
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
  document.getElementById('cabeceraAvatar').innerHTML = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);
  document.getElementById('cabeceraNombre').textContent = perfilActual.nombre_completo;
}

// ─── Inicio (dashboard) ───────────────────────────────────────────────────────
function renderizarSaludoInicio() {
  document.getElementById('inicioSaludo').textContent = `${obtenerSaludo()}, ${perfilActual.nombre_completo}`;
}

function obtenerSaludo() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return 'Buenos días';
  if (hora >= 12 && hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

// Solicitudes "activas": esperando respuesta del abogado o ya aceptadas
// (consulta en curso) — no incluye estados terminales.
function renderizarResumenInicio(notificacionesNoLeidas) {
  const activas = solicitudesActuales.filter(s => s.estado === 'PENDIENTE' || s.estado === 'ACEPTADA').length;
  document.getElementById('inicioSolicitudesActivas').textContent = String(activas);
  document.getElementById('inicioNotificacionesNoLeidas').textContent = String(notificacionesNoLeidas);
}

// ─── Solicitudes ──────────────────────────────────────────────────────────────
// Solo alimenta el conteo de activas en Inicio y la caché usada por el
// toggle de seguimiento — el listado y las acciones (completar/cancelar/editar/
// reseñar) viven ahora en solicitudes-directas.html/solicitudes-tablon.html
// (ver CLAUDE.md §17/módulo 1).
async function cargarSolicitudes() {
  solicitudesActuales = await api.solicitudes.getSolicitudesCliente();
}

function generarSolicitudCard(s) {
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

function manejarClickSeguimiento(e) {
  const btn = e.target.closest('[data-accion="toggle-seguimiento"]');
  if (!btn) return;
  manejarToggleSeguimiento(btn.dataset.id);
}

async function manejarToggleSeguimiento(id) {
  const { data, error } = await api.seguimiento.toggleSolicitud(id, 'cliente');

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar el seguimiento. Intente de nuevo.'));
    return;
  }

  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, data);

  const misSeguimientos = await api.seguimiento.getMisSeguimientos();
  renderizarSeguimiento(misSeguimientos);

  toast.info(data.en_seguimiento_cliente ? MENSAJE_AGREGADO_SEGUIMIENTO : 'Quitado de seguimiento.');
}

// ─── En seguimiento ───────────────────────────────────────────────────────────
function renderizarSeguimiento({ solicitudes, casosTablon }) {
  const contenedorSolicitudes = document.getElementById('seguimientoSolicitudesLista');
  const vacioSolicitudes = document.getElementById('estadoSinSeguimientoSolicitudes');

  if (!solicitudes || solicitudes.length === 0) {
    contenedorSolicitudes.innerHTML = '';
    vacioSolicitudes.hidden = false;
  } else {
    vacioSolicitudes.hidden = true;
    contenedorSolicitudes.innerHTML = solicitudes.map(generarSolicitudCard).join('');
  }

  const contenedorCasos = document.getElementById('seguimientoCasosLista');
  const vacioCasos = document.getElementById('estadoSinSeguimientoCasos');

  if (!casosTablon || casosTablon.length === 0) {
    contenedorCasos.innerHTML = '';
    vacioCasos.hidden = false;
  } else {
    vacioCasos.hidden = true;
    contenedorCasos.innerHTML = casosTablon.map(generarCasoSeguimientoCard).join('');
  }
}

function generarCasoSeguimientoCard(c) {
  const idSeguro = escaparAtrib(c.id);
  const claseEstado = CLASE_ESTADO_CASO_TABLON[c.estado] ?? 'badge--estado-expirada';
  const etiquetaEstado = ETIQUETAS_ESTADO_CASO_TABLON[c.estado] ?? c.estado;

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="caso-tablon-card__titulo"><a href="/pages/tablon-caso?id=${idSeguro}">${escaparHtml(c.titulo)}</a></p>
          <p class="solicitud-item__fecha">${formatearFecha(c.created_at)} · ${c.especialidad ? escaparHtml(c.especialidad) : 'Sin especialidad definida'}</p>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      <div class="solicitud-item__acciones">
        <a href="/pages/tablon-caso?id=${idSeguro}" class="btn btn--secundario btn--sm">Ver caso</a>
      </div>
    </article>
  `;
}

// ─── Inicio: últimos abogados con los que trabajó ─────────────────────────────
// Reutiliza generarCardAbogadoContactado() (misma tarjeta que "Mis abogados"),
// solo que aquí la lista ya viene limitada a 3 por api.clientes.getUltimosAbogados().
function renderizarUltimosAbogados(lista) {
  const contenedor = document.getElementById('ultimosAbogadosLista');
  const vacio = document.getElementById('estadoSinUltimosAbogados');

  if (!lista || lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarCardAbogadoContactado).join('');
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
          <h3 class="card-abogado__nombre"><a href="/pages/perfil-abogado?id=${idSeguro}">${escaparHtml(ab.abogado_nombre)}</a></h3>
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

// ─── Favoritos ──────────────────────────────────────────────────────────────
function renderizarFavoritos(lista) {
  const contenedor = document.getElementById('favoritosLista');
  const vacio = document.getElementById('estadoSinFavoritos');

  if (!lista || lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarCardFavorito).join('');
}

function generarCardFavorito(f) {
  const avatarHtml = generarAvatarHtml(f.abogado_foto, f.abogado_nombre);
  const idSeguro = escaparAtrib(f.abogado_id);

  const especialidades = (f.abogado_especialidades ?? []).slice(0, 3);
  const extras = (f.abogado_especialidades?.length ?? 0) - 3;
  const especialidadesHtml = especialidades
    .map(e => `<span class="chip">${escaparHtml(e)}</span>`)
    .join('');
  const masHtml = extras > 0 ? `<span class="chip chip--mas">+${extras}</span>` : '';

  return `
    <article class="card-abogado" role="listitem">
      ${generarBotonFavorito(idSeguro, true)}
      <div class="card-abogado__header">
        <div class="card-abogado__avatar">${avatarHtml}</div>
        <div class="card-abogado__meta">
          <h3 class="card-abogado__nombre"><a href="/pages/perfil-abogado?id=${idSeguro}">${escaparHtml(f.abogado_nombre)}</a></h3>
          ${f.abogado_provincia ? `<p class="card-abogado__ubicacion">${escaparHtml(f.abogado_provincia)}</p>` : ''}
        </div>
      </div>

      ${especialidades.length ? `
        <div class="card-abogado__especialidades">
          ${especialidadesHtml}${masHtml}
        </div>
      ` : ''}

      <div class="card-abogado__footer">
        <div class="solicitud-item__acciones">
          <a href="/pages/perfil-abogado?id=${idSeguro}" class="btn btn--secundario btn--sm">Ver perfil</a>
          <a href="/pages/perfil-abogado?id=${idSeguro}" class="btn btn--primario btn--sm">Nueva consulta</a>
        </div>
      </div>
    </article>
  `;
}

async function manejarClickFavorito(e) {
  const btn = e.target.closest('[data-accion="toggle-favorito"]');
  if (!btn) return;

  btn.disabled = true;
  const { error } = await api.favoritos.toggle(btn.dataset.id);

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar sus favoritos. Intente de nuevo.'));
    btn.disabled = false;
    return;
  }

  // En esta pestaña, togglear siempre significa "quitar" (ya son todos favoritos).
  const favoritos = await api.favoritos.getMisFavoritos();
  renderizarFavoritos(favoritos);
  toast.info('Quitado de favoritos.');
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
