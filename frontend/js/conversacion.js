// conversacion.js
// Lógica de conversacion.html: vista de una conversación puntual de chat v2
// (?id=<conversation_id>) -- área de mensajes con paginación por cursor,
// envío/edición/eliminación, el ciclo de vida del asunto (título editable,
// cerrar, solicitar/responder reapertura), el panel lateral "Sobre este
// asunto" y los indicadores de lectura de las burbujas propias. A diferencia
// del resto de la app, esta página no usa el header/footer globales -- es
// una vista de pantalla completa al estilo de una app de mensajería (ver
// main.css, sección CONVERSACIÓN V2).
//
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import {
  toast, mensajeAmigable, confirmar,
  generarMenuTarjeta, inicializarMenuTarjeta,
  abrirModalBloqueo,
  inicializarTooltipsDeshabilitados,
} from './utils.js';

const UMBRAL_FONDO_PX = 80;
const VENTANA_EDICION_MS = 5 * 60 * 1000;
const DURACION_LONG_PRESS_MS = 500;
const SEGUNDOS_ESPERA_CIERRE = 9;
const PUNTO_QUIEBRE_DESKTOP = '(min-width: 640px)';

// ─── Iconografía inline (CLAUDE.md §7: sin emojis, SVG para badges) ───────
const SVG_VERIFICADO = `<svg class="conversacion-header__icono-verificado" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" role="img" aria-label="Verificado">
  <path d="M12 2l2.2 2 3-.5.9 2.9 2.8 1.3-.8 3 1.4 2.7-2.3 1.9.1 3.1-3.1.4-1.7 2.6-2.8-1.1-2.8 1.1-1.7-2.6-3.1-.4.1-3.1-2.3-1.9 1.4-2.7-.8-3 2.8-1.3.9-2.9 3 .5L12 2z"/>
  <path d="M8.6 12.3l2.1 2.1 4-4.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICONO_ORIGEN = {
  directa: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
  tablon: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>`,
};

const SVG_CHECK_UNO = `<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l4 4L15 5"/></svg>`;
const SVG_CHECK_DOBLE = `<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 9l3.5 3.5L11 5.5"/><path d="M6.5 9l3.5 3.5L17 5.5"/></svg>`;

// ─── Estado de la página ───────────────────────────────────────────────────
let miId = null;
let miNombre = null;
let miFoto = null;
let conversationId = null;
let matterActual = null;          // fila de matter_detalle_view
let esCliente = false;
let mensajesActuales = [];        // ASC, filas de messages_view (+ parches locales de edición/eliminación)
let hayMasAntiguos = true;
let cargandoAnteriores = false;
let estaEnElFondo = true;
let mensajesNuevosNoVistos = 0;
let mensajeEnEdicionId = null;
let enviando = false;
let contraparteLastReadAt = null; // conversation_participants.last_read_at de la contraparte -- checkmarks
let panelVisible = false;
let cancelarEscuchaMensajes = null;
let cancelarEscuchaMatter = null;
let longPressTimer = null;

// ─── Entry point ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[conversacion] Error al cargar configuración:', err);
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
  miId = perfilActual.id;
  miNombre = perfilActual.nombre_completo;
  miFoto = perfilActual.foto_url;

  conversationId = new URLSearchParams(window.location.search).get('id');
  if (!conversationId) {
    mostrarError();
    return;
  }

  matterActual = await api.mensajes.getMatterDetalle(conversationId);
  if (!matterActual) {
    mostrarError();
    return;
  }
  esCliente = matterActual.client_id === miId;

  const participantes = await api.mensajes.getParticipantes(conversationId);
  const filaContraparte = participantes.find(p => p.user_id === matterActual.contraparte_id);
  contraparteLastReadAt = filaContraparte?.last_read_at ?? null;

  inicializarPanelAsunto();
  renderizarHeader();
  configurarEventos();

  await cargarMensajesIniciales();

  mostrarContenido();
  desplazarAlFondo(true);

  await api.mensajes.marcarLeido(conversationId);

  cancelarEscuchaMensajes = api.mensajes.escuchar(conversationId, manejarMensajeRealtime);
  cancelarEscuchaMatter = api.mensajes.escucharMatter(matterActual.matter_id, conversationId, manejarEventoMatterRealtime);
}

// "cancelar al salir" pedido explícitamente para esta página (a diferencia
// del inbox, Parte 6, donde no se pidió y se dejó sin desmontaje explícito
// siguiendo el criterio de notificaciones.js).
window.addEventListener('beforeunload', () => {
  if (cancelarEscuchaMensajes) cancelarEscuchaMensajes();
  if (cancelarEscuchaMatter) cancelarEscuchaMatter();
});

// ─── Control de estados visuales ───────────────────────────────────────────
function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarContenido() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('conversacion').hidden = false;
}

// ─── Configuración de eventos ──────────────────────────────────────────────
function configurarEventos() {
  inicializarMenuTarjeta();
  inicializarTooltipsDeshabilitados();

  document.getElementById('tituloBoton').addEventListener('click', abrirEdicionTitulo);
  document.getElementById('btnCancelarTitulo').addEventListener('click', cerrarEdicionTitulo);
  document.getElementById('tituloForm').addEventListener('submit', manejarSubmitTitulo);

  document.getElementById('menuAsuntoContenedor').addEventListener('click', manejarClickMenuAsunto);
  document.getElementById('bannerAsuntoAcciones').addEventListener('click', manejarClickBannerAcciones);

  document.getElementById('btnCerrarPanel').addEventListener('click', cerrarPanel);
  document.getElementById('panelAsuntoOverlay').addEventListener('click', cerrarPanel);

  const areaMensajes = document.getElementById('conversacionMensajes');
  areaMensajes.addEventListener('scroll', manejarScrollMensajes);

  document.getElementById('btnCargarAnteriores').addEventListener('click', cargarMensajesAnteriores);
  document.getElementById('badgeNuevosMensajes').addEventListener('click', manejarClickBadgeNuevos);

  const lista = document.getElementById('listaMensajes');
  lista.addEventListener('click', manejarClickLista);
  lista.addEventListener('contextmenu', manejarContextMenu);
  lista.addEventListener('touchstart', manejarTouchStart, { passive: true });
  lista.addEventListener('touchend', cancelarLongPress);
  lista.addEventListener('touchmove', cancelarLongPress);

  const menuContextual = document.getElementById('menuContextualMensaje');
  menuContextual.addEventListener('click', manejarClickMenuContextual);
  document.addEventListener('click', (e) => {
    if (!menuContextual.hidden && !menuContextual.contains(e.target)) cerrarMenuContextual();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarMenuContextual();
  });

  const inputMensaje = document.getElementById('inputMensaje');
  inputMensaje.addEventListener('input', manejarInputMensaje);
  inputMensaje.addEventListener('keydown', manejarKeydownMensaje);
  document.getElementById('formEnviar').addEventListener('submit', manejarEnviar);
}

// ─── Cabecera del asunto ────────────────────────────────────────────────────
function renderizarHeader() {
  document.getElementById('conversacionAvatar').innerHTML =
    generarAvatarHtml(matterActual.contraparte_foto, matterActual.contraparte_nombre);
  document.getElementById('conversacionNombre').textContent = matterActual.contraparte_nombre;
  document.getElementById('conversacionRol').innerHTML = generarRolContraparteHtml();
  document.getElementById('tituloBoton').textContent = matterActual.title || 'Sin título';

  const origenTexto = matterActual.source_type === 'tablon' ? 'El Tablón' : 'Solicitud directa';
  document.getElementById('badgeOrigenAsunto').innerHTML =
    `${ICONO_ORIGEN[matterActual.source_type] ?? ''} ${escaparHtml(origenTexto)}`;
  document.getElementById('textoIdAsunto').textContent = `#${matterActual.matter_id.slice(0, 8)}`;

  const badge = document.getElementById('badgeEstadoAsunto');
  const cerrado = matterActual.status !== 'active';
  badge.textContent = cerrado ? 'Cerrado' : 'Activo';
  badge.className = `badge conversacion-header__badge-estado ${cerrado ? 'badge--estado-cancelada' : 'badge--estado-aceptada'}`;

  renderizarMenuAsunto();
  renderizarBannerEstado();
  renderizarEstadoInput();
  renderizarPanelAsunto();
}

// "Abogado • [primera especialidad]" con el ícono de verificado si aplica,
// o "Cliente" -- contraparte_especialidades/contraparte_verificacion
// (matter_detalle_view, migración 102) solo tienen valor cuando quien
// consulta es el cliente (la contraparte es el abogado del asunto).
function generarRolContraparteHtml() {
  if (!esCliente) return 'Cliente';

  const especialidad = matterActual.contraparte_especialidades?.[0];
  const textoRol = especialidad ? `Abogado &bull; ${escaparHtml(especialidad)}` : 'Abogado';
  const verificadoHtml = matterActual.contraparte_verificacion === 'VERIFICADO' ? ` ${SVG_VERIFICADO}` : '';
  return `${textoRol}${verificadoHtml}`;
}

// "Cerrar asunto" solo se ofrece si la solicitud origen ya está COMPLETADA o
// RESEÑADA (source_estado, resuelto por matter_detalle_view -- migración
// 20260818_101) -- cerrar una conversación con una consulta todavía en curso
// no tiene sentido y, más importante, dejaría al cliente sin forma de seguir
// hablando con el abogado antes de completar la solicitud.
function puedeCerrarAsunto() {
  return matterActual.source_estado === 'COMPLETADA' || matterActual.source_estado === 'RESEÑADA';
}

function renderizarMenuAsunto() {
  const contenedor = document.getElementById('menuAsuntoContenedor');
  const hayReaperturaPendiente = Boolean(matterActual.reopen_requested_by);

  const opciones = [
    { texto: 'Ver detalles del asunto', accion: 'ver-detalles', id: matterActual.matter_id },
  ];

  if (matterActual.status === 'active') {
    if (puedeCerrarAsunto()) {
      opciones.push({ texto: 'Cerrar asunto', accion: 'cerrar-asunto', id: matterActual.matter_id });
    }
  } else if (!hayReaperturaPendiente) {
    opciones.push({ texto: 'Solicitar reapertura', accion: 'solicitar-reapertura', id: matterActual.matter_id });
  }

  opciones.push({ texto: 'Reportar conversación', accion: 'reportar-conversacion', id: matterActual.matter_id });
  opciones.push({
    texto: 'Bloquear usuario',
    accion: 'bloquear-usuario',
    id: escaparAtrib(matterActual.contraparte_id),
    dataNombre: escaparAtrib(matterActual.contraparte_nombre),
  });

  contenedor.innerHTML = generarMenuTarjeta(opciones);
}

// Cerrado + sin reapertura pendiente: aviso + botón. Cerrado + reapertura
// pendiente por la contraparte: aviso + Aprobar/Rechazar. Cerrado +
// reapertura pendiente por mí: solo aviso de espera. Activo: sin banner.
// title/subtexto se asignan vía textContent (no innerHTML) -- interpolar
// contraparte_nombre ahí es seguro sin escapado manual.
function renderizarBannerEstado() {
  const banner = document.getElementById('bannerAsunto');
  const titulo = document.getElementById('bannerAsuntoTitulo');
  const subtexto = document.getElementById('bannerAsuntoSubtexto');
  const acciones = document.getElementById('bannerAsuntoAcciones');

  if (matterActual.status === 'active') {
    banner.hidden = true;
    acciones.innerHTML = '';
    return;
  }

  const hayReaperturaPendiente = Boolean(matterActual.reopen_requested_by);
  titulo.textContent = 'Este asunto está cerrado.';

  if (!hayReaperturaPendiente) {
    subtexto.textContent = 'Ya no se pueden enviar mensajes. Puede solicitar la reapertura si es necesario.';
    acciones.innerHTML = `
      <button type="button" class="btn btn--secundario btn--sm" id="btnSolicitarReaperturaBanner">
        Solicitar reapertura
      </button>
    `;
  } else if (matterActual.reopen_requested_by === miId) {
    subtexto.textContent = `Esperando respuesta de ${matterActual.contraparte_nombre} para reabrir el asunto.`;
    acciones.innerHTML = '';
  } else {
    subtexto.textContent = `${matterActual.contraparte_nombre} solicitó reabrir este asunto.`;
    acciones.innerHTML = `
      <button type="button" class="btn btn--primario btn--sm" id="btnAprobarReapertura">Aprobar</button>
      <button type="button" class="btn btn--secundario btn--sm" id="btnRechazarReapertura">Rechazar</button>
    `;
  }

  banner.hidden = false;
}

function renderizarEstadoInput() {
  const cerrado = matterActual.status !== 'active';
  document.getElementById('avisoCerrado').hidden = !cerrado;
  document.getElementById('inputMensaje').disabled = cerrado;
  actualizarEstadoBotonEnviar();
}

// ─── Panel lateral "Sobre este asunto" ──────────────────────────────────────
// Mobile: drawer cerrado por defecto, se abre desde el menú de tres puntos
// ("Ver detalles del asunto") o se colapsa con la X / el overlay. Desktop
// (>= 640px, ver main.css): sidebar estático, visible por defecto,
// colapsable con la misma X -- un único booleano (panelVisible) alcanza
// para ambos breakpoints porque las clases que activa solo tienen efecto en
// su media query correspondiente (ver CONVERSACIÓN V2 en main.css).
function inicializarPanelAsunto() {
  panelVisible = window.matchMedia(PUNTO_QUIEBRE_DESKTOP).matches;
  aplicarVisibilidadPanel();
}

function aplicarVisibilidadPanel() {
  const panel = document.getElementById('panelAsunto');
  const overlay = document.getElementById('panelAsuntoOverlay');
  panel.classList.toggle('conversacion-panel--abierto', panelVisible);
  panel.classList.toggle('conversacion-panel--cerrado', !panelVisible);
  overlay.hidden = !panelVisible;
}

function abrirPanel() {
  panelVisible = true;
  aplicarVisibilidadPanel();
}

function cerrarPanel() {
  panelVisible = false;
  aplicarVisibilidadPanel();
}

// Cliente primero, luego abogado siempre (orden estable), marcando "Tú" en
// el lado que corresponde a la sesión actual.
function obtenerParticipantesParaPanel() {
  const yo = { nombre: miNombre, foto: miFoto, rol: esCliente ? 'Cliente' : 'Abogado', esYo: true };
  const otro = {
    nombre: matterActual.contraparte_nombre,
    foto: matterActual.contraparte_foto,
    rol: esCliente ? 'Abogado' : 'Cliente',
    esYo: false,
  };
  return esCliente ? [yo, otro] : [otro, yo];
}

function renderizarPanelAsunto() {
  const cerrado = matterActual.status !== 'active';
  const origenTexto = matterActual.source_type === 'tablon' ? 'El Tablón' : 'Solicitud directa';
  const urlDetalle = matterActual.source_type === 'tablon'
    ? `/pages/solicitudes-tablon?solicitud=${matterActual.source_id}`
    : `/pages/solicitudes-directas?solicitud=${matterActual.source_id}`;

  const filaCierre = matterActual.closed_at ? `
    <div class="conversacion-panel__fila">
      <dt>Cerrado</dt>
      <dd>${escaparHtml(formatearFechaCompleta(matterActual.closed_at))}</dd>
    </div>
  ` : '';

  const seccionDescripcion = matterActual.descripcion_caso ? `
    <div class="conversacion-panel__seccion">
      <p class="conversacion-panel__seccion-titulo">Descripción del caso</p>
      <p class="conversacion-panel__descripcion">${escaparHtml(matterActual.descripcion_caso)}</p>
    </div>
  ` : '';

  const participantesHtml = obtenerParticipantesParaPanel().map(p => `
    <li class="conversacion-panel__participante">
      <div class="conversacion-panel__participante-avatar">${generarAvatarHtml(p.foto, p.nombre)}</div>
      <div class="conversacion-panel__participante-datos">
        <p class="conversacion-panel__participante-nombre">
          ${escaparHtml(p.nombre)}${p.esYo ? ' <span class="badge conversacion-panel__badge-tu">Tú</span>' : ''}
        </p>
        <p class="conversacion-panel__participante-rol">${escaparHtml(p.rol)}</p>
      </div>
    </li>
  `).join('');

  document.getElementById('panelAsuntoContenido').innerHTML = `
    <dl class="conversacion-panel__lista">
      <div class="conversacion-panel__fila">
        <dt>Estado</dt>
        <dd><span class="badge ${cerrado ? 'badge--estado-cancelada' : 'badge--estado-aceptada'}">${cerrado ? 'Cerrado' : 'Activo'}</span></dd>
      </div>
      <div class="conversacion-panel__fila">
        <dt>Origen</dt>
        <dd>${escaparHtml(origenTexto)}</dd>
      </div>
      <div class="conversacion-panel__fila">
        <dt>Creado</dt>
        <dd>${escaparHtml(formatearFechaCompleta(matterActual.created_at))}</dd>
      </div>
      ${filaCierre}
    </dl>

    ${seccionDescripcion}

    <a href="${escaparAtrib(urlDetalle)}" class="btn btn--secundario btn--sm conversacion-panel__ver-detalles">
      Ver detalles completos &rarr;
    </a>

    <div class="conversacion-panel__seccion">
      <p class="conversacion-panel__seccion-titulo">Participantes</p>
      <ul class="conversacion-panel__participantes">${participantesHtml}</ul>
    </div>
  `;
}

// ─── Título editable ────────────────────────────────────────────────────────
function abrirEdicionTitulo() {
  document.getElementById('tituloBoton').hidden = true;
  const form = document.getElementById('tituloForm');
  form.hidden = false;
  const input = document.getElementById('tituloInput');
  input.value = matterActual.title || '';
  input.focus();
  input.select();
}

function cerrarEdicionTitulo() {
  document.getElementById('tituloForm').hidden = true;
  document.getElementById('tituloBoton').hidden = false;
}

async function manejarSubmitTitulo(e) {
  e.preventDefault();
  const nuevo = document.getElementById('tituloInput').value.trim();
  if (!nuevo) return;

  const { data, error } = await api.mensajes.actualizarTitulo(matterActual.matter_id, nuevo, esCliente);
  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar el título. Intente de nuevo.'));
    return;
  }

  matterActual.title = nuevo;
  document.getElementById('tituloBoton').textContent = nuevo;
  cerrarEdicionTitulo();
  toast.exito('Título actualizado.');
}

// ─── Menú de tres puntos del asunto ─────────────────────────────────────────
function manejarClickMenuAsunto(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;

  if (btn.dataset.accion === 'ver-detalles') return abrirPanel();
  if (btn.dataset.accion === 'cerrar-asunto') return manejarCerrarAsunto();
  if (btn.dataset.accion === 'solicitar-reapertura') return abrirFormularioReapertura();
  if (btn.dataset.accion === 'reportar-conversacion') {
    toast.info('Esta función estará disponible próximamente.');
    return;
  }
  if (btn.dataset.accion === 'bloquear-usuario') {
    abrirModalBloqueo(btn.dataset.nombre, btn.dataset.id);
  }
}

async function manejarCerrarAsunto() {
  const confirmado = await pedirConfirmacionCierre();
  if (!confirmado) return;

  const { error } = await api.mensajes.cerrarMatter(matterActual.matter_id);
  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo cerrar el asunto. Intente de nuevo.'));
    return;
  }

  matterActual.status = 'closed';
  matterActual.closed_at = new Date().toISOString();
  renderizarHeader();
  toast.exito('Asunto cerrado.');
}

// Modal propio (no window.confirm, CLAUDE.md §7) con el texto exacto pedido
// y un contador de 9 segundos en el botón de confirmar ("Cerrar (9)" →
// "Cerrar (8)" → ... → "Cerrar (0)", habilitado recién en 0) -- mismo patrón
// de countdown que abrirModalBloqueo/abrirModalSuspension (utils.js), pero
// como una función local: esta acción es específica de esta página, igual
// que pedirMotivoReapertura de arriba. "Cancelar" queda siempre activo.
function pedirConfirmacionCierre() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-confirmar-overlay';
    overlay.innerHTML = `
      <div class="modal-confirmar" role="alertdialog" aria-modal="true" aria-labelledby="modalCerrarAsuntoMensaje">
        <div class="modal-confirmar__mensaje" id="modalCerrarAsuntoMensaje">
          <p>¿Está seguro de que desea cerrar este asunto?</p>
          <p>Al cerrarlo:</p>
          <ul class="modal-confirmar__lista">
            <li>No podrá enviar ni recibir mensajes en esta conversación</li>
            <li>El historial de mensajes quedará disponible en modo solo lectura</li>
            <li>Si necesita retomar la comunicación, cualquiera de las dos partes puede solicitar la reapertura</li>
            <li>La reapertura requiere la aprobación de la otra parte — no es automática</li>
            <li>Si la otra parte rechaza la reapertura, el asunto permanecerá cerrado</li>
          </ul>
          <p>¿Desea continuar?</p>
        </div>
        <div class="modal-confirmar__acciones">
          <button type="button" class="btn btn--secundario btn--sm" id="modalCerrarAsuntoCancelar">Cancelar</button>
          <button type="button" class="btn btn--primario btn--sm" id="modalCerrarAsuntoConfirmar" disabled></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const btnCancelar = overlay.querySelector('#modalCerrarAsuntoCancelar');
    const btnConfirmar = overlay.querySelector('#modalCerrarAsuntoConfirmar');
    const elementoConFocoPrevio = document.activeElement;

    let segundosRestantes = SEGUNDOS_ESPERA_CIERRE;
    btnConfirmar.textContent = `Cerrar (${segundosRestantes})`;

    const intervalo = setInterval(() => {
      segundosRestantes -= 1;
      btnConfirmar.textContent = `Cerrar (${segundosRestantes})`;
      if (segundosRestantes <= 0) {
        clearInterval(intervalo);
        btnConfirmar.disabled = false;
      }
    }, 1000);

    function cerrar(resultado) {
      clearInterval(intervalo);
      overlay.remove();
      document.removeEventListener('keydown', manejarTecla);
      if (elementoConFocoPrevio instanceof HTMLElement) elementoConFocoPrevio.focus();
      resolve(resultado);
    }

    function manejarTecla(e) {
      if (e.key === 'Escape') cerrar(false);
    }

    btnCancelar.addEventListener('click', () => cerrar(false));
    btnConfirmar.addEventListener('click', () => {
      if (btnConfirmar.disabled) return;
      cerrar(true);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(false); });
    document.addEventListener('keydown', manejarTecla);

    btnCancelar.focus();
  });
}

// ─── Realtime: cambios del asunto y de sus participantes ────────────────────
// api.mensajes.escucharMatter (migración 102) despacha dos tipos de evento
// por el mismo canal: 'matter' (cierre/reapertura/título desde la otra
// parte) y 'participante' (last_read_at de cualquiera de las dos filas de
// conversation_participants de esta conversación, para los checkmarks).
function manejarEventoMatterRealtime({ tipo, payload }) {
  if (tipo === 'matter') return manejarMatterUpdateRealtime(payload);
  if (tipo === 'participante') return manejarParticipanteRealtime(payload);
}

// El payload viene de la tabla matters sin resolver (ver api.mensajes.
// escucharMatter) -- status/reopen_requested_by/reopen_reason/closed_at son
// las columnas reales, se copian directo. renderizarHeader() ya cubre el
// badge de estado, el aviso/deshabilitado del input, el banner/menú de
// reapertura y el panel lateral en un solo re-render, sin recargar la
// página ni volver a pedir el detalle.
function manejarMatterUpdateRealtime(raw) {
  matterActual.status = raw.status;
  matterActual.reopen_requested_by = raw.reopen_requested_by;
  matterActual.reopen_reason = raw.reopen_reason;
  matterActual.closed_at = raw.closed_at;
  renderizarHeader();
}

// Solo interesa la fila de la CONTRAPARTE (la propia se actualiza por mis
// propias acciones, no aporta nada al checkmark de mis mensajes) --
// contraparte_id sale de matter_detalle_view.
function manejarParticipanteRealtime(raw) {
  if (raw.user_id !== matterActual.contraparte_id) return;
  contraparteLastReadAt = raw.last_read_at;
  renderizarMensajes();
}

function manejarClickBannerAcciones(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.id === 'btnSolicitarReaperturaBanner') return abrirFormularioReapertura();
  if (btn.id === 'btnAprobarReapertura') return manejarResponderReapertura(true);
  if (btn.id === 'btnRechazarReapertura') return manejarResponderReapertura(false);
}

async function abrirFormularioReapertura() {
  const motivo = await pedirMotivoReapertura();
  if (motivo == null) return;

  const { error } = await api.mensajes.solicitarReapertura(matterActual.matter_id, motivo);
  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo solicitar la reapertura. Intente de nuevo.'));
    return;
  }

  matterActual.reopen_requested_by = miId;
  matterActual.reopen_reason = motivo;
  renderizarHeader();
  toast.exito('Solicitud de reapertura enviada.');
}

async function manejarResponderReapertura(aprobar) {
  const { error } = await api.mensajes.responderReapertura(matterActual.matter_id, aprobar);
  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo responder la solicitud de reapertura. Intente de nuevo.'));
    return;
  }

  matterActual.reopen_requested_by = null;
  if (aprobar) {
    matterActual.status = 'active';
    matterActual.closed_at = null;
  }
  renderizarHeader();
  toast.exito(aprobar ? 'Asunto reabierto.' : 'Solicitud de reapertura rechazada.');
}

// Modal propio (no window.prompt, ver CLAUDE.md §7) para pedir el motivo que
// exige fn_solicitar_reapertura. Reutiliza las clases .modal-confirmar-overlay
// / .modal-confirmar de utils.js (ya estilizadas globalmente) pero con
// lógica propia de esta página -- abrirModalSuspension() de utils.js está
// atada de fábrica a api.admin.suspenderVerificacion(), no es genérica.
function pedirMotivoReapertura() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-confirmar-overlay';
    overlay.innerHTML = `
      <div class="modal-confirmar" role="alertdialog" aria-modal="true" aria-labelledby="modalReaperturaMensaje">
        <p class="modal-confirmar__mensaje" id="modalReaperturaMensaje">¿Por qué desea reabrir este asunto?</p>
        <div class="campo">
          <label for="modalReaperturaMotivo" class="sr-only">Motivo de la reapertura</label>
          <textarea id="modalReaperturaMotivo" class="campo__input" rows="3" maxlength="300"
            placeholder="Explique brevemente por qué necesita reabrir esta conversación..."></textarea>
          <p class="campo__error" id="modalReaperturaError" role="alert" aria-live="polite"></p>
        </div>
        <div class="modal-confirmar__acciones">
          <button type="button" class="btn btn--secundario btn--sm" id="modalReaperturaCancelar">Cancelar</button>
          <button type="button" class="btn btn--primario btn--sm" id="modalReaperturaConfirmar">Solicitar reapertura</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const motivo = overlay.querySelector('#modalReaperturaMotivo');
    const error = overlay.querySelector('#modalReaperturaError');
    const btnCancelar = overlay.querySelector('#modalReaperturaCancelar');
    const btnConfirmar = overlay.querySelector('#modalReaperturaConfirmar');

    function cerrar(resultado) {
      overlay.remove();
      document.removeEventListener('keydown', manejarTecla);
      resolve(resultado);
    }

    function manejarConfirmar() {
      if (!motivo.value.trim()) {
        error.textContent = 'Indique el motivo de la reapertura.';
        motivo.focus();
        return;
      }
      cerrar(motivo.value.trim());
    }

    function manejarTecla(e) {
      if (e.key === 'Escape') cerrar(null);
    }

    btnCancelar.addEventListener('click', () => cerrar(null));
    btnConfirmar.addEventListener('click', manejarConfirmar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(null); });
    document.addEventListener('keydown', manejarTecla);

    motivo.focus();
  });
}

// ─── Carga inicial y paginación por cursor ──────────────────────────────────
async function cargarMensajesIniciales() {
  const { data, error } = await api.mensajes.getConversacion(conversationId);

  if (error) {
    toast.error('No se pudieron cargar los mensajes. Intente recargar la página.');
    mensajesActuales = [];
  } else {
    mensajesActuales = data;
  }

  hayMasAntiguos = mensajesActuales.length === 25;
  renderizarMensajes();
}

async function cargarMensajesAnteriores() {
  if (cargandoAnteriores || !hayMasAntiguos || mensajesActuales.length === 0) return;
  cargandoAnteriores = true;

  const btn = document.getElementById('btnCargarAnteriores');
  btn.disabled = true;
  btn.textContent = 'Cargando...';

  const masAntiguo = mensajesActuales[0];
  const { data, error } = await api.mensajes.getConversacion(conversationId, {
    created_at: masAntiguo.created_at,
    id: masAntiguo.id,
  });

  cargandoAnteriores = false;
  btn.disabled = false;
  btn.textContent = 'Cargar mensajes anteriores';

  if (error) {
    toast.error('No se pudieron cargar mensajes anteriores. Intente de nuevo.');
    return;
  }

  hayMasAntiguos = data.length === 25;

  // Preserva la posición de scroll: sin esto, prepender contenido arriba
  // empuja hacia abajo todo lo que el usuario ya estaba mirando.
  const contenedor = document.getElementById('conversacionMensajes');
  const alturaAntes = contenedor.scrollHeight;
  const scrollAntes = contenedor.scrollTop;

  mensajesActuales = [...data, ...mensajesActuales];
  renderizarMensajes();

  contenedor.scrollTop = scrollAntes + (contenedor.scrollHeight - alturaAntes);
}

// ─── Render de la lista de mensajes ──────────────────────────────────────────
// Inserta una píldora separadora de fecha ("Hoy" / "Ayer" / "22 de agosto de
// 2026") cada vez que el día del mensaje cambia respecto al anterior --
// recalculado desde cero en cada render, mismo criterio que el resto de la
// página (re-render completo de la lista, sin diffing incremental).
function renderizarMensajes() {
  let html = '';
  let fechaClaveAnterior = null;

  for (const m of mensajesActuales) {
    const fechaClave = new Date(m.created_at).toDateString();
    if (fechaClave !== fechaClaveAnterior) {
      html += generarSeparadorFechaHtml(m.created_at);
      fechaClaveAnterior = fechaClave;
    }
    html += generarBurbujaHtml(m);
  }

  document.getElementById('listaMensajes').innerHTML = html;
  document.getElementById('btnCargarAnteriores').hidden = !hayMasAntiguos;
}

function generarSeparadorFechaHtml(fechaIso) {
  return `<div class="conversacion-separador-fecha" role="separator"><span>${escaparHtml(formatearFechaSeparador(fechaIso))}</span></div>`;
}

function generarBurbujaHtml(m) {
  if (mensajeEnEdicionId === m.id) return generarEdicionHtml(m);

  const esPropio = m.sender_id === miId;
  const idSeguro = escaparAtrib(m.id);
  const eliminadoPropio = m.is_deleted && esPropio;
  // A diferencia de eliminadoPropio, esta etiqueta ya no se restringe a
  // esPropio: messages_view (migración 20260818_100) ahora resuelve
  // edited_body para ambas partes, así que quien recibe un mensaje editado
  // también debe ver la marca "(editado)" -- de lo contrario vería el texto
  // ya editado sin ningún indicio de que cambió desde el envío original.
  const editadoTag = (m.is_edited && !m.is_deleted)
    ? ' <span class="mensaje-burbuja__editado">(editado)</span>'
    : '';
  const checkHtml = esPropio ? generarCheckHtml(calcularEstadoLectura(m)) : '';

  return `
    <div class="mensaje-burbuja ${esPropio ? 'mensaje-burbuja--propia' : 'mensaje-burbuja--otro'}" data-id="${idSeguro}">
      <div class="mensaje-burbuja__contenido${eliminadoPropio ? ' mensaje-burbuja--eliminado' : ''}">${escaparHtml(m.body)}</div>
      <p class="mensaje-burbuja__meta">${escaparHtml(m.sender_name)} · ${formatearHora(m.created_at)}${editadoTag}${checkHtml}</p>
    </div>
  `;
}

function generarEdicionHtml(m) {
  const idSeguro = escaparAtrib(m.id);
  return `
    <div class="mensaje-burbuja mensaje-burbuja--propia" data-id="${idSeguro}">
      <div class="mensaje-burbuja__edicion">
        <label for="edicion-${idSeguro}" class="sr-only">Editar mensaje</label>
        <textarea id="edicion-${idSeguro}" class="mensaje-burbuja__edicion-textarea" data-id="${idSeguro}" maxlength="2000">${escaparHtml(m.body)}</textarea>
        <div class="mensaje-burbuja__edicion-acciones">
          <button type="button" class="btn btn--secundario btn--sm" data-accion="cancelar-edicion" data-id="${idSeguro}">
            Cancelar
          </button>
          <button type="button" class="btn btn--primario btn--sm" data-accion="guardar-edicion" data-id="${idSeguro}">
            Guardar
          </button>
        </div>
      </div>
    </div>
  `;
}

function manejarClickLista(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;
  const { accion, id } = btn.dataset;

  if (accion === 'cancelar-edicion') {
    mensajeEnEdicionId = null;
    renderizarMensajes();
  }
  if (accion === 'guardar-edicion') manejarGuardarEdicion(id);
}

function iniciarEdicionMensaje(messageId) {
  mensajeEnEdicionId = messageId;
  renderizarMensajes();
  document.getElementById(`edicion-${messageId}`)?.focus();
}

async function manejarGuardarEdicion(messageId) {
  const textarea = document.getElementById(`edicion-${messageId}`);
  const nuevoTexto = textarea.value.trim();
  if (!nuevoTexto) return;

  const { data, error } = await api.mensajes.editarMensaje(messageId, nuevoTexto);
  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo editar el mensaje. Intente de nuevo.'));
    return;
  }

  const entrada = mensajesActuales.find(m => m.id === messageId);
  if (entrada) {
    entrada.body = data.edited_body;
    entrada.is_edited = true;
  }
  mensajeEnEdicionId = null;
  renderizarMensajes();
  toast.exito('Mensaje editado.');
}

async function manejarEliminarMensaje(messageId) {
  const confirmado = await confirmar('¿Eliminar este mensaje? Esta acción no se puede deshacer.');
  if (!confirmado) return;

  const { error } = await api.mensajes.eliminarMensaje(messageId);
  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo eliminar el mensaje. Intente de nuevo.'));
    return;
  }

  const entrada = mensajesActuales.find(m => m.id === messageId);
  if (entrada) {
    entrada.is_deleted = true;
    entrada.body = 'Este mensaje fue eliminado';
  }
  renderizarMensajes();
  toast.exito('Mensaje eliminado.');
}

function puedeEditar(m) {
  return Date.now() - new Date(m.created_at).getTime() < VENTANA_EDICION_MS;
}

// ─── Indicadores de lectura (checkmarks) de burbujas propias ───────────────
// 'entregado' (✓✓ gris) es el mínimo posible para cualquier mensaje que
// llega a renderizarse: no hay burbuja optimista en esta página (ver
// manejarEnviar) -- por el momento en que un mensaje propio existe en
// mensajesActuales, ya fue confirmado por Postgres. 'leido' (✓✓ azul) se
// alcanza cuando el last_read_at de la contraparte es posterior al
// created_at del mensaje. El estado 'enviado' (✓ gris, un solo check) queda
// contemplado en generarCheckHtml() para un futuro envío optimista, pero
// con el flujo actual nunca se produce -- por eso no aparece acá.
function calcularEstadoLectura(mensaje) {
  if (!contraparteLastReadAt) return 'entregado';
  return new Date(mensaje.created_at) <= new Date(contraparteLastReadAt) ? 'leido' : 'entregado';
}

function generarCheckHtml(estado) {
  const etiquetas = { enviado: 'Enviado', entregado: 'Entregado', leido: 'Leído' };
  const svg = estado === 'enviado' ? SVG_CHECK_UNO : SVG_CHECK_DOBLE;
  return `<span class="mensaje-burbuja__check mensaje-burbuja__check--${estado}" aria-label="${etiquetas[estado]}" title="${etiquetas[estado]}">${svg}</span>`;
}

// ─── Menú contextual de burbuja propia (clic derecho / long-press) ─────────
function manejarContextMenu(e) {
  const burbuja = e.target.closest('.mensaje-burbuja--propia');
  if (!burbuja) return;
  e.preventDefault();
  abrirMenuContextual(burbuja.dataset.id, e.clientX, e.clientY);
}

function manejarTouchStart(e) {
  const burbuja = e.target.closest('.mensaje-burbuja--propia');
  if (!burbuja) return;
  const toque = e.touches[0];
  longPressTimer = setTimeout(() => {
    abrirMenuContextual(burbuja.dataset.id, toque.clientX, toque.clientY);
    longPressTimer = null;
  }, DURACION_LONG_PRESS_MS);
}

function cancelarLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function abrirMenuContextual(messageId, x, y) {
  const mensaje = mensajesActuales.find(m => m.id === messageId);
  if (!mensaje || mensaje.is_deleted) return;

  const menu = document.getElementById('menuContextualMensaje');
  const itemEditar = menu.querySelector('[data-accion="editar-mensaje"]').closest('li');
  itemEditar.hidden = !puedeEditar(mensaje);
  menu.dataset.id = messageId;

  menu.hidden = false;
  const anchoMenu = menu.offsetWidth || 170;
  const altoMenu = menu.offsetHeight || 90;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - anchoMenu - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - altoMenu - 8))}px`;
}

function cerrarMenuContextual() {
  document.getElementById('menuContextualMensaje').hidden = true;
}

function manejarClickMenuContextual(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;
  const messageId = document.getElementById('menuContextualMensaje').dataset.id;
  cerrarMenuContextual();

  if (btn.dataset.accion === 'editar-mensaje') return iniciarEdicionMensaje(messageId);
  if (btn.dataset.accion === 'eliminar-mensaje') return manejarEliminarMensaje(messageId);
}

// ─── Scroll y "N mensajes nuevos" ────────────────────────────────────────────
function manejarScrollMensajes() {
  estaEnElFondo = estaScrollEnElFondo();
  if (estaEnElFondo) ocultarBadgeNuevos();
}

function estaScrollEnElFondo() {
  const el = document.getElementById('conversacionMensajes');
  return el.scrollHeight - el.scrollTop - el.clientHeight < UMBRAL_FONDO_PX;
}

function desplazarAlFondo(instantaneo = false) {
  const el = document.getElementById('conversacionMensajes');
  el.scrollTo({ top: el.scrollHeight, behavior: instantaneo ? 'auto' : 'smooth' });
}

function mostrarBadgeNuevos() {
  mensajesNuevosNoVistos += 1;
  const badge = document.getElementById('badgeNuevosMensajes');
  badge.textContent = `${mensajesNuevosNoVistos} ${mensajesNuevosNoVistos === 1 ? 'mensaje nuevo' : 'mensajes nuevos'} ↓`;
  badge.hidden = false;
}

function ocultarBadgeNuevos() {
  mensajesNuevosNoVistos = 0;
  document.getElementById('badgeNuevosMensajes').hidden = true;
}

function manejarClickBadgeNuevos() {
  desplazarAlFondo();
  ocultarBadgeNuevos();
}

// ─── Realtime: mensajes nuevos ──────────────────────────────────────────────
// El payload viene de la tabla messages sin resolver (ver api.mensajes.escuchar)
// -- se completa acá con sender_name/sender_photo, que ya se conocen (soy yo
// o es la contraparte de matterActual) sin otra consulta.
function manejarMensajeRealtime(raw) {
  if (mensajesActuales.some(m => m.id === raw.id)) return; // deduplicar por id

  mensajesActuales.push(normalizarMensajeRealtime(raw));
  renderizarMensajes();

  if (estaEnElFondo) {
    desplazarAlFondo();
  } else {
    mostrarBadgeNuevos();
  }

  api.mensajes.marcarLeido(conversationId);
  suprimirNotificacionSiCorresponde(raw);
}

// Parte 9: si la pestaña está activa y visible y el mensaje es de la
// contraparte (no un eco del propio envío), el usuario ya lo está viendo en
// pantalla -- se descarta en silencio la notificación de "mensaje nuevo"
// correspondiente (sin toast ni badge, es limpieza de fondo). Si la pestaña
// está en segundo plano o minimizada, se deja la notificación intacta.
function suprimirNotificacionSiCorresponde(raw) {
  if (raw.sender_id === miId) return;
  if (document.visibilityState !== 'visible') return;

  api.notificaciones.marcarLeidaPorUrl(`/pages/conversacion?id=${conversationId}`, 'mensaje_nuevo');
}

function normalizarMensajeRealtime(raw) {
  const esPropio = raw.sender_id === miId;
  return {
    id: raw.id,
    conversation_id: raw.conversation_id,
    sender_id: raw.sender_id,
    sender_name: esPropio ? miNombre : matterActual.contraparte_nombre,
    sender_photo: esPropio ? miFoto : matterActual.contraparte_foto,
    body: raw.body,
    is_edited: false,
    is_deleted: false,
    created_at: raw.created_at,
  };
}

// ─── Input de mensaje ────────────────────────────────────────────────────────
function manejarInputMensaje() {
  const textarea = document.getElementById('inputMensaje');
  const contador = document.getElementById('contadorMensaje');
  const longitud = textarea.value.length;

  contador.textContent = `${longitud} / 2000`;
  contador.classList.toggle('conversacion-input__contador--limite', longitud > 1800);

  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;

  actualizarEstadoBotonEnviar();
}

function actualizarEstadoBotonEnviar() {
  const textarea = document.getElementById('inputMensaje');
  const vacio = !textarea.value.trim();
  const cerrado = matterActual.status !== 'active';
  document.getElementById('btnEnviar').disabled = vacio || cerrado || enviando;
}

function manejarKeydownMensaje(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('formEnviar').requestSubmit();
  }
}

async function manejarEnviar(e) {
  e.preventDefault();
  if (enviando) return;

  const textarea = document.getElementById('inputMensaje');
  const texto = textarea.value.trim();
  if (!texto) return;

  const errorEl = document.getElementById('errorEnviar');
  errorEl.textContent = '';

  enviando = true;
  actualizarEstadoBotonEnviar();
  document.getElementById('btnEnviarTexto').hidden = true;
  document.getElementById('btnEnviarSpinner').hidden = false;

  const { error } = await api.mensajes.enviar(conversationId, texto);

  enviando = false;
  document.getElementById('btnEnviarTexto').hidden = false;
  document.getElementById('btnEnviarSpinner').hidden = true;

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo enviar el mensaje. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    actualizarEstadoBotonEnviar();
    return; // el texto escrito no se pierde -- el usuario puede reintentar
  }

  // Sin burbuja optimista: se espera el eco de Realtime (mismo criterio que
  // el chat anterior) para no duplicar la burbuja cuando llegue el INSERT.
  textarea.value = '';
  manejarInputMensaje();
  textarea.focus();
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

function formatearHora(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  return `${hora}:${minutos}`;
}

// "Hoy" / "Ayer" / "22 de agosto de 2026" -- separador de fecha entre
// mensajes de días distintos.
function formatearFechaSeparador(fechaIso) {
  const fecha = new Date(fechaIso);
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);

  if (esMismoDia(fecha, hoy)) return 'Hoy';
  if (esMismoDia(fecha, ayer)) return 'Ayer';
  return new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'long', year: 'numeric' }).format(fecha);
}

function esMismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "22 de agosto de 2026, 14:32" -- fechas del panel lateral (creado/cerrado).
function formatearFechaCompleta(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  const fechaTexto = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'long', year: 'numeric' }).format(fecha);
  return `${fechaTexto}, ${formatearHora(fechaIso)}`;
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
