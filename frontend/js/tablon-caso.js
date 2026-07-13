// tablon-caso.js
// Lógica de la página tablon-caso.html: detalle de un caso puntual de El
// Tablón, con vista distinta según el rol (cliente dueño del caso, o
// abogado). Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, rutaPanelPropio } from './utils.js';
import { inicializarNotificaciones } from './notificaciones.js';
import { inicializarMenuPerfil } from './menu-perfil.js';

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

const ETIQUETAS_ESTADO_APLICACION = {
  PENDIENTE: 'Pendiente',
  ELEGIDO:   'Elegido — datos revelados',
  RECHAZADO: 'Rechazado',
};

const CLASE_ESTADO_APLICACION = {
  PENDIENTE: 'badge--estado-pendiente',
  ELEGIDO:   'badge--estado-aceptada',
  RECHAZADO: 'badge--estado-rechazada',
};

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;
let casoId = null;
let casoActual = null;
let aplicacionesActuales = [];   // solo vista cliente

// ─── Entry point ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[tablon-caso] Error al cargar configuración:', err);
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

  casoId = new URLSearchParams(window.location.search).get('id');
  if (!casoId) {
    mostrarError();
    return;
  }

  casoActual = await api.tablon.getCasoDetalle(casoId);
  if (!casoActual) {
    mostrarError();
    return;
  }

  document.getElementById('logoHeader').href = rutaPanelPropio(perfilActual.rol);

  let urlPerfilPublico;
  if (perfilActual.rol === 'abogado') {
    const abogadoActual = await api.abogados.getPerfilPropio();
    urlPerfilPublico = abogadoActual ? `/pages/perfil-abogado?id=${abogadoActual.id}` : undefined;
  }
  inicializarMenuPerfil({
    rol: perfilActual.rol,
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico,
  });
  inicializarNotificaciones();

  renderizarCaso();

  if (perfilActual.rol === 'cliente') {
    document.getElementById('vistaClienteCaso').hidden = false;
    await cargarAplicaciones();
  } else {
    document.getElementById('vistaAbogadoCaso').hidden = false;
    renderizarVistaAbogado();
  }

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
  if (perfilActual.rol === 'cliente') {
    document.getElementById('btnCerrarCaso').addEventListener('click', manejarCerrarCaso);
    document.getElementById('aplicacionesLista').addEventListener('click', manejarClickAplicaciones);
  } else {
    document.getElementById('mensajeAplicar').addEventListener('input', (e) => {
      document.getElementById('contadorAplicar').textContent = `${e.target.value.length} / 300`;
    });
    document.getElementById('formAplicar').addEventListener('submit', manejarSubmitAplicar);
  }
}

// ─── Caso: datos comunes ──────────────────────────────────────────────────────
function renderizarCaso() {
  const c = casoActual;
  const claseEstado = CLASE_ESTADO_CASO[c.estado] ?? 'badge--estado-expirada';
  const etiquetaEstado = ETIQUETAS_ESTADO_CASO[c.estado] ?? c.estado;

  document.getElementById('casoTitulo').textContent = c.titulo;
  document.getElementById('casoEstadoBadge').textContent = etiquetaEstado;
  document.getElementById('casoEstadoBadge').className = `badge ${claseEstado}`;

  const metaPartes = [formatearFecha(c.created_at), c.especialidad, c.cliente_nombre].filter(Boolean);
  document.getElementById('casoMeta').textContent = metaPartes.join(' · ');

  document.getElementById('casoDescripcion').textContent = c.descripcion;

  if (c.caso_comun) {
    document.getElementById('casoCasoComun').hidden = false;
    document.getElementById('casoCasoComunValor').textContent = c.caso_comun;
  }

  const ubicacion = [c.provincia, c.ciudad].filter(Boolean).join(', ');
  if (ubicacion) {
    document.getElementById('casoUbicacion').hidden = false;
    document.getElementById('casoUbicacionValor').textContent = ubicacion;
  }

  if (c.estado === 'ACTIVO') {
    document.getElementById('casoTiempoRestante').hidden = false;
    document.getElementById('casoTiempoRestante').textContent = formatearTiempoRestanteCaso(c.expires_at);
  }
}

function formatearTiempoRestanteCaso(expiresAtIso) {
  if (!expiresAtIso) return '';
  const diasRestantes = Math.ceil((new Date(expiresAtIso).getTime() - Date.now()) / 86400000);
  if (diasRestantes <= 0) return 'Expira hoy.';
  return `Expira en ${diasRestantes} ${diasRestantes === 1 ? 'día' : 'días'}.`;
}

// ─── Vista cliente: aplicaciones recibidas ────────────────────────────────────
async function cargarAplicaciones() {
  aplicacionesActuales = await api.tablon.getAplicaciones(casoId);
  renderizarAplicaciones();

  const btnCerrar = document.getElementById('btnCerrarCaso');
  btnCerrar.hidden = casoActual.estado !== 'ACTIVO';
}

function renderizarAplicaciones() {
  const contenedor = document.getElementById('aplicacionesLista');
  const vacio = document.getElementById('estadoSinAplicaciones');

  if (aplicacionesActuales.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = aplicacionesActuales.map(generarAplicacionCard).join('');
}

function generarAplicacionCard(ap) {
  const idSeguro = escaparAtrib(ap.id);
  const abogadoIdSeguro = escaparAtrib(ap.abogado_id);
  const avatarHtml = generarAvatarHtml(ap.abogado_foto, ap.abogado_nombre);
  const claseEstado = CLASE_ESTADO_APLICACION[ap.estado] ?? 'badge--estado-pendiente';
  const etiquetaEstado = ETIQUETAS_ESTADO_APLICACION[ap.estado] ?? ap.estado;

  const especialidadesHtml = (ap.abogado_especialidades ?? []).length
    ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Especialidades:</span> ${escaparHtml(ap.abogado_especialidades.join(', '))}</p>`
    : '';

  const mensajeHtml = ap.mensaje
    ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Mensaje:</span> ${escaparHtml(ap.mensaje)}</p>`
    : '';

  const puedeElegir = ap.estado === 'PENDIENTE' && casoActual.estado === 'ACTIVO';
  const accionesHtml = puedeElegir ? `
    <div class="solicitud-item__acciones">
      <button class="btn btn--primario btn--sm" type="button" data-accion="elegir" data-id="${idSeguro}">
        Elegir a este abogado
      </button>
    </div>
  ` : '';

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div class="solicitud-item__cliente">
          <div class="solicitud-item__avatar">${avatarHtml}</div>
          <div>
            <p class="solicitud-item__nombre"><a href="/pages/perfil-abogado?id=${abogadoIdSeguro}">${escaparHtml(ap.abogado_nombre)}</a></p>
            <p class="solicitud-item__fecha">${formatearFecha(ap.created_at)} · ${generarEstrellasTexto(ap.abogado_rating, ap.abogado_total_resenas)}</p>
          </div>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      ${especialidadesHtml}
      ${mensajeHtml}
      ${accionesHtml}
    </article>
  `;
}

function manejarClickAplicaciones(e) {
  const btn = e.target.closest('[data-accion="elegir"]');
  if (!btn) return;
  manejarElegirAbogado(btn.dataset.id);
}

async function manejarElegirAbogado(aplicacionId) {
  const confirmado = window.confirm(
    '¿Elegir a este abogado? Se creará una solicitud de consulta y sus datos de contacto se revelarán de inmediato.'
  );
  if (!confirmado) return;

  const { data, error } = await api.tablon.elegirAbogado(aplicacionId);

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo elegir al abogado. Intente de nuevo.');
    toast.error(mensaje);
    return;
  }

  const entrada = aplicacionesActuales.find(a => a.id === aplicacionId);
  if (entrada) Object.assign(entrada, data);
  renderizarAplicaciones();
  toast.exito('Abogado elegido. Se creó una solicitud de consulta y sus datos de contacto ya fueron revelados.');
}

async function manejarCerrarCaso() {
  const confirmado = window.confirm('¿Cerrar este caso? Ya no podrá recibir más aplicaciones ni elegir a otro abogado.');
  if (!confirmado) return;

  const { data, error } = await api.tablon.cerrarCaso(casoId);

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo cerrar el caso. Intente de nuevo.');
    toast.error(mensaje);
    return;
  }

  casoActual = { ...casoActual, ...data };
  renderizarCaso();
  document.getElementById('btnCerrarCaso').hidden = true;
  renderizarAplicaciones();
  toast.exito('Caso cerrado.');
}

// ─── Vista abogado ─────────────────────────────────────────────────────────────
function renderizarVistaAbogado() {
  const total = casoActual.total_aplicaciones ?? 0;
  document.getElementById('casoTotalAplicaciones').textContent =
    `${total} ${total === 1 ? 'abogado aplicó' : 'abogados aplicaron'} a este caso.`;

  const yaAplico = Boolean(casoActual.mi_aplicacion_estado);
  const formulario = document.getElementById('formAplicar');

  if (yaAplico) {
    document.getElementById('miAplicacionEstado').hidden = false;
    const badge = document.getElementById('miAplicacionBadge');
    badge.className = `badge ${CLASE_ESTADO_APLICACION[casoActual.mi_aplicacion_estado] ?? 'badge--estado-pendiente'}`;
    badge.textContent = `Su aplicación: ${ETIQUETAS_ESTADO_APLICACION[casoActual.mi_aplicacion_estado] ?? casoActual.mi_aplicacion_estado}`;
    formulario.hidden = true;
  } else if (casoActual.estado !== 'ACTIVO') {
    formulario.hidden = true;
  } else {
    formulario.hidden = false;
  }
}

async function manejarSubmitAplicar(e) {
  e.preventDefault();

  const errorEl = document.getElementById('errorAplicar');
  const btnEnviar = e.target.querySelector('button[type="submit"]');
  errorEl.textContent = '';

  const mensaje = document.getElementById('mensajeAplicar').value;

  btnEnviar.disabled = true;
  btnEnviar.textContent = 'Enviando...';

  const { data, error } = await api.tablon.aplicar(casoId, mensaje);

  btnEnviar.disabled = false;
  btnEnviar.textContent = 'Enviar aplicación';

  if (error) {
    const mensajeError = mensajeAmigable(error, 'No se pudo enviar la aplicación. Intente de nuevo.');
    errorEl.textContent = mensajeError;
    toast.error(mensajeError);
    return;
  }

  casoActual.mi_aplicacion_estado = data.estado;
  casoActual.total_aplicaciones = (casoActual.total_aplicaciones ?? 0) + 1;
  renderizarVistaAbogado();
  toast.exito('Aplicación enviada.');
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
function generarAvatarHtml(fotoPath, nombre) {
  const fotoUrl = fotoPath ? api.storage.getPublicUrl('avatares', fotoPath) : null;
  return fotoUrl
    ? `<img src="${escaparAtrib(fotoUrl)}" alt="Foto de ${escaparAtrib(nombre)}">`
    : `<div class="avatar-placeholder" aria-hidden="true">${escaparHtml(obtenerIniciales(nombre))}</div>`;
}

function generarEstrellasTexto(rating, total) {
  if (!total || total === 0) return 'Sin reseñas';
  return `${Number(rating).toFixed(1)} &#9733; (${total})`;
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
