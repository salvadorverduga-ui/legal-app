// tablon.js
// Lógica de la página tablon.html ("El Tablón"): publicar casos (cliente) y
// listar casos activos con filtros (abogado verificado). El detalle de un
// caso puntual (aplicar, elegir, cerrar) vive en tablon-caso.html/tablon-caso.js.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, rutaPanelPropio, MENSAJE_AGREGADO_SEGUIMIENTO } from './utils.js';
import { inicializarNotificaciones } from './notificaciones.js';
import { inicializarMenuPerfil } from './menu-perfil.js';

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
let formPublicarAbierto = false;
let limitePublicacionesDiarias = null; // config_tablon.limite_publicaciones_diarias_cliente; null = sin límite
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

  // Acceso rápido "Publicar en El Tablón" del dashboard cliente (panel-cliente.html).
  const accion = new URLSearchParams(window.location.search).get('accion');
  if (perfilActual.rol === 'cliente' && accion === 'publicar' && !document.getElementById('btnPublicarCaso').disabled) {
    abrirFormularioPublicar();
  }
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
    document.getElementById('btnPublicarCaso').addEventListener('click', abrirFormularioPublicar);

    document.getElementById('btnCancelarPublicarCaso').addEventListener('click', cerrarFormularioPublicar);
    document.getElementById('formPublicarCaso').addEventListener('submit', manejarSubmitPublicarCaso);

    document.getElementById('descripcionCaso').addEventListener('input', (e) => {
      document.getElementById('contadorDescripcionCaso').textContent = `${e.target.value.length} / 600`;
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

    document.getElementById('casosActivosLista').addEventListener('click', manejarClickCasosActivos);
  }
}

function manejarClickCasosActivos(e) {
  const btn = e.target.closest('[data-accion="toggle-seguimiento"]');
  if (!btn) return;
  manejarToggleSeguimiento(btn.dataset.id);
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
    btnPublicar.disabled = false;
    return;
  }

  const hoy = new Date().toDateString();
  const publicadosHoy = misCasosActuales.filter(c => new Date(c.created_at).toDateString() === hoy).length;
  const alcanzoLimite = publicadosHoy >= limitePublicacionesDiarias;

  aviso.textContent = `Ya publicó el máximo de ${limitePublicacionesDiarias} casos hoy. Podrá publicar de nuevo mañana.`;
  aviso.hidden = !alcanzoLimite;
  btnPublicar.disabled = alcanzoLimite;
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

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="solicitud-item__nombre">${escaparHtml(c.titulo)}</p>
          <p class="solicitud-item__fecha">${formatearFecha(c.created_at)} · ${escaparHtml(c.especialidad)}${ubicacionHtml}${c.anonimo ? ' · Anónimo' : ''}</p>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      <p class="solicitud-item__detalle">${escaparHtml(c.descripcion)}</p>
      ${casoComunHtml}
      <div class="solicitud-item__acciones">
        <a href="/pages/tablon-caso?id=${idSeguro}" class="btn btn--secundario btn--sm">
          Ver caso (${c.total_aplicaciones} ${c.total_aplicaciones === 1 ? 'aplicación' : 'aplicaciones'})
        </a>
      </div>
    </article>
  `;
}

// ─── Vista cliente: publicar caso ─────────────────────────────────────────────
// Reutilizada por el click en "Publicar caso" y por el acceso rápido del
// dashboard cliente (?accion=publicar, ver panel-cliente.html).
function abrirFormularioPublicar() {
  formPublicarAbierto = true;
  document.getElementById('formPublicarCaso').hidden = false;
  document.getElementById('btnPublicarCaso').hidden = true;
}

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
    provincia: document.getElementById('provinciaCaso').value,
    ciudad: document.getElementById('ciudadCaso').value,
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
  const ubicacionHtml = generarUbicacionTexto(c.provincia, c.ciudad);

  const accionesHtml = c.mi_aplicacion_estado
    ? `
      <div class="solicitud-item__acciones">
        <span class="badge ${CLASE_ESTADO_APLICACION[c.mi_aplicacion_estado] ?? 'badge--estado-pendiente'}">
          Su aplicación: ${ETIQUETAS_ESTADO_APLICACION[c.mi_aplicacion_estado] ?? c.mi_aplicacion_estado}
        </span>
        <button class="btn ${c.mi_seguimiento ? 'btn--primario' : 'btn--secundario'} btn--sm" type="button"
          data-accion="toggle-seguimiento" data-id="${escaparAtrib(c.mi_aplicacion_id)}">
          ${c.mi_seguimiento ? 'En seguimiento' : 'Seguimiento'}
        </button>
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
          <p class="solicitud-item__nombre">${escaparHtml(c.titulo)}</p>
          <p class="solicitud-item__fecha">${formatearFecha(c.created_at)} · ${escaparHtml(c.especialidad)}${ubicacionHtml} · ${escaparHtml(c.cliente_nombre)}</p>
        </div>
        <span class="badge badge--pendiente">${c.total_aplicaciones} ${c.total_aplicaciones === 1 ? 'aplicación' : 'aplicaciones'}</span>
      </div>
      <p class="solicitud-item__detalle">${escaparHtml(c.descripcion)}</p>
      ${casoComunHtml}
      ${accionesHtml}
    </article>
  `;
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
function generarUbicacionTexto(provincia, ciudad) {
  const partes = [provincia, ciudad].filter(Boolean).map(escaparHtml);
  return partes.length ? ` · ${partes.join(', ')}` : '';
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
