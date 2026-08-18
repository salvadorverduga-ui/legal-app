// solicitudes-tablon.js
// Lógica de la página solicitudes-tablon.html.
//
// Vista abogado: listado con filtros de estado de las solicitudes originadas
// en El Tablón (caso_tablon_id NOT NULL — ver migración 20260714_049).
//
// Vista cliente: a diferencia del abogado, acá se muestran TODOS los casos
// que el cliente publicó en El Tablón (tabla casos_tablon vía
// api.tablon.getMisCasos(), que ya devuelve todos los estados — CLAUDE.md
// módulo 3), no solo los que derivaron en una solicitud. Antes de este
// cambio, un caso sin aplicaciones o sin abogado elegido no aparecía en
// ningún lado de "Solicitudes del Tablón".
//
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, rutaPanelPropio, generarCheckboxSeguimiento, generarBotonFavorito, generarMenuTarjeta, inicializarMenuTarjeta, actualizarControlesFavorito, abrirModalBloqueo, generarContadorVisualizaciones, MENSAJE_AGREGADO_SEGUIMIENTO } from './utils.js';
import { inicializarHeader } from './header.js';
import { inicializarChat, destruirChat } from './chat.js';

const ORIGEN = 'tablon';

// ─── Etiquetas y estilos por estado: solicitudes (vista abogado) ─────────────
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

const FILTROS_ESTADO_SOLICITUD = [
  { estado: '',          etiqueta: 'Todas' },
  { estado: 'PENDIENTE', etiqueta: 'Pendientes' },
  { estado: 'ACEPTADA',  etiqueta: 'Aceptadas' },
  { estado: 'COMPLETADA', etiqueta: 'Completadas' },
  { estado: 'RESEÑADA',  etiqueta: 'Reseñadas' },
  { estado: 'RECHAZADA', etiqueta: 'Rechazadas' },
  { estado: 'EXPIRADA',  etiqueta: 'Expiradas' },
  { estado: 'CANCELADA', etiqueta: 'Canceladas' },
];

// ─── Etiquetas y estilos por estado: casos (vista cliente) ───────────────────
const ETIQUETAS_ESTADO_CASO = {
  ACTIVO:   'Activo',
  EXPIRADO: 'Expirado',
  CERRADO:  'Cerrado',
};

const CLASE_ESTADO_CASO = {
  ACTIVO:   'badge--estado-aceptada',
  EXPIRADO: 'badge--estado-expirada',
  CERRADO:  'badge--estado-cancelada',
};

const FILTROS_ESTADO_CASO = [
  { estado: '',         etiqueta: 'Todos' },
  { estado: 'ACTIVO',   etiqueta: 'Activos' },
  { estado: 'CERRADO',  etiqueta: 'Cerrados' },
  { estado: 'EXPIRADO', etiqueta: 'Expirados' },
];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;
let rolActual = null;                 // 'cliente' | 'abogado'
let solicitudesActuales = [];         // vista abogado; caché local, las acciones actualizan sin refetch
let misCasosActuales = [];            // vista cliente: todos los casos publicados (todos los estados)
let estadoFiltroActivo = '';          // '' = todos/todas
let solicitudConFormularioAbierto = null; // vista cliente: id de solicitud con el form de reseña visible
let solicitudPorCasoId = new Map();       // vista cliente: caso_tablon_id -> solicitud (para completar/reseñar embebido en la tarjeta del caso)
let favoritosIds = new Set();             // vista cliente: abogado_id favoritos, para el corazón del abogado elegido
let conteoNoLeidosChat = new Map();       // solicitudId -> mensajes sin leer, badge del botón "Chat"
let solicitudConChatAbierto = null;       // id de la solicitud con el panel de chat expandido (uno solo a la vez)

// ─── Entry point ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[solicitudes-tablon] Error al cargar configuración:', err);
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
    ? 'Casos del Tablón en los que fue elegido.'
    : 'Todos los casos que publicó en El Tablón.';
  document.getElementById('textoSinSolicitudes').textContent = rolActual === 'abogado'
    ? 'Cuando un cliente lo elija en un caso de El Tablón, aparecerá aquí.'
    : 'Aún no ha publicado ningún caso en El Tablón.';

  renderizarFiltros();

  if (rolActual === 'abogado') {
    await cargarSolicitudes();
  } else {
    await cargarMisCasos();
  }

  mostrarContenido();
  configurarEventos();
  abrirChatDesdeUrl();
}

// Notificación "Nuevo mensaje" (fn_notificar_mensaje_nuevo, migración 085)
// de una solicitud originada en El Tablón: llega con
// ?solicitud=<id>&chat=true para abrir el chat de esa solicitud directamente.
// A diferencia de solicitudes-directas.js, esta página no tiene mecanismo de
// "resaltar" tarjeta (nunca lo tuvo, ver urlSolicitud() de panel-cliente.js) —
// solo se abre el chat.
function abrirChatDesdeUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('chat') !== 'true') return;
  const id = params.get('solicitud');
  if (id) abrirChat(id);
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
  document.getElementById('filtrosEstado').addEventListener('click', (e) => {
    const btn = e.target.closest('.filtro-tipo__btn');
    if (btn) cambiarFiltro(btn.dataset.estado);
  });

  const contenedor = document.getElementById('solicitudesLista');
  contenedor.addEventListener('click', manejarClickSolicitudes);
  contenedor.addEventListener('submit', manejarSubmitResena);
  inicializarMenuTarjeta();
}

// ─── Filtros (distintos por rol: estado de solicitud vs. estado de caso) ─────
function renderizarFiltros() {
  const opciones = rolActual === 'abogado' ? FILTROS_ESTADO_SOLICITUD : FILTROS_ESTADO_CASO;
  const contenedor = document.getElementById('filtrosEstado');

  contenedor.querySelectorAll('.filtro-tipo__btn').forEach(btn => btn.remove());
  contenedor.insertAdjacentHTML('beforeend', opciones.map((o, i) => `
    <button class="filtro-tipo__btn${i === 0 ? ' filtro-tipo__btn--activo' : ''}" data-estado="${o.estado}" type="button">
      ${o.etiqueta}
    </button>
  `).join(''));
}

function cambiarFiltro(estado) {
  estadoFiltroActivo = estado;
  document.querySelectorAll('.filtro-tipo__btn').forEach(btn => {
    btn.classList.toggle('filtro-tipo__btn--activo', btn.dataset.estado === estado);
  });
  rolActual === 'abogado' ? renderizarSolicitudes() : renderizarMisCasos();
}

// ─── Solicitudes (vista abogado) ───────────────────────────────────────────────
async function cargarSolicitudes() {
  solicitudesActuales = await api.solicitudes.getSolicitudesAbogado(ORIGEN);
  await cargarConteosChat();
  renderizarSolicitudes();
}

// Badge de mensajes sin leer del botón "Chat" -- disponible solo para
// solicitudes ACEPTADA/COMPLETADA (únicos estados donde el chat funciona,
// ver migración 083). Sirve para ambos roles: en la vista abogado son las
// solicitudes listadas directamente; en la vista cliente son las mismas
// filas que solicitudPorCasoId indexa por caso (ver cargarMisCasos()).
async function cargarConteosChat() {
  const elegibles = solicitudesActuales.filter(s => s.estado === 'ACEPTADA' || s.estado === 'COMPLETADA');
  const conteos = await Promise.all(elegibles.map(s => api.chat.contarNoLeidos(s.id)));
  conteoNoLeidosChat = new Map(elegibles.map((s, i) => [s.id, conteos[i]]));
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
  contenedor.innerHTML = lista.map(generarSolicitudCardAbogado).join('');
  reabrirChatSiCorresponde(lista.map(s => s.id));
}

// ─── Mis casos (vista cliente) — CLAUDE.md módulo 3: todos los casos ─────────
// publicados, con o sin aplicaciones y con o sin abogado elegido. Se cargan
// junto con las solicitudes de origen Tablón para poder embeber "marcar
// completada"/"dejar reseña" en la tarjeta del caso correspondiente.
async function cargarMisCasos() {
  const [casos, solicitudes, misFavoritosIds] = await Promise.all([
    api.tablon.getMisCasos(),
    api.solicitudes.getSolicitudesCliente(ORIGEN),
    api.favoritos.getMisFavoritosIds(),
  ]);
  misCasosActuales = casos;
  solicitudesActuales = solicitudes;
  solicitudPorCasoId = new Map(solicitudes.filter(s => s.caso_tablon_id).map(s => [s.caso_tablon_id, s]));
  favoritosIds = new Set(misFavoritosIds);
  await cargarConteosChat();
  renderizarMisCasos();
}

function renderizarMisCasos() {
  const lista = misCasosActuales.filter(c => !estadoFiltroActivo || c.estado === estadoFiltroActivo);
  const contenedor = document.getElementById('solicitudesLista');
  const vacio = document.getElementById('estadoSinSolicitudes');
  const textoVacio = document.getElementById('textoSinSolicitudes');

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    textoVacio.textContent = misCasosActuales.length === 0
      ? textoVacio.textContent
      : 'No hay casos en este estado.';
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarCasoClienteCard).join('');

  // El chat cuelga de la solicitud embebida en la tarjeta del caso
  // (solicitudPorCasoId), no del caso en sí -- se reabre solo si esa
  // solicitud sigue en el listado filtrado actual.
  reabrirChatSiCorresponde(lista.map(c => solicitudPorCasoId.get(c.id)?.id).filter(Boolean));
}

// Casi toda acción de esta página (seguimiento, favoritos, completar,
// reseñar...) vuelve a regenerar #solicitudesLista por completo -- si eso
// pasa mientras hay un chat abierto en otra tarjeta, el panel viejo queda
// reemplazado por uno nuevo oculto. Se reabre acá para que una acción no
// relacionada no le cierre el chat al usuario.
function reabrirChatSiCorresponde(idsVisibles) {
  if (!solicitudConChatAbierto) return;

  if (idsVisibles.includes(solicitudConChatAbierto)) {
    abrirChat(solicitudConChatAbierto);
  } else {
    solicitudConChatAbierto = null;
  }
}

// Identidad del abogado elegido (avatar, nombre, corazón de favorito) —
// solo se muestra si el cliente ya eligió a alguien en este caso (existe
// una solicitud asociada). CLAUDE.md módulo 2 de la ronda de fixes: el
// corazón de favorito debe aparecer en cualquier lugar donde se muestre
// una tarjeta de abogado, y este es el único punto de esta página donde
// aparece un abogado identificado (el resto de la tarjeta es del caso).
function generarAbogadoElegidoCard(s) {
  const abogadoIdSeguro = escaparAtrib(s.abogado_id);
  const avatarHtml = generarAvatarHtml(s.abogado_foto, s.abogado_nombre);
  const esFavorito = favoritosIds.has(s.abogado_id);
  const favoritoHtml = generarBotonFavorito(abogadoIdSeguro, esFavorito);
  const nombreSeguro = escaparAtrib(s.abogado_nombre);
  const menuHtml = generarMenuTarjeta([
    { texto: 'Ver perfil', href: `/pages/perfil-abogado?id=${abogadoIdSeguro}` },
    { texto: esFavorito ? 'Quitar de favoritos' : 'Marcar como favorito', accion: 'toggle-favorito', id: abogadoIdSeguro },
    { texto: 'Bloquear abogado', accion: 'bloquear-abogado', id: abogadoIdSeguro, dataNombre: nombreSeguro },
  ]);

  return `
    <div class="solicitud-item__cliente">
      <div class="solicitud-item__avatar">${avatarHtml}</div>
      <div>
        <p class="solicitud-item__nombre"><a href="/pages/perfil-abogado?id=${abogadoIdSeguro}">${escaparHtml(s.abogado_nombre)}</a></p>
      </div>
      <div style="margin-left: auto; display: flex; align-items: center; gap: var(--esp-1);">
        ${favoritoHtml}
        ${menuHtml}
      </div>
    </div>
  `;
}

function generarCasoClienteCard(c) {
  const idSeguro = escaparAtrib(c.id);
  const claseEstado = CLASE_ESTADO_CASO[c.estado] ?? 'badge--estado-expirada';
  const etiquetaEstado = ETIQUETAS_ESTADO_CASO[c.estado] ?? c.estado;
  const especialidadTexto = c.especialidad ? escaparHtml(c.especialidad) : 'Sin especialidad definida';
  const tiempoRestanteHtml = c.estado === 'ACTIVO'
    ? `<p class="solicitud-item__fecha">${formatearTiempoRestanteCaso(c.expires_at)}</p>`
    : '';

  const solicitud = solicitudPorCasoId.get(c.id);
  const accionesSolicitudHtml = solicitud ? generarAccionesSolicitudCliente(solicitud) : '';
  const abogadoElegidoHtml = solicitud ? generarAbogadoElegidoCard(solicitud) : '';

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="caso-tablon-card__titulo"><a href="/pages/tablon-caso?id=${idSeguro}">${escaparHtml(c.titulo)}</a></p>
          <p class="solicitud-item__fecha">Publicado el ${formatearFecha(c.created_at)} · ${especialidadTexto}</p>
          ${tiempoRestanteHtml}
        </div>
        <div class="solicitud-item__header-derecha">
          <span class="badge ${claseEstado}">${etiquetaEstado}</span>
          ${generarContadorVisualizaciones(c.visualizaciones ?? 0)}
        </div>
      </div>
      ${abogadoElegidoHtml}
      ${accionesSolicitudHtml}
      <div class="solicitud-item__acciones">
        ${c.anonimo ? '<span class="badge badge--anonimo">Publicado como anónimo</span>' : ''}
        <a href="/pages/tablon-caso?id=${idSeguro}" class="btn btn--secundario btn--sm">
          Ver caso (${c.total_aplicaciones} ${c.total_aplicaciones === 1 ? 'aplicación' : 'aplicaciones'})
        </a>
      </div>
    </article>
  `;
}

function formatearTiempoRestanteCaso(expiresAtIso) {
  if (!expiresAtIso) return '';
  const diasRestantes = Math.ceil((new Date(expiresAtIso).getTime() - Date.now()) / 86400000);
  if (diasRestantes <= 0) return 'Expira hoy.';
  return `Expira en ${diasRestantes} ${diasRestantes === 1 ? 'día' : 'días'}.`;
}

// Link opcional al caso de origen en El Tablón (caso_tablon_id, migración 049).
function generarLinkCasoTablon(casoTablonId) {
  if (!casoTablonId) return '';
  return `
    <div class="solicitud-item__acciones">
      <a href="/pages/tablon-caso?id=${escaparAtrib(casoTablonId)}" class="btn btn--secundario btn--sm">
        Ver caso en El Tablón
      </a>
    </div>
  `;
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
    ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Teléfono:</span> ${escaparHtml(s.cliente_telefono)}</p>`
    : '<p class="solicitud-item__detalle">El cliente no registró teléfono.</p>';

  const notaAnonimoHtml = s.caso_tablon_anonimo
    ? '<p class="solicitud-item__detalle">Este cliente publicó su caso de forma anónima. Sus datos se revelan únicamente a los abogados elegidos.</p>'
    : '';

  const contactoHtml = s.estado === 'ACEPTADA'
    ? `
      <div class="solicitud-item__contacto">
        <p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Nombre completo:</span> ${escaparHtml(s.cliente_nombre)}</p>
        <p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Email:</span> ${escaparHtml(s.cliente_email ?? 'No registrado')}</p>
        ${telefonoHtml}
        ${notaAnonimoHtml}
      </div>
    `
    : '';

  // Elegido desde El Tablón: la solicitud nace directamente en ACEPTADA (§17),
  // así que aquí nunca hay acciones de aceptar/rechazar pendientes.
  const seguimientoHtml = generarCheckboxSeguimiento(idSeguro, s.en_seguimiento_abogado);

  // Menú de tres puntos: única opción hoy es "Bloquear cliente" (CLAUDE.md
  // módulo 3 de la ronda de fixes).
  const menuHtml = generarMenuTarjeta([
    { texto: 'Bloquear cliente', accion: 'bloquear-cliente', id: escaparAtrib(s.cliente_id), dataNombre: escaparAtrib(s.cliente_nombre) },
  ]);

  const chatHtml = generarBloqueChat(s, idSeguro);

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
        <div class="solicitud-item__header-derecha">
          <span class="badge ${claseEstado}">${etiquetaEstado}</span>
          ${menuHtml}
        </div>
      </div>
      ${detalleHtml}
      ${motivoRechazoHtml}
      ${contactoHtml}
      ${generarLinkCasoTablon(s.caso_tablon_id)}
      ${seguimientoHtml}
      ${chatHtml}
    </article>
  `;
}

// ─── Chat (migración 083) ───────────────────────────────────────────────────
// Disponible solo en ACEPTADA/COMPLETADA -- únicos estados donde la política
// RLS "participantes_envian_mensaje" permite escribir. El botón lleva el
// badge de no leídos; el panel se llena al abrir (ver abrirChat()).
function generarBotonChat(idSeguro, conteo) {
  const badgeHtml = conteo > 0
    ? `<span class="badge-chat-no-leidos">${conteo > 99 ? '99+' : conteo}</span>`
    : '';
  return `
    <button class="btn btn--secundario btn--sm solicitud-item__btn-chat" type="button"
      data-accion="toggle-chat" data-id="${idSeguro}" aria-expanded="false">
      Chat
      ${badgeHtml}
    </button>
  `;
}

function generarBloqueChat(s, idSeguro) {
  if (s.estado !== 'ACEPTADA' && s.estado !== 'COMPLETADA') return '';
  return `
    <div class="solicitud-item__acciones">
      ${generarBotonChat(idSeguro, conteoNoLeidosChat.get(s.id) ?? 0)}
    </div>
    <div class="chat-panel-solicitud" id="chatPanel-${idSeguro}" hidden></div>
  `;
}

// Acciones de la solicitud aceptada asociada a un caso (marcar completada /
// dejar reseña) — se insertan dentro de la tarjeta del caso cuando existe una
// solicitud vinculada (ver solicitudPorCasoId). Antes vivían en su propia
// tarjeta de solicitud; se conservan para no perder la posibilidad de cerrar
// y reseñar una consulta iniciada desde El Tablón (CLAUDE.md módulo 3).
function generarAccionesSolicitudCliente(s) {
  const idSeguro = escaparAtrib(s.id);
  const puedeCompletar = s.estado === 'ACEPTADA';
  const sinResenaAun = s.estado === 'COMPLETADA' && !s.tiene_resena;
  const puedeReseñar = sinResenaAun && haPasadoTiempoMinimoResena(s.completada_at);
  const esperaResenaHtml = (sinResenaAun && !puedeReseñar)
    ? '<p class="campo__ayuda">Podrá dejar su reseña 24 horas después de completada la consulta.</p>'
    : '';
  const formularioAbierto = solicitudConFormularioAbierto === s.id;

  const completarHtml = puedeCompletar ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--primario btn--sm" type="button" data-accion="marcar-completada" data-id="${idSeguro}">
        Marcar consulta como completada
      </button>
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

  const chatHtml = generarBloqueChat(s, idSeguro);

  return `${completarHtml}${esperaResenaHtml}${accionesHtml}${chatHtml}`;
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

// ─── Clicks ─────────────────────────────────────────────────────────────────────
function manejarClickSolicitudes(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;

  const { accion, id } = btn.dataset;

  if (accion === 'toggle-seguimiento') return manejarToggleSeguimiento(id);
  if (accion === 'toggle-favorito') return manejarClickFavorito(btn);
  if (accion === 'bloquear-cliente') return manejarBloquearCliente(id, btn.dataset.nombre);
  if (accion === 'bloquear-abogado') return manejarBloquearAbogado(id, btn.dataset.nombre);
  if (accion === 'toggle-chat') return manejarToggleChat(id);

  if (rolActual === 'abogado') return;

  if (accion === 'marcar-completada') manejarMarcarCompletada(id);
  if (accion === 'mostrar-resena') {
    solicitudConFormularioAbierto = id;
    renderizarMisCasos();
  }
  if (accion === 'cancelar-resena') {
    solicitudConFormularioAbierto = null;
    renderizarMisCasos();
  }
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
  renderizarMisCasos();
  toast.exito('Consulta marcada como completada.');
}

// ─── Bloqueos ───────────────────────────────────────────────────────────────
async function manejarBloquearCliente(clienteId, nombreCliente) {
  const bloqueado = await abrirModalBloqueo(nombreCliente, clienteId);
  if (!bloqueado) return;

  // La solicitud fue cancelada automáticamente por el trigger de bloqueos —
  // se refresca desde el servidor en vez de adivinar el nuevo estado local.
  await cargarSolicitudes();
}

async function manejarBloquearAbogado(abogadoId, nombreAbogado) {
  const bloqueado = await abrirModalBloqueo(nombreAbogado, abogadoId);
  if (!bloqueado) return;

  await cargarMisCasos();
}

// ─── Chat (migración 083) ───────────────────────────────────────────────────
// Solo un chat abierto a la vez en toda la página: abrir uno cierra el
// anterior. El toggle en sí no toca solicitudesActuales/misCasosActuales (no
// es un dato de la solicitud ni del caso), así que no dispara un re-render --
// se manipula el DOM directamente para no perder el estado del chat que se
// está abriendo. Funciona igual para ambos roles: solicitudesActuales trae
// la solicitud correspondiente en los dos casos (vista abogado: listado
// directo; vista cliente: mismas filas que solicitudPorCasoId indexa).
function manejarToggleChat(id) {
  if (solicitudConChatAbierto === id) {
    solicitudConChatAbierto = null;
    cerrarChat(id);
    return;
  }

  if (solicitudConChatAbierto) cerrarChat(solicitudConChatAbierto);
  abrirChat(id);
}

function cerrarChat(id) {
  destruirChat(`chatPanel-${id}`);
  const panel = document.getElementById(`chatPanel-${id}`);
  if (panel) panel.hidden = true;
  const boton = document.querySelector(`.solicitud-item__btn-chat[data-id="${id}"]`);
  if (boton) boton.setAttribute('aria-expanded', 'false');
}

async function abrirChat(id) {
  const solicitud = solicitudesActuales.find(s => s.id === id);
  const panel = document.getElementById(`chatPanel-${id}`);
  if (!solicitud || !panel) {
    solicitudConChatAbierto = null;
    return;
  }

  solicitudConChatAbierto = id;
  panel.hidden = false;

  const boton = document.querySelector(`.solicitud-item__btn-chat[data-id="${id}"]`);
  if (boton) boton.setAttribute('aria-expanded', 'true');

  const nombreOtro = rolActual === 'abogado' ? solicitud.cliente_nombre : solicitud.abogado_nombre;
  await inicializarChat(`chatPanel-${id}`, id, perfilActual.id, nombreOtro);

  // chat.js ya marcó los mensajes como leídos al inicializarse (getMensajes +
  // marcarLeidos internos) -- se limpia el badge local sin otro round-trip.
  conteoNoLeidosChat.set(id, 0);
  actualizarBadgeChat(id);
}

function actualizarBadgeChat(id) {
  const boton = document.querySelector(`.solicitud-item__btn-chat[data-id="${id}"]`);
  if (!boton) return;

  const badgeExistente = boton.querySelector('.badge-chat-no-leidos');
  const conteo = conteoNoLeidosChat.get(id) ?? 0;

  if (conteo === 0) {
    if (badgeExistente) badgeExistente.remove();
    return;
  }

  const texto = conteo > 99 ? '99+' : String(conteo);
  if (badgeExistente) {
    badgeExistente.textContent = texto;
  } else {
    boton.insertAdjacentHTML('beforeend', `<span class="badge-chat-no-leidos">${texto}</span>`);
  }
}

// ─── Favoritos (solo vista cliente) ────────────────────────────────────────────
async function manejarClickFavorito(btn) {
  const abogadoId = btn.dataset.id;
  btn.disabled = true;
  const { esFavorito, error } = await api.favoritos.toggle(abogadoId);

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar sus favoritos. Intente de nuevo.'));
    btn.disabled = false;
    return;
  }

  if (esFavorito) favoritosIds.add(abogadoId);
  else favoritosIds.delete(abogadoId);

  actualizarControlesFavorito(abogadoId, esFavorito);
  btn.disabled = false;

  toast.info(esFavorito ? 'Agregado a favoritos.' : 'Quitado de favoritos.');
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
  renderizarMisCasos();
  toast.exito('Reseña enviada.');
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
