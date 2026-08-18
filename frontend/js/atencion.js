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
  mensaje_nuevo:      { titulo: 'Mensajes sin leer',                 boton: 'Ver chat' },
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

  // api.clientes.getDatosAtencion() (a diferencia de las funciones sueltas
  // que arma internamente) sí expone si alguna de las tres consultas falló,
  // para no confundir "no se pudo cargar" con "genuinamente sin pendientes".
  const { solicitudes, casosTablon, notificacionesNoLeidas, error } = await api.clientes.getDatosAtencion();
  if (error) {
    mostrarError();
    return;
  }

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
      const casoId = idCasoDesdeUrl(n.url_destino);
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

  // TIPO 5 — Mensaje de chat sin leer (celeste, ti-message). Igual patrón
  // que TIPO 2: se aproxima con las notificaciones no leídas de tipo
  // 'mensaje_nuevo' (migración 085), cruzadas contra solicitudes para
  // resolver el nombre del abogado remitente.
  const mensajesSinLeerPorSolicitud = new Map();
  notificacionesNoLeidas
    .filter(n => n.tipo === 'mensaje_nuevo' && n.url_destino)
    .forEach(n => {
      const solicitudId = idSolicitudDesdeUrl(n.url_destino);
      if (!solicitudId) return;
      mensajesSinLeerPorSolicitud.set(solicitudId, (mensajesSinLeerPorSolicitud.get(solicitudId) ?? 0) + 1);
    });
  solicitudes
    .filter(s => mensajesSinLeerPorSolicitud.has(s.id))
    .forEach(s => {
      const n = mensajesSinLeerPorSolicitud.get(s.id);
      items.push({
        prioridad: 5,
        tipo: 'mensaje_nuevo',
        clase: 'atencion-item--info',
        icono: 'ti-message',
        texto: `Tiene ${n} ${n === 1 ? 'mensaje' : 'mensajes'} sin leer de ${escaparHtml(s.abogado_nombre)}.`,
        url: urlSolicitudChat(s),
      });
    });

  return items.sort((a, b) => a.prioridad - b.prioridad);
}

// url_destino la escribe un trigger de la base de datos, pero acá no se
// navega con ella (a diferencia de urlSegura() en notificaciones.js) —
// solo se le extrae el id de caso, así que basta con no dejar que un valor
// malformado tire una excepción no capturada y rompa toda la carga de la
// página (misma idea, alcance más chico: no hace falta same-origin porque
// el resultado nunca llega a un href).
function idCasoDesdeUrl(url) {
  try {
    return new URL(url, window.location.origin).searchParams.get('id');
  } catch {
    return null;
  }
}

// Mismo criterio que idCasoDesdeUrl(), pero para el parámetro ?solicitud=
// que usa fn_notificar_mensaje_nuevo (migración 085).
function idSolicitudDesdeUrl(url) {
  try {
    return new URL(url, window.location.origin).searchParams.get('solicitud');
  } catch {
    return null;
  }
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

// Variante de urlSolicitud() para el item de "mensaje sin leer": a diferencia
// de esa función, acá sí hace falta el id en ambos orígenes porque
// solicitudes-tablon.js también soporta abrir un chat puntual vía
// ?solicitud=<id>&chat=true (Parte 4/migración 083), aunque esa página no
// tenga el mecanismo de "resaltar" tarjeta que sí usa el resto de items.
function urlSolicitudChat(s) {
  const pagina = s.caso_tablon_id ? 'solicitudes-tablon' : 'solicitudes-directas';
  return `/pages/${pagina}?solicitud=${s.id}&chat=true`;
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
