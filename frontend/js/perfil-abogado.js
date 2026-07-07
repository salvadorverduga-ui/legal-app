// perfil-abogado.js
// Lógica de la página perfil-abogado.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';

// ─── Etiquetas visibles para tipo_badge ───────────────────────────────────────
const ETIQUETAS_TIPO = {
  individual: 'Individual',
  estudio:    'Estudio',
  red:        'Red',
};

// ─── Estado de la página ──────────────────────────────────────────────────────
let abogadoActual = null;

// ─── Entry point ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  // 1. Inicializar Supabase con la configuración de /api/config
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[perfil-abogado] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  // 2. Verificar autenticación — redirigir si no hay sesión
  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  // 3. Mostrar nombre del usuario en el encabezado
  const perfil = await api.perfiles.getPerfilActual();
  if (perfil?.nombre_completo) {
    document.getElementById('nombreUsuario').textContent = perfil.nombre_completo;
  }

  // 4. Leer el id del abogado desde la URL
  const abogadoId = new URLSearchParams(window.location.search).get('id');
  if (!abogadoId) {
    mostrarError();
    return;
  }

  // 5. Cargar perfil y reseñas en paralelo
  const [abogado, resenas] = await Promise.all([
    api.abogados.getAbogado(abogadoId),
    api.resenas.getResenasAbogado(abogadoId),
  ]);

  if (!abogado) {
    mostrarError();
    return;
  }

  abogadoActual = abogado;

  renderizarPerfil(abogado);
  renderizarResenas(resenas);

  if (perfil?.rol === 'cliente') {
    document.getElementById('seccionBotonSolicitar').hidden = false;
  }

  mostrarContenido();
  configurarEventos(abogadoId);
}

// ─── Control de estados visuales ─────────────────────────────────────────────
function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarContenido() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoPerfil').hidden = false;
}

// ─── Renderizado del perfil ───────────────────────────────────────────────────
function renderizarPerfil(ab) {
  const fotoUrl = ab.foto_url
    ? api.storage.getPublicUrl('avatares', ab.foto_url)
    : null;

  const avatarEl = document.getElementById('perfilAvatar');
  avatarEl.innerHTML = fotoUrl
    ? `<img src="${escaparAtrib(fotoUrl)}" alt="Foto de ${escaparAtrib(ab.nombre_completo)}">`
    : `<div class="avatar-placeholder" aria-hidden="true">${escaparHtml(obtenerIniciales(ab.nombre_completo))}</div>`;

  const tipoBadge = ['individual', 'estudio', 'red'].includes(ab.tipo_badge)
    ? ab.tipo_badge
    : 'individual';

  document.getElementById('perfilBadges').innerHTML = `
    <span class="badge badge--${tipoBadge}">${ETIQUETAS_TIPO[tipoBadge]}</span>
    <span class="badge badge--verificado">Verificado</span>
  `;

  document.getElementById('perfilNombre').textContent = ab.nombre_completo;

  const ubicacion = [ab.ciudad, ab.provincia].filter(Boolean).join(', ');
  document.getElementById('perfilUbicacion').textContent = ubicacion;

  const especialidades = ab.especialidades ?? [];
  document.getElementById('perfilEspecialidades').innerHTML = especialidades
    .map(e => `<span class="chip">${escaparHtml(e)}</span>`)
    .join('');

  document.getElementById('perfilRating').innerHTML = generarEstrellas(ab.rating_promedio, ab.total_resenas);

  const precioEl = document.getElementById('perfilPrecio');
  precioEl.textContent = ab.precio_consulta
    ? `Consulta desde $${ab.precio_consulta}`
    : '';

  const descripcionSeccion = document.getElementById('perfilDescripcionSeccion');
  if (ab.descripcion?.trim()) {
    descripcionSeccion.hidden = false;
    document.getElementById('perfilDescripcion').textContent = ab.descripcion;
  }
}

// ─── Renderizado de reseñas ───────────────────────────────────────────────────
function renderizarResenas(resenas) {
  const lista = document.getElementById('resenasLista');
  const estadoVacio = document.getElementById('estadoSinResenas');

  if (!resenas || resenas.length === 0) {
    lista.innerHTML = '';
    estadoVacio.hidden = false;
    return;
  }

  estadoVacio.hidden = true;
  lista.innerHTML = resenas.map(generarResenaItem).join('');
}

function generarResenaItem(r) {
  const iniciales = obtenerIniciales(r.cliente_nombre);
  const fecha = formatearFecha(r.created_at);

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
        <div class="resena-item__avatar" aria-hidden="true">
          <div class="avatar-placeholder">${escaparHtml(iniciales)}</div>
        </div>
        <div class="resena-item__meta">
          <div class="rating">
            ${generarEstrellas(r.calificacion, 1)}
          </div>
          <p class="resena-item__fecha">${fecha}</p>
        </div>
      </div>
      ${r.comentario ? `<p class="resena-item__comentario">${escaparHtml(r.comentario)}</p>` : ''}
      ${respuestaHtml}
    </article>
  `;
}

// ─── Configuración de eventos ─────────────────────────────────────────────────
function configurarEventos(abogadoId) {
  document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
    await api.auth.cerrarSesion();
    window.location.href = '/';
  });

  const btnSolicitar = document.getElementById('btnSolicitar');
  if (btnSolicitar) {
    btnSolicitar.addEventListener('click', () => {
      document.getElementById('seccionBotonSolicitar').hidden = true;
      document.getElementById('seccionSolicitud').hidden = false;
      document.getElementById('seccionSolicitud').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  document.getElementById('btnCancelarSolicitud').addEventListener('click', () => {
    document.getElementById('seccionSolicitud').hidden = true;
    document.getElementById('seccionBotonSolicitar').hidden = false;
  });

  const textarea = document.getElementById('descripcionCaso');
  const contador = document.getElementById('contadorDescripcion');
  textarea.addEventListener('input', () => {
    contador.textContent = `${textarea.value.length} / 500`;
  });

  document.getElementById('formSolicitud').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarEnvioSolicitud(abogadoId);
  });
}

// ─── Envío de la solicitud ────────────────────────────────────────────────────
async function manejarEnvioSolicitud(abogadoId) {
  const descripcionCaso = document.getElementById('descripcionCaso').value.trim();
  const disponibilidadHoraria = document.querySelector('input[name="disponibilidad_horaria"]:checked')?.value ?? '';
  const errorEl = document.getElementById('errorSolicitud');
  const btnEl = document.getElementById('btnEnviarSolicitud');

  btnEl.disabled = true;
  btnEl.textContent = 'Enviando...';
  errorEl.textContent = '';

  try {
    const { error } = await api.solicitudes.crearSolicitud(abogadoId, {
      descripcion_caso: descripcionCaso,
      disponibilidad_horaria: disponibilidadHoraria,
    });

    if (error) {
      const mensaje = mensajeAmigable(error, 'Ocurrió un error. Intente de nuevo.');
      errorEl.textContent = mensaje;
      toast.error(mensaje);
      return;
    }

    document.getElementById('formSolicitud').hidden = true;
    document.getElementById('confirmacionSolicitud').hidden = false;
    toast.exito('Solicitud enviada.');

  } catch (err) {
    console.error('[perfil-abogado] Error inesperado al enviar solicitud:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
    toast.error('Ocurrió un error. Intente de nuevo.');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Enviar solicitud';
  }
}

// ─── Helpers de presentación ──────────────────────────────────────────────────
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
