// busqueda.js
// Lógica de la página busqueda.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, generarBotonFavorito } from './utils.js';
import { inicializarHeader } from './header.js';

// ─── Etiquetas visibles para tipo_badge ───────────────────────────────────────
const ETIQUETAS_TIPO = {
  individual: 'Individual',
  estudio:    'Estudio',
  red:        'Red',
};

// ─── Estado de la página ──────────────────────────────────────────────────────
let tipoActivo = ''; // '' = todos | 'individual' | 'estudio' | 'red'
let provinciasCache = [];      // catálogo de provincias, cargado una vez
let provinciaFiltroActiva = null; // { id, nombre } de la provincia buscada, o null
let esCliente = false;              // solo clientes ven/usan el corazón de favoritos
let favoritosIds = new Set();       // abogado_id favoritos del cliente autenticado

// ─── Entry point ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  // 1. Inicializar Supabase con la configuración de /api/config
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[busqueda] Error al cargar configuración:', err);
    mostrarEstado('error');
    return;
  }

  // 2. La búsqueda es pública: no se exige sesión. El header centralizado
  // resuelve por su cuenta si hay una sesión activa y renderiza el estado
  // correspondiente (nunca "Salir" e "Iniciar sesión" a la vez).
  const perfilActual = await inicializarHeader();
  esCliente = perfilActual?.rol === 'cliente';
  if (esCliente) {
    favoritosIds = new Set(await api.favoritos.getMisFavoritosIds());
  }

  // 3. Cargar catálogo de provincias para el filtro
  provinciasCache = await api.geo.getProvincias();
  poblarSelectProvincias();

  // 4. Cargar resultados iniciales (sin filtros: todos los abogados visibles)
  await ejecutarBusqueda();

  // 5. Registrar todos los eventos de la UI
  configurarEventos();
}

function poblarSelectProvincias() {
  const select = document.getElementById('filtroProvincia');
  provinciasCache.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.nombre;
    select.appendChild(option);
  });
}

// ─── Configuración de eventos ─────────────────────────────────────────────────
function configurarEventos() {
  // Formulario de filtros
  document.getElementById('formBusqueda').addEventListener('submit', (e) => {
    e.preventDefault();
    ejecutarBusqueda();
  });

  // Botón "Ver todos"
  document.getElementById('btnLimpiar').addEventListener('click', limpiarFiltros);

  // Botón "Ver todos" dentro del estado vacío
  document.getElementById('btnVerTodos').addEventListener('click', limpiarFiltros);

  // Botón "Reintentar" en estado de error
  document.getElementById('btnReintentar').addEventListener('click', ejecutarBusqueda);

  // Botones de tipo de perfil
  document.querySelectorAll('.filtro-tipo__btn').forEach(btn => {
    btn.addEventListener('click', () => cambiarTipo(btn.dataset.tipo));
  });

  document.getElementById('gridResultados').addEventListener('click', manejarClickFavorito);
}

// ─── Favoritos ─────────────────────────────────────────────────────────────
async function manejarClickFavorito(e) {
  const btn = e.target.closest('[data-accion="toggle-favorito"]');
  if (!btn) return;

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

  btn.classList.toggle('btn-favorito--activo', esFavorito);
  btn.setAttribute('aria-pressed', String(esFavorito));
  btn.setAttribute('aria-label', esFavorito ? 'Quitar de favoritos' : 'Agregar a favoritos');
  btn.querySelector('svg path').setAttribute('fill', esFavorito ? 'currentColor' : 'none');
  btn.disabled = false;

  toast.info(esFavorito ? 'Agregado a favoritos.' : 'Quitado de favoritos.');
}

// ─── Filtro por tipo ──────────────────────────────────────────────────────────
function cambiarTipo(tipo) {
  tipoActivo = tipo;

  // Actualizar estado visual de los botones
  document.querySelectorAll('.filtro-tipo__btn').forEach(btn => {
    btn.classList.toggle('filtro-tipo__btn--activo', btn.dataset.tipo === tipo);
  });

  ejecutarBusqueda();
}

// ─── Ejecutar búsqueda ────────────────────────────────────────────────────────
async function ejecutarBusqueda() {
  const filtros = leerFiltros();

  provinciaFiltroActiva = filtros.provincia_id
    ? provinciasCache.find(p => p.id === filtros.provincia_id) ?? null
    : null;

  mostrarEstado('cargando');
  actualizarChipsFiltros(filtros);

  const { data, error } = await api.abogados.buscar(filtros);

  if (error) {
    mostrarEstado('error');
    return;
  }

  if (data.length === 0) {
    mostrarEstado('vacio');
    actualizarConteo(0);
    return;
  }

  mostrarEstado('resultados');
  renderizarResultados(data);
  actualizarConteo(data.length);
}

// ─── Leer valores del formulario ──────────────────────────────────────────────
function leerFiltros() {
  const filtros = {};

  const nombre        = document.getElementById('filtroNombre').value.trim();
  const especialidad  = document.getElementById('filtroEspecialidad').value.trim();
  const caso_frecuente = document.getElementById('filtroCaso').value.trim();
  const provinciaId   = document.getElementById('filtroProvincia').value;

  if (nombre)          filtros.nombre          = nombre;
  if (especialidad)    filtros.especialidad    = especialidad;
  if (caso_frecuente)  filtros.caso_frecuente  = caso_frecuente;
  if (provinciaId)     filtros.provincia_id    = Number(provinciaId);
  if (tipoActivo)       filtros.tipo           = tipoActivo;

  return filtros;
}

// ─── Limpiar filtros ──────────────────────────────────────────────────────────
function limpiarFiltros() {
  document.getElementById('filtroNombre').value       = '';
  document.getElementById('filtroEspecialidad').value = '';
  document.getElementById('filtroCaso').value         = '';
  document.getElementById('filtroProvincia').value    = '';

  // Resetear tipo a "Todos"
  tipoActivo = '';
  document.querySelectorAll('.filtro-tipo__btn').forEach(btn => {
    btn.classList.toggle('filtro-tipo__btn--activo', btn.dataset.tipo === '');
  });

  ejecutarBusqueda();
}

// ─── Control de estados visuales ─────────────────────────────────────────────
function mostrarEstado(estado) {
  document.getElementById('estadoCargando').hidden = estado !== 'cargando';
  document.getElementById('estadoVacio').hidden    = estado !== 'vacio';
  document.getElementById('estadoError').hidden    = estado !== 'error';
  document.getElementById('gridResultados').hidden = estado !== 'resultados';

  if (estado !== 'resultados') {
    document.getElementById('conteoResultados').textContent = '';
  }
}

function actualizarConteo(total) {
  const el = document.getElementById('conteoResultados');
  if (total === 0) {
    el.textContent = '';
    return;
  }
  el.textContent = total === 1
    ? '1 abogado disponible'
    : `${total} abogados disponibles`;
}

// ─── Chips de filtros activos ─────────────────────────────────────────────────
const ETIQUETAS_FILTRO = {
  nombre:         'Nombre',
  especialidad:   'Especialidad',
  caso_frecuente: 'Caso',
  provincia_id:   'Provincia',
  tipo:           'Tipo',
};

function actualizarChipsFiltros(filtros) {
  const contenedor = document.getElementById('filtrosActivos');
  contenedor.innerHTML = '';

  Object.entries(filtros).forEach(([clave, valor]) => {
    if (!valor) return;

    const etiqueta = ETIQUETAS_FILTRO[clave] ?? clave;
    const valorVisible = clave === 'provincia_id'
      ? (provinciasCache.find(p => p.id === valor)?.nombre ?? valor)
      : valor;
    const chip = document.createElement('span');
    chip.className = 'chip-filtro';
    chip.innerHTML = `
      ${escaparHtml(etiqueta)}: <strong>${escaparHtml(valorVisible)}</strong>
      <button class="chip-filtro__quitar" type="button" aria-label="Quitar filtro ${escaparHtml(etiqueta)}">
        &#10005;
      </button>
    `;
    chip.querySelector('button').addEventListener('click', () => quitarFiltro(clave));
    contenedor.appendChild(chip);
  });
}

function quitarFiltro(clave) {
  if (clave === 'nombre') document.getElementById('filtroNombre').value = '';
  if (clave === 'especialidad') document.getElementById('filtroEspecialidad').value = '';
  if (clave === 'caso_frecuente') document.getElementById('filtroCaso').value = '';
  if (clave === 'provincia_id') document.getElementById('filtroProvincia').value = '';
  if (clave === 'tipo') {
    tipoActivo = '';
    document.querySelectorAll('.filtro-tipo__btn').forEach(btn => {
      btn.classList.toggle('filtro-tipo__btn--activo', btn.dataset.tipo === '');
    });
  }
  ejecutarBusqueda();
}

// ─── Renderizar tarjetas ──────────────────────────────────────────────────────
function renderizarResultados(abogados) {
  const grid = document.getElementById('gridResultados');
  grid.innerHTML = abogados.map(generarCardAbogado).join('');
}

function generarCardAbogado(ab) {
  const fotoUrl = ab.foto_url
    ? api.storage.getPublicUrl('avatares', ab.foto_url)
    : null;

  const iniciales = obtenerIniciales(ab.nombre_completo);

  const avatarHtml = fotoUrl
    ? `<img src="${escaparAtrib(fotoUrl)}" alt="Foto de ${escaparAtrib(ab.nombre_completo)}" loading="lazy">`
    : `<div class="avatar-placeholder" aria-hidden="true">${escaparHtml(iniciales)}</div>`;

  const ubicacion = [ab.canton_nombre, ab.provincia_nombre]
    .filter(Boolean)
    .map(escaparHtml)
    .join(', ');

  // Cuando hay un filtro de provincia activo y el abogado solo la cubre como
  // zona de servicio adicional (no es su provincia principal), se lo indica.
  const badgeZonaHtml = provinciaFiltroActiva && ab.provincia_id !== provinciaFiltroActiva.id
    ? `<span class="badge badge--zona-servicio">También atiende en ${escaparHtml(provinciaFiltroActiva.nombre)}</span>`
    : '';

  const especialidades = (ab.especialidades ?? []).slice(0, 3);
  const extras = (ab.especialidades?.length ?? 0) - 3;

  const especialidadesHtml = especialidades
    .map(e => `<span class="chip">${escaparHtml(e)}</span>`)
    .join('');
  const masHtml = extras > 0
    ? `<span class="chip chip--mas">+${extras}</span>`
    : '';

  const precioHtml = ab.precio_consulta
    ? `<p class="card-abogado__precio">Consulta desde $${escaparHtml(String(ab.precio_consulta))}</p>`
    : '';

  // tipo_badge viene de la BD (CASE expression), solo puede ser 'individual'|'estudio'|'red'
  const tipoBadge = ['individual', 'estudio', 'red'].includes(ab.tipo_badge)
    ? ab.tipo_badge
    : 'individual';

  const favoritoHtml = esCliente
    ? generarBotonFavorito(escaparAtrib(ab.id), favoritosIds.has(ab.id))
    : '';

  return `
    <article class="card-abogado" role="listitem">
      ${favoritoHtml}
      <div class="card-abogado__header">
        <div class="card-abogado__avatar">${avatarHtml}</div>
        <div class="card-abogado__meta">
          <div class="card-abogado__badges">
            <span class="badge badge--${tipoBadge}">${ETIQUETAS_TIPO[tipoBadge]}</span>
            <span class="badge badge--verificado">Verificado</span>
          </div>
          <h3 class="card-abogado__nombre">${escaparHtml(ab.nombre_completo)}</h3>
          ${ubicacion ? `<p class="card-abogado__ubicacion">${ubicacion}</p>` : ''}
          ${badgeZonaHtml}
        </div>
      </div>

      ${especialidades.length ? `
        <div class="card-abogado__especialidades">
          ${especialidadesHtml}${masHtml}
        </div>
      ` : ''}

      <div class="card-abogado__footer">
        <div class="card-abogado__info-footer">
          <div class="rating">
            ${generarEstrellas(ab.rating_promedio, ab.total_resenas)}
          </div>
          ${precioHtml}
        </div>
        <a href="/pages/perfil-abogado?id=${escaparAtrib(ab.id)}"
           class="btn btn--primario btn--sm">
          Ver perfil
        </a>
      </div>
    </article>
  `;
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
  const llenas  = '&#9733;'.repeat(redondeado);
  const vacias  = '&#9734;'.repeat(5 - redondeado);

  return `
    <span class="rating__estrellas" aria-label="${rating} de 5 estrellas">
      ${llenas}${vacias}
    </span>
    <span class="rating__count">(${total})</span>
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

// Para valores dentro de atributos HTML (src, href, aria-label, etc.)
function escaparAtrib(str) {
  return escaparHtml(str);
}
