// tablon.js
// Lógica de la página tablon.html ("El Tablón").
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, rutaPanelPropio } from './utils.js';

// ─── Etiquetas y estilos por estado ───────────────────────────────────────────
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
  ELEGIDO:   'Elegido',
  RECHAZADO: 'Rechazado',
};

const CLASE_ESTADO_APLICACION = {
  PENDIENTE: 'badge--estado-pendiente',
  ELEGIDO:   'badge--estado-aceptada',
  RECHAZADO: 'badge--estado-rechazada',
};

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;             // fila propia de la tabla perfiles
let esAbogadoVerificado = false;
let misCasosActuales = [];           // vista cliente
let casosActivosActuales = [];       // vista abogado
let aplicacionesActuales = [];       // aplicaciones del caso seleccionado (vista cliente)
let casoSeleccionadoId = null;       // caso cuyo detalle de aplicaciones se está viendo
let formPublicarAbierto = false;
let casoConAplicarAbierto = null;    // id del caso con el formulario de aplicar visible (vista abogado)
let filtroEspecialidad = '';
let filtroCasoComun = '';

// ─── Entry point ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  // 1. Inicializar Supabase con la configuración de /api/config
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[tablon] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  // 2. Verificar autenticación — redirigir si no hay sesión
  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  // 3. Verificar rol — El Tablón es solo para clientes y abogados
  perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || (perfilActual.rol !== 'cliente' && perfilActual.rol !== 'abogado')) {
    window.location.href = '/';
    return;
  }

  document.getElementById('nombreUsuario').textContent = perfilActual.nombre_completo;
  document.getElementById('logoHeader').href = rutaPanelPropio(perfilActual.rol);

  if (perfilActual.rol === 'cliente') {
    document.getElementById('subtituloTablon').textContent =
      'Publique su caso para que abogados verificados apliquen a atenderlo.';
    document.getElementById('vistaCliente').hidden = false;
    await cargarMisCasos();
  } else {
    const abogadoActual = await api.abogados.getPerfilPropio();
    esAbogadoVerificado = abogadoActual?.verificacion === 'VERIFICADO';

    if (!esAbogadoVerificado) {
      document.getElementById('subtituloTablon').textContent = 'Aplique a casos publicados por clientes.';
      document.getElementById('estadoNoVerificado').hidden = false;
    } else {
      document.getElementById('subtituloTablon').textContent = 'Aplique a casos publicados por clientes.';
      document.getElementById('vistaAbogado').hidden = false;
      await cargarCasosActivos();
    }
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
  document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
    await api.auth.cerrarSesion();
    window.location.href = '/';
  });

  if (perfilActual.rol === 'cliente') {
    document.getElementById('btnPublicarCaso').addEventListener('click', () => {
      formPublicarAbierto = true;
      document.getElementById('formPublicarCaso').hidden = false;
      document.getElementById('btnPublicarCaso').hidden = true;
    });

    document.getElementById('btnCancelarPublicarCaso').addEventListener('click', cerrarFormularioPublicar);
    document.getElementById('formPublicarCaso').addEventListener('submit', manejarSubmitPublicarCaso);

    document.getElementById('descripcionCaso').addEventListener('input', (e) => {
      document.getElementById('contadorDescripcionCaso').textContent = `${e.target.value.length} / 600`;
    });

    document.getElementById('misCasosLista').addEventListener('click', manejarClickMisCasos);
    document.getElementById('btnCerrarAplicaciones').addEventListener('click', cerrarAplicaciones);
    document.getElementById('aplicacionesLista').addEventListener('click', manejarClickAplicaciones);
  }

  if (perfilActual.rol === 'abogado' && esAbogadoVerificado) {
    document.getElementById('filtroEspecialidadTablon').addEventListener('change', (e) => {
      filtroEspecialidad = e.target.value;
      renderizarCasosActivos();
    });
    document.getElementById('filtroCasoComunTablon').addEventListener('change', (e) => {
      filtroCasoComun = e.target.value;
      renderizarCasosActivos();
    });

    document.getElementById('casosActivosLista').addEventListener('click', manejarClickCasosActivos);
    document.getElementById('casosActivosLista').addEventListener('submit', manejarSubmitAplicar);
    document.getElementById('casosActivosLista').addEventListener('input', manejarInputCasosActivos);
  }
}

// ─── Vista cliente: mis casos ─────────────────────────────────────────────────
async function cargarMisCasos() {
  misCasosActuales = await api.tablon.getMisCasos();
  renderizarMisCasos();
  actualizarAvisoLimiteCasos();
}

function actualizarAvisoLimiteCasos() {
  const hoy = new Date().toDateString();
  const publicadosHoy = misCasosActuales.filter(c => new Date(c.created_at).toDateString() === hoy).length;
  const alcanzoLimite = publicadosHoy >= 2;

  document.getElementById('avisoLimiteCasos').hidden = !alcanzoLimite;
  document.getElementById('btnPublicarCaso').disabled = alcanzoLimite;
}

function renderizarMisCasos() {
  const contenedor = document.getElementById('misCasosLista');
  const vacio = document.getElementById('estadoSinCasosCliente');

  if (misCasosActuales.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = misCasosActuales.map(generarCasoClienteCard).join('');
}

function generarCasoClienteCard(c) {
  const idSeguro = escaparAtrib(c.id);
  const claseEstado = CLASE_ESTADO_CASO[c.estado] ?? 'badge--estado-expirada';
  const etiquetaEstado = ETIQUETAS_ESTADO_CASO[c.estado] ?? c.estado;
  const casoComunHtml = c.caso_comun
    ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Caso común:</span> ${escaparHtml(c.caso_comun)}</p>`
    : '';

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="solicitud-item__nombre">${escaparHtml(c.titulo)}</p>
          <p class="solicitud-item__fecha">${formatearFecha(c.created_at)} · ${escaparHtml(c.especialidad)}${c.anonimo ? ' · Anónimo' : ''}</p>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      <p class="solicitud-item__detalle">${escaparHtml(c.descripcion)}</p>
      ${casoComunHtml}
      <div class="solicitud-item__acciones">
        <button class="btn btn--secundario btn--sm" type="button" data-accion="ver-aplicaciones" data-id="${idSeguro}">
          Ver aplicaciones (${c.total_aplicaciones})
        </button>
      </div>
    </article>
  `;
}

function manejarClickMisCasos(e) {
  const btn = e.target.closest('[data-accion="ver-aplicaciones"]');
  if (!btn) return;
  abrirAplicaciones(btn.dataset.id);
}

async function abrirAplicaciones(casoId) {
  casoSeleccionadoId = casoId;
  aplicacionesActuales = await api.tablon.getAplicaciones(casoId);
  renderizarAplicaciones();
  document.getElementById('seccionAplicacionesCaso').hidden = false;
  document.getElementById('seccionAplicacionesCaso').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cerrarAplicaciones() {
  casoSeleccionadoId = null;
  aplicacionesActuales = [];
  document.getElementById('seccionAplicacionesCaso').hidden = true;
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

  const mensajeHtml = ap.mensaje
    ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Mensaje:</span> ${escaparHtml(ap.mensaje)}</p>`
    : '';

  const accionesHtml = ap.estado === 'PENDIENTE' ? `
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
  const confirmado = window.confirm('¿Elegir a este abogado? Se creará una solicitud de consulta con él.');
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
  toast.exito('Abogado elegido. Se creó una solicitud de consulta con él.');
}

// ─── Vista cliente: publicar caso ─────────────────────────────────────────────
function cerrarFormularioPublicar() {
  formPublicarAbierto = false;
  const form = document.getElementById('formPublicarCaso');
  form.hidden = true;
  form.reset();
  document.getElementById('contadorDescripcionCaso').textContent = '0 / 600';
  document.getElementById('errorPublicarCaso').textContent = '';
  document.getElementById('btnPublicarCaso').hidden = false;
}

async function manejarSubmitPublicarCaso(e) {
  e.preventDefault();

  const errorEl = document.getElementById('errorPublicarCaso');
  const btnGuardar = document.getElementById('btnGuardarCaso');
  errorEl.textContent = '';

  const datos = {
    titulo: document.getElementById('tituloCaso').value,
    descripcion: document.getElementById('descripcionCaso').value,
    especialidad: document.getElementById('especialidadCaso').value,
    caso_comun: document.getElementById('casoComunCaso').value,
    anonimo: document.getElementById('anonimoCaso').checked,
  };

  if (!datos.titulo.trim() || !datos.descripcion.trim() || !datos.especialidad) {
    errorEl.textContent = 'Complete el título, la descripción y la especialidad.';
    return;
  }

  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Publicando...';

  const { error } = await api.tablon.publicarCaso(datos);

  btnGuardar.disabled = false;
  btnGuardar.textContent = 'Publicar';

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo publicar el caso. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    return;
  }

  cerrarFormularioPublicar();
  await cargarMisCasos();
  toast.exito('Caso publicado en El Tablón.');
}

// ─── Vista abogado: casos activos ─────────────────────────────────────────────
async function cargarCasosActivos() {
  casosActivosActuales = await api.tablon.getCasosActivos();
  renderizarCasosActivos();
}

function renderizarCasosActivos() {
  const lista = casosActivosActuales.filter(c => {
    const coincideEspecialidad = !filtroEspecialidad || c.especialidad === filtroEspecialidad;
    const coincideCasoComun = !filtroCasoComun || c.caso_comun === filtroCasoComun;
    return coincideEspecialidad && coincideCasoComun;
  });

  const contenedor = document.getElementById('casosActivosLista');
  const vacio = document.getElementById('estadoSinCasosAbogado');

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  contenedor.innerHTML = lista.map(generarCasoAbogadoCard).join('');
}

function generarCasoAbogadoCard(c) {
  const idSeguro = escaparAtrib(c.id);
  const casoComunHtml = c.caso_comun
    ? `<p class="solicitud-item__detalle"><span class="solicitud-item__detalle-etiqueta">Caso común:</span> ${escaparHtml(c.caso_comun)}</p>`
    : '';

  const formularioAbierto = casoConAplicarAbierto === c.id;

  const accionesHtml = c.mi_aplicacion_estado
    ? `
      <div class="solicitud-item__acciones">
        <span class="badge ${CLASE_ESTADO_APLICACION[c.mi_aplicacion_estado] ?? 'badge--estado-pendiente'}">
          Su aplicación: ${ETIQUETAS_ESTADO_APLICACION[c.mi_aplicacion_estado] ?? c.mi_aplicacion_estado}
        </span>
      </div>
    `
    : `
      <div class="solicitud-item__acciones">
        <button class="btn btn--primario btn--sm" type="button" data-accion="mostrar-aplicar" data-id="${idSeguro}">
          Aplicar
        </button>
      </div>
      <form class="formulario-edicion" id="formAplicar-${idSeguro}" data-id="${idSeguro}" ${formularioAbierto ? '' : 'hidden'}>
        <div class="campo">
          <label for="mensajeAplicar-${idSeguro}" class="campo__etiqueta">Mensaje (opcional)</label>
          <textarea id="mensajeAplicar-${idSeguro}" class="campo__input" rows="3" maxlength="300"
            placeholder="Preséntese brevemente al cliente..."></textarea>
          <p class="campo__contador" id="contadorAplicar-${idSeguro}">0 / 300</p>
        </div>
        <p class="campo__error" id="errorAplicar-${idSeguro}" role="alert" aria-live="polite"></p>
        <div class="solicitud-item__acciones">
          <button type="submit" class="btn btn--primario btn--sm">Enviar aplicación</button>
          <button type="button" class="btn btn--secundario btn--sm" data-accion="cancelar-aplicar" data-id="${idSeguro}">
            Cancelar
          </button>
        </div>
      </form>
    `;

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="solicitud-item__nombre">${escaparHtml(c.titulo)}</p>
          <p class="solicitud-item__fecha">${formatearFecha(c.created_at)} · ${escaparHtml(c.especialidad)} · ${escaparHtml(c.cliente_nombre)}</p>
        </div>
        <span class="badge badge--pendiente">${c.total_aplicaciones} ${c.total_aplicaciones === 1 ? 'aplicación' : 'aplicaciones'}</span>
      </div>
      <p class="solicitud-item__detalle">${escaparHtml(c.descripcion)}</p>
      ${casoComunHtml}
      ${accionesHtml}
    </article>
  `;
}

function manejarClickCasosActivos(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;

  const { accion, id } = btn.dataset;
  if (accion === 'mostrar-aplicar') {
    casoConAplicarAbierto = id;
    renderizarCasosActivos();
  }
  if (accion === 'cancelar-aplicar') {
    casoConAplicarAbierto = null;
    renderizarCasosActivos();
  }
}

function manejarInputCasosActivos(e) {
  const textarea = e.target.closest('.formulario-edicion textarea');
  if (!textarea) return;

  const form = textarea.closest('.formulario-edicion');
  const contador = document.getElementById(`contadorAplicar-${form.dataset.id}`);
  if (contador) contador.textContent = `${textarea.value.length} / 300`;
}

async function manejarSubmitAplicar(e) {
  const form = e.target.closest('.formulario-edicion');
  if (!form) return;
  e.preventDefault();

  const casoId = form.dataset.id;
  const errorEl = document.getElementById(`errorAplicar-${casoId}`);
  const btnEnviar = form.querySelector('button[type="submit"]');
  errorEl.textContent = '';

  const mensaje = document.getElementById(`mensajeAplicar-${casoId}`).value;

  btnEnviar.disabled = true;
  btnEnviar.textContent = 'Enviando...';

  const { data, error } = await api.tablon.aplicar(casoId, mensaje);

  if (error) {
    const mensajeError = mensajeAmigable(error, 'No se pudo enviar la aplicación. Intente de nuevo.');
    errorEl.textContent = mensajeError;
    toast.error(mensajeError);
    btnEnviar.disabled = false;
    btnEnviar.textContent = 'Enviar aplicación';
    return;
  }

  const entrada = casosActivosActuales.find(c => c.id === casoId);
  if (entrada) {
    entrada.mi_aplicacion_estado = data.estado;
    entrada.total_aplicaciones += 1;
  }
  casoConAplicarAbierto = null;
  renderizarCasosActivos();
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
