// atencion.js
// Lógica de la página atencion.html: listado completo de "Requiere su
// atención" (sin el límite de 3 del resumen en panel-cliente.html, Inicio),
// agrupado por tipo. Página exclusiva de rol cliente — mismo alcance que el
// resumen del dashboard que enlaza acá.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { rutaPanelPropio } from './utils.js';
import { inicializarHeader } from './header.js';

// Metadatos de presentación por tipo — mismo orden de prioridad que
// panel-cliente.js/getItemsAtencion(). El texto del botón de acción es lo
// único que no tiene equivalente en la versión resumida del dashboard
// (ahí el link genérico "Ver →" alcanza).
const TIPOS_ATENCION = {
  aceptada:           { titulo: 'Solicitudes aceptadas',             boton: 'Contactar abogado' },
  aplicacion_tablon:  { titulo: 'Casos con aplicaciones nuevas',      boton: 'Ver aplicaciones' },
  expira:             { titulo: 'Solicitudes por expirar',           boton: 'Ver solicitud' },
  resena:             { titulo: 'Reseñas pendientes',                boton: 'Dejar reseña' },
};

// ─── Entry point ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[atencion] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  const perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || perfilActual.rol !== 'cliente') {
    window.location.href = '/';
    return;
  }

  document.getElementById('btnVolverPanel').href = rutaPanelPropio(perfilActual.rol);
  inicializarHeader({ rol: 'cliente', nombre: perfilActual.nombre_completo, fotoPath: perfilActual.foto_url });

  const [solicitudes, casosTablon, notificacionesNoLeidas] = await Promise.all([
    api.solicitudes.getSolicitudesCliente(),
    api.tablon.getMisCasos(),
    api.notificaciones.getNoLeidas(),
  ]);

  const items = getItemsAtencion(solicitudes, casosTablon, notificacionesNoLeidas);
  renderizarGrupos(items);

  mostrarContenido();
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

// ─── "Requiere su atención" (lista completa) ──────────────────────────────────
// Copia deliberada de getItemsAtencion() en panel-cliente.js, sin el límite
// de 3 items — mismo criterio de duplicación entre páginas que ya usan
// formatearFecha()/escaparHtml() en este proyecto (cada página queda
// autocontenida en vez de depender de un módulo compartido). Cualquier
// cambio en la lógica de negocio de los 4 tipos debe aplicarse en ambos
// archivos.
function getItemsAtencion(solicitudes, casosTablon, notificacionesNoLeidas) {
  const items = [];

  // TIPO 1 — Solicitud aceptada. Deduplicado por abogado_id: si hay varias
  // ACEPTADA con el mismo abogado, solo cuenta la más reciente — las listas
  // de getSolicitudesCliente() ya vienen ordenadas created_at DESC.
  const abogadosConAceptadaVista = new Set();
  solicitudes
    .filter(s => s.estado === 'ACEPTADA')
    .forEach(s => {
      if (abogadosConAceptadaVista.has(s.abogado_id)) return;
      abogadosConAceptadaVista.add(s.abogado_id);
      items.push({
        prioridad: 1,
        tipo: 'aceptada',
        clase: 'atencion-item--exito',
        icono: 'ti-check',
        texto: `${escaparHtml(s.abogado_nombre)} aceptó su solicitud. Ya puede contactarlo.`,
        url: urlSolicitud(s),
      });
    });

  // TIPO 2 — Caso del Tablón con aplicaciones sin revisar. "Sin revisar" se
  // aproxima con las notificaciones no leídas de tipo 'tablon_nueva_aplicacion'
  // (CLAUDE.md §21) — no existe todavía una columna "revisado" en aplicaciones_tablon.
  const aplicacionesSinRevisarPorCaso = new Map();
  notificacionesNoLeidas
    .filter(n => n.tipo === 'tablon_nueva_aplicacion' && n.url_destino)
    .forEach(n => {
      const casoId = new URL(n.url_destino, window.location.origin).searchParams.get('id');
      if (!casoId) return;
      aplicacionesSinRevisarPorCaso.set(casoId, (aplicacionesSinRevisarPorCaso.get(casoId) ?? 0) + 1);
    });
  casosTablon
    .filter(c => aplicacionesSinRevisarPorCaso.has(c.id))
    .forEach(c => {
      const n = aplicacionesSinRevisarPorCaso.get(c.id);
      items.push({
        prioridad: 2,
        tipo: 'aplicacion_tablon',
        clase: 'atencion-item--info',
        icono: 'ti-speakerphone',
        texto: `Su caso "${escaparHtml(c.titulo)}" recibió ${n} ${n === 1 ? 'nueva aplicación' : 'nuevas aplicaciones'}.`,
        url: `/pages/tablon-caso?id=${c.id}`,
      });
    });

  // TIPO 3 — Solicitud PENDIENTE que expira en menos de 12h.
  // expires_at = created_at + 48h (migración 20260625_006_solicitudes.sql).
  solicitudes
    .filter(s => s.estado === 'PENDIENTE' && horasHastaExpirar(s.expires_at) < 12)
    .forEach(s => {
      items.push({
        prioridad: 3,
        tipo: 'expira',
        clase: 'atencion-item--advertencia',
        icono: 'ti-clock',
        texto: `Su solicitud a ${escaparHtml(s.abogado_nombre)} expira en menos de 12 horas.`,
        url: urlSolicitud(s),
      });
    });

  // TIPO 4 — Solicitud COMPLETADA sin reseña, 24h después de completada
  // (mismo umbral que exige la política RLS "cliente_inserta_resena").
  solicitudes
    .filter(s => s.estado === 'COMPLETADA' && !s.tiene_resena && haPasadoTiempoMinimoResena(s.completada_at))
    .forEach(s => {
      items.push({
        prioridad: 4,
        tipo: 'resena',
        clase: 'atencion-item--amarillo',
        icono: 'ti-star',
        texto: `Puede dejar una reseña a ${escaparHtml(s.abogado_nombre)} por su consulta.`,
        url: urlSolicitud(s),
      });
    });

  return items.sort((a, b) => a.prioridad - b.prioridad);
}

function horasHastaExpirar(expiresAtIso) {
  if (!expiresAtIso) return Infinity;
  return (new Date(expiresAtIso).getTime() - Date.now()) / 3600000;
}

function haPasadoTiempoMinimoResena(completadaAtIso) {
  if (!completadaAtIso) return false;
  return Date.now() - new Date(completadaAtIso).getTime() >= 24 * 60 * 60 * 1000;
}

// Solicitudes directas resaltan la tarjeta propia (CLAUDE.md módulo 5, §39);
// las del Tablón no tienen ese mecanismo — se manda al listado general.
function urlSolicitud(s) {
  return s.caso_tablon_id
    ? '/pages/solicitudes-tablon'
    : `/pages/solicitudes-directas?solicitud=${s.id}`;
}

// ─── Render: agrupado por tipo, con descripción completa y botón de acción ───
function renderizarGrupos(items) {
  const contenedor = document.getElementById('gruposAtencion');
  const vacio = document.getElementById('estadoSinAtencion');
  const subtitulo = document.getElementById('subtituloAtencion');

  if (items.length === 0) {
    contenedor.innerHTML = '';
    vacio.hidden = false;
    subtitulo.textContent = 'No tiene nada pendiente en este momento.';
    return;
  }

  vacio.hidden = true;
  subtitulo.textContent = `${items.length} ${items.length === 1 ? 'item requiere' : 'items requieren'} su atención.`;

  // items ya viene ordenado por prioridad — agrupar preservando ese orden
  // hace que las secciones aparezcan en el mismo orden que los tipos.
  const grupos = new Map();
  items.forEach(item => {
    if (!grupos.has(item.tipo)) grupos.set(item.tipo, []);
    grupos.get(item.tipo).push(item);
  });

  contenedor.innerHTML = Array.from(grupos.entries())
    .map(([tipo, itemsDelTipo]) => generarGrupo(tipo, itemsDelTipo))
    .join('');
}

function generarGrupo(tipo, itemsDelTipo) {
  const meta = TIPOS_ATENCION[tipo];
  return `
    <section class="atencion-grupo">
      <h2 class="panel-inicio__seccion-titulo">${escaparHtml(meta.titulo)}</h2>
      <div class="atencion-lista">
        ${itemsDelTipo.map(item => generarItemAtencionCompleto(item, meta.boton)).join('')}
      </div>
    </section>
  `;
}

function generarItemAtencionCompleto(item, textoBoton) {
  return `
    <article class="atencion-item atencion-item--completo ${item.clase}">
      <span class="atencion-item__icono" aria-hidden="true"><i class="ti ${item.icono}"></i></span>
      <span class="atencion-item__texto">${item.texto}</span>
      <a href="${escaparAtrib(item.url)}" class="btn btn--primario btn--sm">${escaparHtml(textoBoton)}</a>
    </article>
  `;
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
