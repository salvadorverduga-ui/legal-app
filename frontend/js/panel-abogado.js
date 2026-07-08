// panel-abogado.js
// Lógica de la página panel-abogado.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';

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

const SECCIONES = ['Perfil', 'Solicitudes', 'Resenas', 'Suscripcion'];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;         // fila propia de la tabla perfiles
let abogadoActual = null;        // fila propia de la tabla abogados
let solicitudesActuales = [];    // caché local; las acciones actualizan sin refetch
let estadoFiltroActivo = '';     // '' = todas

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
  abogadoActual = await api.abogados.getPerfilPropio();
  if (!abogadoActual) {
    mostrarError();
    return;
  }

  document.getElementById('nombreUsuario').textContent = perfilActual.nombre_completo;

  renderizarCabecera();
  rellenarFormularioPerfil();
  actualizarBanners();

  const [resenas] = await Promise.all([
    api.resenas.getResenasAbogado(abogadoActual.id),
    cargarSolicitudes(),
    cargarSuscripcion(),
  ]);
  renderizarResenas(resenas);

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

  SECCIONES.forEach(nombre => {
    document.getElementById(`tab${nombre}`).addEventListener('click', () => cambiarTab(nombre));
  });

  document.getElementById('toggleDisponible').addEventListener('change', manejarToggleDisponible);

  document.getElementById('btnCompletarPerfil').addEventListener('click', () => {
    cambiarTab('Perfil');
    document.getElementById('formPerfil').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('btnCambiarFoto').addEventListener('click', () => {
    document.getElementById('inputFoto').click();
  });
  document.getElementById('inputFoto').addEventListener('change', manejarCambioFoto);

  document.getElementById('perfilDescripcion').addEventListener('input', actualizarContadorDescripcion);
  document.getElementById('formPerfil').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarGuardarPerfil();
  });

  document.querySelectorAll('#seccionSolicitudes .filtro-tipo__btn').forEach(btn => {
    btn.addEventListener('click', () => cambiarFiltroSolicitudes(btn.dataset.estado));
  });

  document.getElementById('solicitudesLista').addEventListener('click', manejarClickSolicitudes);
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

// ─── Cabecera: identidad, verificación y disponibilidad ──────────────────────
function renderizarCabecera() {
  const avatarHtml = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);
  document.getElementById('cabeceraAvatar').innerHTML = avatarHtml;
  document.getElementById('perfilFotoAvatar').innerHTML = avatarHtml;

  document.getElementById('cabeceraNombre').textContent = perfilActual.nombre_completo;

  const estadoVerificacion = ETIQUETAS_VERIFICACION[abogadoActual.verificacion] ?? ETIQUETAS_VERIFICACION.PENDIENTE;
  document.getElementById('cabeceraBadges').innerHTML =
    `<span class="badge ${estadoVerificacion.clase}">${estadoVerificacion.texto}</span>`;

  document.getElementById('toggleDisponible').checked = abogadoActual.toggle_disponible;
  actualizarEtiquetaDisponible(abogadoActual.toggle_disponible);

  const btnVerPerfilPublico = document.getElementById('btnVerPerfilPublico');
  btnVerPerfilPublico.href = `/pages/perfil-abogado?id=${abogadoActual.id}`;
  btnVerPerfilPublico.hidden = false;
}

function actualizarEtiquetaDisponible(disponible) {
  document.getElementById('toggleDisponibleEtiqueta').textContent = disponible ? 'Disponible' : 'No disponible';
}

// ─── Banners: vencimiento de suscripción y onboarding ────────────────────────
function actualizarBanners() {
  actualizarBannerSuscripcion();
  actualizarBannerOnboarding();
}

function actualizarBannerSuscripcion() {
  const banner = document.getElementById('bannerSuscripcion');
  const vigenteHasta = abogadoActual.suscripcion_vigente_hasta;

  if (!vigenteHasta) {
    banner.hidden = true;
    return;
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaVencimiento = new Date(`${vigenteHasta}T00:00:00`);
  const diasRestantes = Math.round((fechaVencimiento - hoy) / (1000 * 60 * 60 * 24));

  if (diasRestantes < 0 || diasRestantes > 7) {
    banner.hidden = true;
    return;
  }

  document.getElementById('bannerSuscripcionTexto').textContent =
    `Su suscripción vence el ${formatearFecha(vigenteHasta)}. Renueve para mantener su perfil visible.`;
  banner.hidden = false;
}

function actualizarBannerOnboarding() {
  const banner = document.getElementById('bannerOnboarding');
  const perfilIncompleto = !abogadoActual.descripcion?.trim()
    && (abogadoActual.especialidades ?? []).length === 0;
  banner.hidden = !perfilIncompleto;
}

async function manejarToggleDisponible() {
  const toggle = document.getElementById('toggleDisponible');
  const estadoEl = document.getElementById('toggleDisponibleEstado');

  toggle.disabled = true;
  estadoEl.textContent = '';

  const { toggle_disponible, error } = await api.abogados.toggleDisponible();

  if (error) {
    toggle.checked = abogadoActual.toggle_disponible;
    const mensaje = mensajeAmigable(error, 'No se pudo actualizar la disponibilidad. Intente de nuevo.');
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
  } else {
    abogadoActual.toggle_disponible = toggle_disponible;
    toggle.checked = toggle_disponible;
    actualizarEtiquetaDisponible(toggle_disponible);
    toast.info(toggle_disponible ? 'Ahora está disponible.' : 'Ahora no está disponible.');
  }

  toggle.disabled = false;
}

// ─── Mi perfil: foto ──────────────────────────────────────────────────────────
async function manejarCambioFoto(e) {
  const archivo = e.target.files[0];
  if (!archivo) return;

  const estadoEl = document.getElementById('fotoEstado');
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
  actualizarProgresoPerfil();
  estadoEl.textContent = 'Foto actualizada.';
  toast.exito('Foto actualizada.');
  e.target.value = '';
}

// ─── Mi perfil: formulario ────────────────────────────────────────────────────
function rellenarFormularioPerfil() {
  document.getElementById('perfilDescripcion').value = abogadoActual.descripcion ?? '';
  actualizarContadorDescripcion();

  document.querySelectorAll('#especialidadesPerfil input[type="checkbox"]').forEach(chk => {
    chk.checked = (abogadoActual.especialidades ?? []).includes(chk.value);
  });

  document.getElementById('perfilPrecio').value = abogadoActual.precio_consulta ?? '';
  document.getElementById('perfilProvincia').value = perfilActual.provincia ?? '';

  actualizarProgresoPerfil();
}

// 5 campos = 20% cada uno: foto, descripción, especialidades, precio, provincia
function actualizarProgresoPerfil() {
  const campos = [
    Boolean(perfilActual.foto_url),
    Boolean(abogadoActual.descripcion?.trim()),
    (abogadoActual.especialidades ?? []).length > 0,
    abogadoActual.precio_consulta != null,
    Boolean(perfilActual.provincia),
  ];
  const porcentaje = campos.filter(Boolean).length * 20;

  document.getElementById('progresoPerfilPorcentaje').textContent = `${porcentaje}%`;
  document.getElementById('progresoPerfilRelleno').style.width = `${porcentaje}%`;
}

function actualizarContadorDescripcion() {
  const textarea = document.getElementById('perfilDescripcion');
  document.getElementById('contadorDescripcionPerfil').textContent = `${textarea.value.length} / 600`;
}

async function manejarGuardarPerfil() {
  const btn = document.getElementById('btnGuardarPerfil');
  const errorEl = document.getElementById('errorPerfil');
  const exitoEl = document.getElementById('exitoPerfil');

  errorEl.textContent = '';
  exitoEl.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const descripcion = document.getElementById('perfilDescripcion').value.trim();
  const especialidades = Array.from(
    document.querySelectorAll('#especialidadesPerfil input[type="checkbox"]:checked')
  ).map(chk => chk.value);
  const precioRaw = document.getElementById('perfilPrecio').value;
  const precio_consulta = precioRaw ? Number(precioRaw) : null;
  const provincia = document.getElementById('perfilProvincia').value;

  try {
    const [resultadoAbogado, resultadoPerfil] = await Promise.all([
      api.abogados.actualizarPerfilAbogado({ descripcion, especialidades, precio_consulta }),
      api.perfiles.actualizarPerfil({ provincia }),
    ]);

    if (resultadoAbogado.error || resultadoPerfil.error) {
      const mensaje = mensajeAmigable(resultadoAbogado.error ?? resultadoPerfil.error, 'Ocurrió un error. Intente de nuevo.');
      errorEl.textContent = mensaje;
      toast.error(mensaje);
      return;
    }

    abogadoActual = resultadoAbogado.data;
    perfilActual.provincia = resultadoPerfil.data.provincia;
    exitoEl.hidden = false;
    actualizarBannerOnboarding();
    actualizarProgresoPerfil();
    toast.exito('Perfil guardado.');

  } catch (err) {
    console.error('[panel-abogado] Error inesperado al guardar el perfil:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
    toast.error('Ocurrió un error. Intente de nuevo.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
}

// ─── Solicitudes ──────────────────────────────────────────────────────────────
async function cargarSolicitudes() {
  solicitudesActuales = await api.solicitudes.getSolicitudesAbogado();
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

  const contactoHtml = s.estado === 'ACEPTADA'
    ? `
      <div class="solicitud-item__contacto">
        Contacto revelado — Teléfono: <strong>${escaparHtml(s.cliente_telefono ?? 'No registrado')}</strong>,
        correo: <strong>${escaparHtml(s.cliente_email ?? 'No registrado')}</strong>
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

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div class="solicitud-item__cliente">
          <div class="solicitud-item__avatar">${avatarHtml}</div>
          <div>
            <p class="solicitud-item__nombre">${escaparHtml(s.cliente_nombre)}</p>
            <p class="solicitud-item__fecha">${formatearFecha(s.created_at)}</p>
          </div>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      ${detalleHtml}
      ${motivoRechazoHtml}
      ${contactoHtml}
      ${accionesHtml}
    </article>
  `;
}

function manejarClickSolicitudes(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;

  const { accion, id } = btn.dataset;

  if (accion === 'aceptar') manejarAceptarSolicitud(id);
  if (accion === 'mostrar-rechazo') document.getElementById(`rechazo-${id}`).hidden = false;
  if (accion === 'cancelar-rechazo') document.getElementById(`rechazo-${id}`).hidden = true;
  if (accion === 'confirmar-rechazo') {
    const motivo = document.getElementById(`motivo-${id}`).value;
    manejarRechazarSolicitud(id, motivo);
  }
}

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

function actualizarSolicitudLocal(id, datosActualizados) {
  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, datosActualizados);
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
