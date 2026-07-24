// tablon.js
// Lógica de la página tablon.html ("El Tablón"): lista de casos en formato
// foro — casos propios del cliente, o casos activos con filtros para el
// abogado verificado. El formulario de publicación vive en tablon-publicar.html/
// tablon-publicar.js; el detalle de un caso puntual (aplicar, elegir, cerrar)
// vive en tablon-caso.html/tablon-caso.js. Importa todo desde api.js — nunca
// consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, generarCheckboxSeguimiento, generarContadorVisualizaciones, MENSAJE_AGREGADO_SEGUIMIENTO } from './utils.js';
import { inicializarHeader } from './header.js';

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
let limitePublicacionesDiarias = null; // config_tablon.limite_publicaciones_diarias_cliente; null = sin límite
let filtroEspecialidad = '';
let filtroCasoComun = '';
let filtroProvincia = '';

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

  let urlPerfilPublico;
  if (perfilActual.rol === 'abogado') {
    const abogadoActual = await api.abogados.getPerfilPropio();
    urlPerfilPublico = abogadoActual ? `/pages/perfil-abogado?id=${abogadoActual.id}` : undefined;
  }
  inicializarHeader({
    rol: perfilActual.rol,
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico,
  });

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
  if (perfilActual.rol === 'cliente') {
    document.getElementById('btnPublicarCaso').addEventListener('click', (e) => {
      if (e.currentTarget.getAttribute('aria-disabled') === 'true') e.preventDefault();
    });
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
    document.getElementById('filtroProvinciaTablon').addEventListener('change', async (e) => {
      filtroProvincia = e.target.value;
      await cargarCasosActivos();
    });

    document.getElementById('casosActivosLista').addEventListener('change', manejarChangeCasosActivos);
  }
}

function manejarChangeCasosActivos(e) {
  const input = e.target.closest('[data-accion="toggle-seguimiento"]');
  if (!input) return;
  manejarToggleSeguimiento(input.dataset.id);
}

async function manejarToggleSeguimiento(aplicacionId) {
  const { data, error } = await api.seguimiento.toggleTablon(aplicacionId, 'abogado');

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar el seguimiento. Intente de nuevo.'));
    return;
  }

  const entrada = casosActivosActuales.find(c => c.mi_aplicacion_id === aplicacionId);
  if (entrada) entrada.mi_seguimiento = data.en_seguimiento_abogado;
  renderizarCasosActivos();
  toast.info(data.en_seguimiento_abogado ? MENSAJE_AGREGADO_SEGUIMIENTO : 'Quitado de seguimiento.');
}

// ─── Vista cliente: mis casos ─────────────────────────────────────────────────
async function cargarMisCasos() {
  const [casos, config] = await Promise.all([
    api.tablon.getMisCasos(),
    api.tablon.getConfigTablon(),
  ]);
  misCasosActuales = casos;
  const limite = config.find(c => c.clave === 'limite_publicaciones_diarias_cliente');
  limitePublicacionesDiarias = limite?.valor != null ? Number(limite.valor) : null;

  renderizarMisCasos();
  actualizarAvisoLimiteCasos();
}

function actualizarAvisoLimiteCasos() {
  const aviso = document.getElementById('avisoLimiteCasos');
  const btnPublicar = document.getElementById('btnPublicarCaso');

  if (limitePublicacionesDiarias == null) {
    aviso.hidden = true;
    btnPublicar.classList.remove('btn--deshabilitado');
    btnPublicar.removeAttribute('aria-disabled');
    return;
  }

  const hoy = new Date().toDateString();
  const publicadosHoy = misCasosActuales.filter(c => new Date(c.created_at).toDateString() === hoy).length;
  const alcanzoLimite = publicadosHoy >= limitePublicacionesDiarias;

  aviso.textContent = `Ya publicó el máximo de ${limitePublicacionesDiarias} casos hoy. Podrá publicar de nuevo mañana.`;
  aviso.hidden = !alcanzoLimite;
  btnPublicar.classList.toggle('btn--deshabilitado', alcanzoLimite);
  if (alcanzoLimite) {
    btnPublicar.setAttribute('aria-disabled', 'true');
  } else {
    btnPublicar.removeAttribute('aria-disabled');
  }
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
  const ubicacionHtml = generarUbicacionTexto(c.provincia, c.ciudad);
  const especialidadTexto = c.especialidad ? escaparHtml(c.especialidad) : 'Sin especialidad definida';

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="caso-tablon-card__titulo"><a href="/pages/tablon-caso?id=${idSeguro}">${escaparHtml(c.titulo)}</a></p>
          <p class="solicitud-item__fecha">${formatearTiempoTranscurrido(c.created_at)} · ${especialidadTexto}${ubicacionHtml}</p>
        </div>
        <div class="solicitud-item__header-derecha">
          <span class="badge ${claseEstado}">${etiquetaEstado}</span>
          ${generarContadorVisualizaciones(c.visualizaciones ?? 0)}
        </div>
      </div>
      <p class="solicitud-item__detalle">${escaparHtml(c.descripcion)}</p>
      ${casoComunHtml}
      <div class="solicitud-item__acciones">
        ${c.anonimo ? '<span class="badge badge--anonimo">Publicado como anónimo</span>' : ''}
        <a href="/pages/tablon-caso?id=${idSeguro}" class="btn btn--secundario btn--sm">
          Ver caso (${c.total_aplicaciones} ${c.total_aplicaciones === 1 ? 'aplicación' : 'aplicaciones'})
        </a>
      </div>
    </article>
  `;
}

// ─── Vista abogado: casos activos ─────────────────────────────────────────────
async function cargarCasosActivos() {
  casosActivosActuales = await api.tablon.getCasosActivos(filtroProvincia);
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
  const ubicacionHtml = generarUbicacionTexto(c.provincia, c.ciudad);
  const especialidadTexto = c.especialidad ? escaparHtml(c.especialidad) : 'Sin especialidad definida';

  const seguimientoHtml = c.mi_aplicacion_id
    ? generarCheckboxSeguimiento(escaparAtrib(c.mi_aplicacion_id), c.mi_seguimiento)
    : '';

  const accionesHtml = c.mi_aplicacion_estado
    ? `
      <div class="solicitud-item__acciones">
        <span class="badge ${CLASE_ESTADO_APLICACION[c.mi_aplicacion_estado] ?? 'badge--estado-pendiente'}">
          Su aplicación: ${ETIQUETAS_ESTADO_APLICACION[c.mi_aplicacion_estado] ?? c.mi_aplicacion_estado}
        </span>
        <a href="/pages/tablon-caso?id=${idSeguro}" class="btn btn--secundario btn--sm">Ver caso</a>
      </div>
    `
    : `
      <div class="solicitud-item__acciones">
        <a href="/pages/tablon-caso?id=${idSeguro}" class="btn btn--primario btn--sm">Ver caso y aplicar</a>
      </div>
    `;

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="caso-tablon-card__titulo"><a href="/pages/tablon-caso?id=${idSeguro}">${escaparHtml(c.titulo)}</a></p>
          <p class="solicitud-item__fecha">${formatearTiempoTranscurrido(c.created_at)} · ${especialidadTexto}${ubicacionHtml} · ${escaparHtml(c.cliente_nombre)}</p>
        </div>
        <div class="solicitud-item__header-derecha">
          <span class="badge badge--pendiente">${c.total_aplicaciones} ${c.total_aplicaciones === 1 ? 'aplicación' : 'aplicaciones'}</span>
          ${generarContadorVisualizaciones(c.visualizaciones ?? 0)}
        </div>
      </div>
      <p class="solicitud-item__detalle">${escaparHtml(c.descripcion)}</p>
      ${casoComunHtml}
      ${accionesHtml}
      ${seguimientoHtml}
    </article>
  `;
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
function generarUbicacionTexto(provincia, ciudad) {
  const partes = [provincia, ciudad].filter(Boolean).map(escaparHtml);
  return partes.length ? ` · ${partes.join(', ')}` : '';
}

// Tiempo transcurrido desde la publicación del caso, en unidades legibles
// ("hace unos minutos", "hace 3 horas", "hace 2 días") — formato foro.
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
