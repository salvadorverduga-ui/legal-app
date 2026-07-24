// panel-abogado.js
// Lógica de la página panel-abogado.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, generarCheckboxSeguimiento, generarMenuTarjeta, inicializarMenuTarjeta, abrirModalBloqueo, MENSAJE_AGREGADO_SEGUIMIENTO } from './utils.js';
import { inicializarHeader } from './header.js';

// ─── Etiquetas y estilos por estado ───────────────────────────────────────────
const ETIQUETAS_ESTADO_SOLICITUD = {
  PENDIENTE:  'Pendiente',
  ACEPTADA:   'Aceptada',
  COMPLETADA: 'Completada',
  'RESEÑADA': 'Reseñada',
  RECHAZADA:  'Rechazada',
  EXPIRADA:   'Expirada',
  CANCELADA:  'Cancelada por el cliente',
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

const ETIQUETAS_VERIFICACION = {
  VERIFICADO: { texto: 'Verificado',              clase: 'badge--verificado' },
  PENDIENTE:  { texto: 'Verificación pendiente',  clase: 'badge--pendiente' },
  RECHAZADO:  { texto: 'Verificación rechazada',  clase: 'badge--rechazado' },
};

const ETIQUETAS_TIPO_SUSCRIPCION = {
  ABOGADO_INDIVIDUAL: 'Abogado individual',
  ESTUDIO_PEQUENO:    'Estudio pequeño',
  ESTUDIO_MEDIANO:    'Estudio mediano',
  ESTUDIO_GRANDE:     'Estudio grande',
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

const SECCIONES = ['Inicio', 'Solicitudes', 'Resenas', 'Suscripcion', 'Seguimiento'];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;         // fila propia de la tabla perfiles
let abogadoActual = null;        // fila propia de la tabla abogados
let estadoVerificacionActual = null; // fila más reciente de verificaciones (o null)
let solicitudesActuales = [];    // caché local: cuenta de pendientes en Inicio y estado de seguimiento

// ─── Entry point ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  // 1. Inicializar Supabase con la configuración de /api/config
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[panel-abogado] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  // 2. Verificar autenticación — redirigir si no hay sesión
  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  // 3. Verificar rol — este panel es solo para abogados
  perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || perfilActual.rol !== 'abogado') {
    window.location.href = '/';
    return;
  }

  // 4. Cargar la fila propia de abogados (no la vista pública, que oculta perfiles no visibles)
  //    y el estado de verificación (para el banner de documentos pendientes) en paralelo.
  [abogadoActual, estadoVerificacionActual] = await Promise.all([
    api.abogados.getPerfilPropio(),
    api.abogados.getEstadoVerificacion(),
  ]);
  if (!abogadoActual) {
    mostrarError();
    return;
  }

  const urlPerfilPublico = `/pages/perfil-abogado?id=${abogadoActual.id}`;
  inicializarHeader({
    rol: 'abogado',
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico,
  });

  renderizarCabecera();
  renderizarSaludoInicio();
  document.getElementById('inicioVerPerfilPublico').href = urlPerfilPublico;
  actualizarBanners();

  const [resenas, casosTablon, misSeguimientos] = await Promise.all([
    api.resenas.getResenasAbogado(abogadoActual.id),
    api.tablon.getCasosActivos(),
    api.seguimiento.getMisSeguimientos(),
    cargarSolicitudes(),
    cargarSuscripcion(),
  ]);
  renderizarResenas(resenas);
  renderizarResumenInicio(resenas.length, casosTablon);
  renderizarSeguimiento(misSeguimientos);

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

  document.querySelectorAll('.js-toggle-disponible').forEach(el => {
    el.addEventListener('change', manejarToggleDisponible);
  });

  document.getElementById('seccionSeguimiento').addEventListener('click', manejarClickSeguimiento);
  inicializarMenuTarjeta();
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

// ─── Cabecera: identidad, verificación y disponibilidad ──────────────────────
function renderizarCabecera() {
  document.getElementById('cabeceraAvatar').innerHTML = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);

  document.getElementById('cabeceraNombre').textContent = perfilActual.nombre_completo;

  const estadoVerificacion = ETIQUETAS_VERIFICACION[abogadoActual.verificacion] ?? ETIQUETAS_VERIFICACION.PENDIENTE;
  const badgePerfilCompletoHtml = calcularPorcentajePerfil() === 100
    ? '<span class="badge badge--verificado">Perfil completo &#10003;</span>'
    : '';
  document.getElementById('cabeceraBadges').innerHTML =
    `<span class="badge ${estadoVerificacion.clase}">${estadoVerificacion.texto}</span>${badgePerfilCompletoHtml}`;

  document.querySelectorAll('.js-toggle-disponible').forEach(el => {
    el.checked = abogadoActual.toggle_disponible;
  });
  actualizarEtiquetaDisponible(abogadoActual.toggle_disponible);
}

// El toggle vive tanto en la cabecera (visible en todas las pestañas) como en
// la pestaña Inicio; ambos controles se mantienen sincronizados por clase.
function actualizarEtiquetaDisponible(disponible) {
  const texto = disponible ? 'Disponible' : 'No disponible';
  document.querySelectorAll('.js-toggle-disponible-etiqueta').forEach(el => {
    el.textContent = texto;
  });
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

function renderizarResumenInicio(resenasTotales, casosTablon) {
  const pendientes = solicitudesActuales.filter(s => s.estado === 'PENDIENTE').length;

  const especialidadesPropias = new Set(abogadoActual.especialidades ?? []);
  const casosDeSuEspecialidad = (casosTablon ?? []).filter(c => especialidadesPropias.has(c.especialidad)).length;

  document.getElementById('inicioSolicitudesPendientes').textContent = String(pendientes);
  document.getElementById('inicioCasosTablon').textContent = String(casosDeSuEspecialidad);
  document.getElementById('inicioResenasTotales').textContent = String(resenasTotales);
}

// ─── Banners: vencimiento de suscripción, documentos y onboarding ────────────
function actualizarBanners() {
  actualizarBannerSuscripcion();
  actualizarBannerVerificacionDocumentos();
  actualizarBannerOnboarding();
}

function actualizarBannerSuscripcion() {
  const banner = document.getElementById('bannerSuscripcion');
  const vigenteHasta = abogadoActual.suscripcion_vigente_hasta;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  // El perfil sigue siendo visible durante el período de gracia de 4 días tras el
  // vencimiento (CLAUDE.md §6) — el banner solo debe aparecer cuando ya no lo es.
  const finGracia = vigenteHasta ? new Date(`${vigenteHasta}T00:00:00`) : null;
  if (finGracia) finGracia.setDate(finGracia.getDate() + 4);
  const suscripcionInactiva = !vigenteHasta || finGracia < hoy;

  if (!suscripcionInactiva) {
    banner.hidden = true;
    return;
  }

  document.getElementById('bannerSuscripcionTexto').textContent =
    'Su suscripción no está activa. Su perfil no es visible para los clientes.';
  banner.hidden = false;
}

// Documentos de identidad no subidos: la fila PENDIENTE se crea vacía al
// registrarse (migración 20260725_061), así que esta condición detecta tanto
// al abogado que nunca los subió como al que aún no confirmó/ingresó.
function actualizarBannerVerificacionDocumentos() {
  const banner = document.getElementById('bannerVerificacionDocumentos');
  const faltanDocumentos = abogadoActual.verificacion === 'PENDIENTE'
    && !estadoVerificacionActual?.doc_carnet_url;
  banner.hidden = !faltanDocumentos;
}

function actualizarBannerOnboarding() {
  const banner = document.getElementById('bannerOnboarding');
  banner.hidden = calcularPorcentajePerfil() === 100;
}

async function manejarToggleDisponible() {
  const controles = document.querySelectorAll('.js-toggle-disponible');
  const estadoEl = document.getElementById('toggleDisponibleEstado');

  controles.forEach(el => { el.disabled = true; });
  estadoEl.textContent = '';

  const { toggle_disponible, error } = await api.abogados.toggleDisponible();

  if (error) {
    controles.forEach(el => { el.checked = abogadoActual.toggle_disponible; });
    const mensaje = mensajeAmigable(error, 'No se pudo actualizar la disponibilidad. Intente de nuevo.');
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
  } else {
    abogadoActual.toggle_disponible = toggle_disponible;
    controles.forEach(el => { el.checked = toggle_disponible; });
    actualizarEtiquetaDisponible(toggle_disponible);
    toast.info(toggle_disponible ? 'Ahora está disponible.' : 'Ahora no está disponible.');
  }

  controles.forEach(el => { el.disabled = false; });
}

// 5 campos = 20% cada uno: foto, descripción, especialidades, precio, provincia.
// Se mantiene acá (duplicado de editar-perfil-abogado.js) porque alimenta el
// badge "Perfil completo" de la cabecera y el banner de onboarding — ninguno
// de los dos vive en la página de edición del perfil.
function calcularPorcentajePerfil() {
  const campos = [
    Boolean(perfilActual.foto_url),
    Boolean(abogadoActual.descripcion?.trim()),
    (abogadoActual.especialidades ?? []).length > 0,
    abogadoActual.precio_consulta != null,
    Boolean(abogadoActual.provincia_id),
  ];
  return campos.filter(Boolean).length * 20;
}

// ─── Solicitudes ──────────────────────────────────────────────────────────────
// Solo alimenta el conteo de pendientes en Inicio y la caché usada por el
// toggle de seguimiento — el listado y las acciones (aceptar/rechazar) viven
// ahora en solicitudes-directas.html/solicitudes-tablon.html (ver CLAUDE.md §17/módulo 1).
async function cargarSolicitudes() {
  solicitudesActuales = await api.solicitudes.getSolicitudesAbogado();
}

function generarSolicitudCard(s) {
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

  // Menú de tres puntos: única opción hoy es "Bloquear cliente" (CLAUDE.md
  // módulo 3 de la ronda de fixes — reemplaza al link de texto suelto).
  const menuHtml = generarMenuTarjeta([
    { texto: 'Bloquear cliente', accion: 'bloquear-cliente', id: escaparAtrib(s.cliente_id), dataNombre: escaparAtrib(s.cliente_nombre) },
  ]);

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
      ${accionesHtml}
      ${seguimientoHtml}
    </article>
  `;
}

function actualizarSolicitudLocal(id, datosActualizados) {
  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, datosActualizados);
}

function manejarClickSeguimiento(e) {
  const btnSeguimiento = e.target.closest('[data-accion="toggle-seguimiento"]');
  if (btnSeguimiento) {
    manejarToggleSeguimiento(btnSeguimiento.dataset.id);
    return;
  }

  const btnBloquear = e.target.closest('[data-accion="bloquear-cliente"]');
  if (btnBloquear) manejarBloquearCliente(btnBloquear.dataset.id, btnBloquear.dataset.nombre);
}

async function manejarBloquearCliente(clienteId, nombreCliente) {
  const bloqueado = await abrirModalBloqueo(nombreCliente, clienteId);
  if (!bloqueado) return;

  // La solicitud fue cancelada automáticamente por el trigger de bloqueos —
  // se refresca desde el servidor en vez de intentar adivinar el nuevo
  // estado local (no tenemos el id de la solicitud acá, solo el del cliente).
  const misSeguimientos = await api.seguimiento.getMisSeguimientos();
  renderizarSeguimiento(misSeguimientos);
}

async function manejarToggleSeguimiento(id) {
  const { data, error } = await api.seguimiento.toggleSolicitud(id, 'abogado');

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar el seguimiento. Intente de nuevo.'));
    return;
  }

  actualizarSolicitudLocal(id, data);

  const misSeguimientos = await api.seguimiento.getMisSeguimientos();
  renderizarSeguimiento(misSeguimientos);

  toast.info(data.en_seguimiento_abogado ? MENSAJE_AGREGADO_SEGUIMIENTO : 'Quitado de seguimiento.');
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
  const respuestaHtml = r.respuesta_abogado
    ? `
      <div class="resena-item__respuesta">
        <p class="resena-item__respuesta-titulo">Su respuesta</p>
        <p>${escaparHtml(r.respuesta_abogado)}</p>
      </div>
    `
    : '';

  return `
    <article class="resena-item">
      <div class="resena-item__header">
        <div class="resena-item__avatar" aria-hidden="true">
          <div class="avatar-placeholder">${escaparHtml(obtenerIniciales(r.cliente_nombre))}</div>
        </div>
        <div class="resena-item__meta">
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

// ─── Mi suscripción ───────────────────────────────────────────────────────────
async function cargarSuscripcion() {
  const suscripcion = await api.suscripciones.getSuscripcionActual();
  renderizarSuscripcion(suscripcion);
}

function renderizarSuscripcion(suscripcion) {
  const contenedor = document.getElementById('tarjetaSuscripcion');

  if (!suscripcion) {
    contenedor.innerHTML = `
      <span class="badge badge--pendiente">Sin suscripción activa</span>
      <p class="tarjeta-suscripcion__dato">
        Aún no tiene una suscripción registrada. Comuníquese con el administrador para activar su plan.
      </p>
    `;
    return;
  }

  // Comparación solo para el mensaje visual; la visibilidad real la controla el RLS del servidor.
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vencimiento = new Date(`${suscripcion.fecha_vencimiento}T00:00:00`);
  const diasDesdeVencimiento = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));

  let estadoVisual;
  if (diasDesdeVencimiento <= 0) {
    estadoVisual = { texto: 'Vigente', clase: 'badge--verificado' };
  } else if (diasDesdeVencimiento <= 4) {
    estadoVisual = { texto: 'En período de gracia', clase: 'badge--pendiente' };
  } else {
    estadoVisual = { texto: 'Vencida', clase: 'badge--rechazado' };
  }

  const avisoGraciaHtml = estadoVisual.texto === 'En período de gracia'
    ? '<p class="tarjeta-suscripcion__dato">Su perfil dejará de aparecer en búsquedas si no renueva antes de que termine el período de gracia.</p>'
    : '';

  contenedor.innerHTML = `
    <span class="badge ${estadoVisual.clase}">${estadoVisual.texto}</span>
    <p class="tarjeta-suscripcion__plan">${escaparHtml(ETIQUETAS_TIPO_SUSCRIPCION[suscripcion.tipo] ?? suscripcion.tipo)}</p>
    <p class="tarjeta-suscripcion__dato">Vence el ${formatearFecha(suscripcion.fecha_vencimiento)}</p>
    <p class="tarjeta-suscripcion__dato">Monto: $${escaparHtml(String(suscripcion.monto))}</p>
    ${avisoGraciaHtml}
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
      <span class="rating__count">Sin reseñas</span>
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
