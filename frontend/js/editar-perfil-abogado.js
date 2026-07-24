// editar-perfil-abogado.js
// Lógica de editar-perfil-abogado.html: página independiente de edición de
// perfil, antes la pestaña "Editar perfil" de panel-abogado.html (CLAUDE.md
// §2, módulo 2). Importa todo desde api.js — nunca consulta Supabase
// directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';
import { inicializarHeader, actualizarAvatarHeader } from './header.js';

// ─── Estado de la página ──────────────────────────────────────────────────
let perfilActual = null;
let abogadoActual = null;
let provinciasCache = [];
let zonasServicioSeleccionadas = new Map(); // provincia_id -> canton_id|null de las zonas adicionales marcadas
let cantonesPorProvinciaCache = new Map();  // provincia_id -> cantones[], evita refetch al re-renderizar

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[editar-perfil-abogado] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || perfilActual.rol !== 'abogado') {
    window.location.href = '/';
    return;
  }

  abogadoActual = await api.abogados.getPerfilPropio();
  if (!abogadoActual) {
    mostrarError();
    return;
  }

  inicializarHeader({
    rol: 'abogado',
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico: `/pages/perfil-abogado?id=${abogadoActual.id}`,
  });

  renderizarFoto();
  await cargarProvincias();
  await rellenarFormularioPerfil();

  mostrarContenido();
  configurarEventos();
}

function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarContenido() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoPanel').hidden = false;
}

function configurarEventos() {
  document.getElementById('btnCambiarFoto').addEventListener('click', () => {
    document.getElementById('inputFoto').click();
  });
  document.getElementById('inputFoto').addEventListener('change', manejarCambioFoto);

  document.getElementById('perfilDescripcion').addEventListener('input', actualizarContadorDescripcion);
  document.getElementById('formPerfil').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarGuardarPerfil();
  });

  document.getElementById('perfilProvincia').addEventListener('change', manejarCambioProvinciaPrincipal);
  document.getElementById('zonasServicioPerfil').addEventListener('change', manejarCambioZonaServicio);

  // Visibilidad pública: cualquier campo que aparezca en la tarjeta de
  // vista previa dispara un re-render inmediato, sin esperar a guardar.
  document.getElementById('especialidadesPerfil').addEventListener('change', renderizarPreview);
  document.getElementById('perfilPrecio').addEventListener('input', renderizarPreview);
  document.getElementById('perfilProvincia').addEventListener('change', renderizarPreview);
  document.getElementById('perfilCanton').addEventListener('change', renderizarPreview);
  document.getElementById('zonasServicioPerfil').addEventListener('change', renderizarPreview);

  document.getElementById('visiblePublico').addEventListener('change', () => {
    actualizarVisibilidadUI();
    renderizarPreview();
  });
  document.getElementById('camposPublicosLista').addEventListener('change', renderizarPreview);
  document.getElementById('formVisibilidad').addEventListener('submit', manejarGuardarVisibilidad);
}

// ─── Foto ──────────────────────────────────────────────────────────────────
function renderizarFoto() {
  document.getElementById('perfilFotoAvatar').innerHTML = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);
}

const FOTO_TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

async function manejarCambioFoto(e) {
  const archivo = e.target.files[0];
  if (!archivo) return;

  const estadoEl = document.getElementById('fotoEstado');

  if (!archivo.type.startsWith('image/')) {
    const mensaje = 'El archivo debe ser una imagen.';
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
    e.target.value = '';
    return;
  }

  if (archivo.size > FOTO_TAMANO_MAXIMO_BYTES) {
    const mensaje = 'La imagen no debe superar los 10MB.';
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
    e.target.value = '';
    return;
  }

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
  renderizarFoto();
  actualizarAvatarHeader(perfilActual.foto_url, perfilActual.nombre_completo);
  actualizarProgresoPerfil();
  estadoEl.textContent = 'Foto actualizada.';
  toast.exito('Foto actualizada.');
  e.target.value = '';
}

// ─── Ubicación (provincia, cantón, zonas de servicio) ────────────────────
async function cargarProvincias() {
  provinciasCache = await api.geo.getProvincias();

  const select = document.getElementById('perfilProvincia');
  provinciasCache.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.nombre;
    select.appendChild(option);
  });
}

async function cargarCantones(provinciaId, cantonSeleccionadoId = null) {
  const select = document.getElementById('perfilCanton');
  select.innerHTML = '';

  if (!provinciaId) {
    select.disabled = true;
    select.innerHTML = '<option value="">Seleccione primero una provincia</option>';
    return;
  }

  select.disabled = false;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Seleccione su cantón';
  select.appendChild(placeholder);

  const cantones = await api.geo.getCantonesPorProvincia(provinciaId);
  cantones.forEach(c => {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = c.nombre;
    select.appendChild(option);
  });

  if (cantonSeleccionadoId) select.value = String(cantonSeleccionadoId);
}

async function obtenerCantonesCacheados(provinciaId) {
  if (!cantonesPorProvinciaCache.has(provinciaId)) {
    cantonesPorProvinciaCache.set(provinciaId, await api.geo.getCantonesPorProvincia(provinciaId));
  }
  return cantonesPorProvinciaCache.get(provinciaId);
}

async function renderizarZonasServicio() {
  const provinciaPrincipalId = document.getElementById('perfilProvincia').value;
  const contenedor = document.getElementById('zonasServicioPerfil');

  const opciones = provinciasCache.filter(p => String(p.id) !== String(provinciaPrincipalId));

  // Precarga los cantones de las provincias ya marcadas, en paralelo.
  await Promise.all(
    opciones
      .filter(p => zonasServicioSeleccionadas.has(p.id))
      .map(p => obtenerCantonesCacheados(p.id))
  );

  contenedor.innerHTML = opciones
    .map(p => {
      const marcada = zonasServicioSeleccionadas.has(p.id);
      const cantonSeleccionadoId = zonasServicioSeleccionadas.get(p.id);
      const selectorCantonHtml = marcada
        ? generarSelectorCantonZona(p.id, cantonesPorProvinciaCache.get(p.id) ?? [], cantonSeleccionadoId)
        : '';

      return `
        <div class="zona-servicio-item">
          <label class="radio-pills__opcion">
            <input type="checkbox" name="zona_servicio" value="${p.id}" ${marcada ? 'checked' : ''}>
            <span>${escaparHtml(p.nombre)}</span>
          </label>
          ${selectorCantonHtml}
        </div>
      `;
    })
    .join('');
}

function generarSelectorCantonZona(provinciaId, cantones, cantonSeleccionadoId) {
  const opcionesHtml = cantones
    .map(c => `<option value="${c.id}" ${Number(cantonSeleccionadoId) === c.id ? 'selected' : ''}>${escaparHtml(c.nombre)}</option>`)
    .join('');

  return `
    <select class="campo__input zona-servicio-item__canton" data-zona-canton="${provinciaId}">
      <option value="">Toda la provincia</option>
      ${opcionesHtml}
    </select>
  `;
}

function manejarCambioProvinciaPrincipal() {
  const provinciaId = document.getElementById('perfilProvincia').value;

  // La provincia principal no puede ser también una zona de servicio adicional.
  if (provinciaId) zonasServicioSeleccionadas.delete(Number(provinciaId));

  cargarCantones(provinciaId || null);
  renderizarZonasServicio();
}

async function manejarCambioZonaServicio(e) {
  const chk = e.target.closest('input[name="zona_servicio"]');
  if (chk) {
    const provinciaId = Number(chk.value);
    if (chk.checked) zonasServicioSeleccionadas.set(provinciaId, null);
    else zonasServicioSeleccionadas.delete(provinciaId);
    await renderizarZonasServicio();
    return;
  }

  const select = e.target.closest('select[data-zona-canton]');
  if (select) {
    const provinciaId = Number(select.dataset.zonaCanton);
    const cantonId = select.value ? Number(select.value) : null;
    if (zonasServicioSeleccionadas.has(provinciaId)) {
      zonasServicioSeleccionadas.set(provinciaId, cantonId);
    }
  }
}

// ─── Formulario ────────────────────────────────────────────────────────────
async function rellenarFormularioPerfil() {
  document.getElementById('perfilDescripcion').value = abogadoActual.descripcion ?? '';
  actualizarContadorDescripcion();

  document.querySelectorAll('#especialidadesPerfil input[type="checkbox"]').forEach(chk => {
    chk.checked = (abogadoActual.especialidades ?? []).includes(chk.value);
  });

  document.getElementById('perfilPrecio').value = abogadoActual.precio_consulta ?? '';

  document.getElementById('perfilProvincia').value = abogadoActual.provincia_id ?? '';
  await cargarCantones(abogadoActual.provincia_id, abogadoActual.canton_id);

  const zonas = await api.abogados.getZonasServicio();
  zonasServicioSeleccionadas = new Map(zonas.map(z => [z.provincia_id, z.canton_id]));
  await renderizarZonasServicio();

  actualizarProgresoPerfil();

  document.getElementById('visiblePublico').checked = Boolean(abogadoActual.visible_publico);
  const camposPublicos = abogadoActual.campos_publicos ?? {};
  document.querySelectorAll('#camposPublicosLista input[type="checkbox"]').forEach(chk => {
    chk.checked = Boolean(camposPublicos[chk.value]);
  });
  actualizarVisibilidadUI();
  renderizarPreview();
}

// 5 campos = 20% cada uno: foto, descripción, especialidades, precio, provincia
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

function actualizarProgresoPerfil() {
  const porcentaje = calcularPorcentajePerfil();
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
  const provinciaRaw = document.getElementById('perfilProvincia').value;
  const cantonRaw = document.getElementById('perfilCanton').value;
  const provincia_id = provinciaRaw ? Number(provinciaRaw) : null;
  const canton_id = cantonRaw ? Number(cantonRaw) : null;
  const zonasServicio = Array.from(zonasServicioSeleccionadas, ([zonaProvinciaId, zonaCantonId]) => ({
    provincia_id: zonaProvinciaId,
    canton_id: zonaCantonId,
  }));

  try {
    const [resultadoAbogado, resultadoZonas] = await Promise.all([
      api.abogados.actualizarPerfilAbogado({ descripcion, especialidades, precio_consulta, provincia_id, canton_id }),
      api.abogados.actualizarZonasServicio(zonasServicio),
    ]);

    if (resultadoAbogado.error || resultadoZonas.error) {
      const mensaje = mensajeAmigable(resultadoAbogado.error ?? resultadoZonas.error, 'Ocurrió un error. Intente de nuevo.');
      errorEl.textContent = mensaje;
      toast.error(mensaje);
      return;
    }

    abogadoActual = resultadoAbogado.data;
    exitoEl.hidden = false;
    actualizarProgresoPerfil();
    toast.exito('Perfil guardado.');

  } catch (err) {
    console.error('[editar-perfil-abogado] Error inesperado al guardar el perfil:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
    toast.error('Ocurrió un error. Intente de nuevo.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
}

// ─── Visibilidad pública ───────────────────────────────────────────────────
function actualizarVisibilidadUI() {
  const activo = document.getElementById('visiblePublico').checked;
  document.getElementById('camposPublicosContenedor').hidden = !activo;
  document.getElementById('previewInactivo').hidden = activo;
  document.getElementById('previewTarjetaContenedor').hidden = !activo;
}

function leerCamposPublicosSeleccionados() {
  const seleccionados = {};
  document.querySelectorAll('#camposPublicosLista input[type="checkbox"]').forEach(chk => {
    seleccionados[chk.value] = chk.checked;
  });
  return seleccionados;
}

// Vista previa en tiempo real de la tarjeta pública (busqueda.html), armada
// con los datos ya cargados del perfil y el estado actual (sin guardar) de
// los checkboxes de especialidades/precio/provincia/cantón/campos públicos —
// mismo markup que generarCardAbogado() de busqueda.js, para que la
// previsualización sea fiel a la tarjeta real.
function renderizarPreview() {
  if (!document.getElementById('visiblePublico').checked) return;

  const contenedor = document.getElementById('previewTarjetaContenedor');
  const campos = leerCamposPublicosSeleccionados();

  const fotoUrl = campos.foto && perfilActual.foto_url
    ? api.storage.getPublicUrl('avatares', perfilActual.foto_url)
    : null;
  const avatarHtml = fotoUrl
    ? `<img src="${escaparAtrib(fotoUrl)}" alt="Foto de ${escaparAtrib(perfilActual.nombre_completo)}">`
    : `<div class="avatar-placeholder" aria-hidden="true">${escaparHtml(obtenerIniciales(perfilActual.nombre_completo))}</div>`;

  const provinciaSelect = document.getElementById('perfilProvincia');
  const cantonSelect = document.getElementById('perfilCanton');
  const provinciaNombre = provinciaSelect.selectedOptions[0]?.textContent ?? '';
  const cantonNombre = cantonSelect.selectedOptions[0]?.textContent ?? '';
  const ubicacion = campos.provincia
    ? [cantonSelect.value ? cantonNombre : '', provinciaSelect.value ? provinciaNombre : ''].filter(Boolean).map(escaparHtml).join(', ')
    : '';

  const especialidadesSeleccionadas = campos.especialidades
    ? Array.from(document.querySelectorAll('#especialidadesPerfil input[type="checkbox"]:checked')).map(chk => chk.value)
    : [];
  const especialidades = especialidadesSeleccionadas.slice(0, 3);
  const extras = especialidadesSeleccionadas.length - 3;
  const especialidadesHtml = especialidades.map(e => `<span class="chip">${escaparHtml(e)}</span>`).join('');
  const masHtml = extras > 0 ? `<span class="chip chip--mas">+${extras}</span>` : '';

  const precioActual = document.getElementById('perfilPrecio').value;
  const precioHtml = campos.precio && precioActual
    ? `<p class="card-abogado__precio">Consulta desde $${escaparHtml(precioActual)}</p>`
    : '';

  const zonaHtml = campos.zonas_servicio && zonasServicioSeleccionadas.size > 0
    ? `<span class="badge badge--zona-servicio">También atiende en otras provincias</span>`
    : '';

  const tipoBadge = abogadoActual.estudio_id ? 'estudio' : (abogadoActual.red_id ? 'red' : 'individual');
  const etiquetaTipo = { individual: 'Individual', estudio: 'Estudio', red: 'Red' }[tipoBadge];

  contenedor.innerHTML = `
    <article class="card-abogado" role="listitem">
      <div class="card-abogado__header">
        <div class="card-abogado__avatar">${avatarHtml}</div>
        <div class="card-abogado__meta">
          <div class="card-abogado__badges">
            <span class="badge badge--${tipoBadge}">${etiquetaTipo}</span>
            <span class="badge badge--verificado">Verificado</span>
          </div>
          <h3 class="card-abogado__nombre">${escaparHtml(perfilActual.nombre_completo)}</h3>
          ${ubicacion ? `<p class="card-abogado__ubicacion">${ubicacion}</p>` : ''}
          ${zonaHtml}
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
            ${campos.rating ? generarEstrellasPreview(abogadoActual.rating_promedio, abogadoActual.total_resenas) : generarEstrellasPreview(null, 0)}
          </div>
          ${precioHtml}
        </div>
        <span class="btn btn--primario btn--sm" aria-hidden="true">Ver perfil</span>
      </div>
    </article>
  `;
}

function generarEstrellasPreview(rating, total) {
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
    <span class="rating__estrellas" aria-label="${rating} de 5 estrellas">${llenas}${vacias}</span>
    <span class="rating__count">(${total})</span>
  `;
}

async function manejarGuardarVisibilidad(e) {
  e.preventDefault();

  const btn = document.getElementById('btnGuardarVisibilidad');
  const errorEl = document.getElementById('errorVisibilidad');
  const exitoEl = document.getElementById('exitoVisibilidad');

  errorEl.textContent = '';
  exitoEl.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const visible_publico = document.getElementById('visiblePublico').checked;
  const campos_publicos = leerCamposPublicosSeleccionados();

  try {
    const { data, error } = await api.abogados.actualizarPerfilAbogado({ visible_publico, campos_publicos });

    if (error) {
      const mensaje = mensajeAmigable(error, 'Ocurrió un error. Intente de nuevo.');
      errorEl.textContent = mensaje;
      toast.error(mensaje);
      return;
    }

    abogadoActual = data;
    exitoEl.hidden = false;
    toast.exito('Configuración de visibilidad guardada.');

  } catch (err) {
    console.error('[editar-perfil-abogado] Error inesperado al guardar visibilidad:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
    toast.error('Ocurrió un error. Intente de nuevo.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar configuración de visibilidad';
  }
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
