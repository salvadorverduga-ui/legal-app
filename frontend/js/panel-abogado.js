// panel-abogado.js
// Lógica de la página panel-abogado.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, generarCheckboxSeguimiento, generarMenuTarjeta, inicializarMenuTarjeta, abrirModalBloqueo, MENSAJE_AGREGADO_SEGUIMIENTO, aplicarEstadoDeshabilitado, inicializarTooltipsDeshabilitados } from './utils.js';
import { inicializarHeader } from './header.js';

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
  // No debería alcanzarse en la práctica: app.js cierra la sesión de un
  // abogado suspendido apenas detecta perfiles.suspendido = true en su
  // próxima carga de index.html (ver CLAUDE.md). Queda acá solo como
  // defensa para la ventana entre que el admin suspende y esa detección
  // corre, para no mostrar "Verificación pendiente" en su lugar.
  SUSPENDIDO: { texto: 'Cuenta suspendida',       clase: 'badge--rechazado' },
};

const ETIQUETAS_TIPO_SUSCRIPCION = {
  ABOGADO_INDIVIDUAL: 'Abogado individual',
  ESTUDIO_PEQUENO:    'Estudio pequeño',
  ESTUDIO_MEDIANO:    'Estudio mediano',
  ESTUDIO_GRANDE:     'Estudio grande',
};

const ETIQUETAS_ESTADO_CASO_TABLON = {
  ACTIVO:   'Activo',
  EXPIRADO: 'Expirado',
  CERRADO:  'Cerrado',
};

const CLASE_ESTADO_CASO_TABLON = {
  ACTIVO:   'badge--estado-aceptada',
  EXPIRADO: 'badge--estado-expirada',
  CERRADO:  'badge--estado-cancelada',
};

const SECCIONES = ['Inicio', 'Solicitudes', 'Resenas', 'Suscripcion', 'Seguimiento'];

// ─── Estado de la página ──────────────────────────────────────────────────────
let perfilActual = null;         // fila propia de la tabla perfiles
let abogadoActual = null;        // fila propia de la tabla abogados
let estadoVerificacionActual = null; // fila más reciente de verificaciones (o null)
let solicitudesActuales = [];    // caché local: cuenta de pendientes en Inicio y estado de seguimiento

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
  //    y el estado de verificación (para el banner de documentos pendientes) en paralelo.
  [abogadoActual, estadoVerificacionActual] = await Promise.all([
    api.abogados.getPerfilPropio(),
    api.abogados.getEstadoVerificacion(),
  ]);
  if (!abogadoActual) {
    mostrarError();
    return;
  }

  const urlPerfilPublico = `/pages/perfil-abogado?id=${abogadoActual.id}`;
  inicializarHeader({
    rol: 'abogado',
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
    urlPerfilPublico,
    abogadoNoVerificado: abogadoActual.verificacion !== 'VERIFICADO',
  });

  aplicarAccesoLimitado();
  renderizarCabecera();
  renderizarSaludoInicio();
  document.getElementById('inicioVerPerfilPublico').href = urlPerfilPublico;
  actualizarBanners();

  const [resenas, casosTablon, misSeguimientos, notificacionesNoLeidas] = await Promise.all([
    api.resenas.getResenasAbogado(abogadoActual.id),
    api.tablon.getCasosActivos(),
    api.seguimiento.getMisSeguimientos(),
    api.notificaciones.getNoLeidas(),
    cargarSolicitudes(),
    cargarSuscripcion(),
  ]);
  renderizarResenas(resenas);
  renderizarResumenInicio(resenas.length, casosTablon);
  renderizarSeguimiento(misSeguimientos);
  renderizarAtencion(getItemsAtencionAbogado(solicitudesActuales, estadoVerificacionActual, notificacionesNoLeidas));

  mostrarContenido();
  configurarEventos();
  aplicarTabDesdeUrl();
  mostrarModalBienvenidaSiCorresponde();
}

// ─── Modal de bienvenida al ser verificado (una sola vez) ────────────────────
// Se dispara cuando el abogado ya está VERIFICADO y todavía tiene sin leer la
// notificación que generó ese cambio de estado (fn_notificar_estado_verificacion,
// tipo verificacion_aprobada) — es la señal de "acaba de ser aprobado", sin
// necesitar una columna aparte para marcarlo. localStorage evita repetirlo en
// cargas posteriores del panel una vez que el abogado ya lo cerró, incluso si
// por algún motivo la notificación tardara en marcarse como leída.
async function mostrarModalBienvenidaSiCorresponde() {
  if (abogadoActual.verificacion !== 'VERIFICADO') return;

  const claveLocalStorage = `bienvenida_mostrada_${perfilActual.id}`;
  if (localStorage.getItem(claveLocalStorage)) return;

  const noLeidas = await api.notificaciones.getNoLeidas();
  const notifBienvenida = noLeidas.find(n => n.tipo === 'verificacion_aprobada');
  if (!notifBienvenida) return;

  const modal = document.getElementById('modalBienvenidaVerificacion');
  modal.hidden = false;

  document.getElementById('btnCerrarBienvenidaVerificacion').addEventListener('click', async () => {
    modal.hidden = true;
    localStorage.setItem(claveLocalStorage, 'true');
    await api.notificaciones.marcarLeida(notifBienvenida.id);
  }, { once: true });
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
  SECCIONES.forEach(nombre => {
    document.getElementById(`tab${nombre}`).addEventListener('click', () => cambiarTab(nombre));
  });

  document.querySelectorAll('[data-ir-a-tab]').forEach(el => {
    el.addEventListener('click', () => cambiarTab(el.dataset.irATab));
  });

  document.querySelectorAll('.js-toggle-disponible').forEach(el => {
    el.addEventListener('change', manejarToggleDisponible);
  });

  document.getElementById('seccionSeguimiento').addEventListener('click', manejarClickSeguimiento);
  document.getElementById('inicioVerPerfilPublico').addEventListener('click', manejarClickVerPerfilPublico);
  inicializarMenuTarjeta();
  inicializarTooltipsDeshabilitados();
}

// El perfil público de un abogado no verificado no existe todavía para los
// clientes (busqueda_abogados exige verificacion='VERIFICADO') — en vez de
// dejar que se abra una pestaña con "No pudimos cargar este perfil", se
// avisa por toast y no se navega.
function manejarClickVerPerfilPublico(e) {
  if (abogadoActual.verificacion === 'VERIFICADO') return;
  e.preventDefault();
  toast.info('Su perfil público no está disponible hasta que su cuenta sea verificada por el administrador.');
}

// ─── Navegación por secciones ─────────────────────────────────────────────────
// Nunca activa una pestaña oculta (acceso limitado, ver aplicarAccesoLimitado)
// aunque se le pida por click, por acceso rápido o por ?tab= en la URL.
function cambiarTab(seccion) {
  if (document.getElementById(`tab${seccion}`)?.hidden) return;

  SECCIONES.forEach(nombre => {
    const esActiva = nombre === seccion;
    document.getElementById(`tab${nombre}`).classList.toggle('panel-tab--activo', esActiva);
    document.getElementById(`tab${nombre}`).setAttribute('aria-selected', String(esActiva));
    document.getElementById(`seccion${nombre}`).hidden = !esActiva;
  });
}

// Activa la pestaña indicada en ?tab= (ej. desde una notificación), si es válida.
function aplicarTabDesdeUrl() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (!tab) return;
  const seccion = SECCIONES.find(nombre => nombre.toLowerCase() === tab.toLowerCase());
  if (seccion) cambiarTab(seccion);
}

// ─── Cabecera: identidad, verificación y disponibilidad ──────────────────────
function renderizarCabecera() {
  document.getElementById('cabeceraAvatar').innerHTML = generarAvatarHtml(perfilActual.foto_url, perfilActual.nombre_completo);

  document.getElementById('cabeceraNombre').textContent = perfilActual.nombre_completo;

  const estadoVerificacion = ETIQUETAS_VERIFICACION[abogadoActual.verificacion] ?? ETIQUETAS_VERIFICACION.PENDIENTE;
  const badgePerfilCompletoHtml = calcularPorcentajePerfil() === 100
    ? '<span class="badge badge--verificado">Perfil completo &#10003;</span>'
    : '';
  document.getElementById('cabeceraBadges').innerHTML =
    `<span class="badge ${estadoVerificacion.clase}">${estadoVerificacion.texto}</span>${badgePerfilCompletoHtml}`;

  document.querySelectorAll('.js-toggle-disponible').forEach(el => {
    el.checked = abogadoActual.toggle_disponible;
  });
  actualizarEtiquetaDisponible(abogadoActual.toggle_disponible);
}

// El toggle vive tanto en la cabecera (visible en todas las pestañas) como en
// la pestaña Inicio; ambos controles se mantienen sincronizados por clase.
function actualizarEtiquetaDisponible(disponible) {
  const texto = disponible ? 'Disponible' : 'No disponible';
  document.querySelectorAll('.js-toggle-disponible-etiqueta').forEach(el => {
    el.textContent = texto;
  });
}

// ─── Inicio (dashboard) ───────────────────────────────────────────────────────
function renderizarSaludoInicio() {
  document.getElementById('inicioSaludo').textContent = `${obtenerSaludo()}, ${perfilActual.nombre_completo}`;
}

function obtenerSaludo() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return 'Buenos días';
  if (hora >= 12 && hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function renderizarResumenInicio(resenasTotales, casosTablon) {
  const pendientes = solicitudesActuales.filter(s => s.estado === 'PENDIENTE').length;

  const especialidadesPropias = new Set(abogadoActual.especialidades ?? []);
  const casosDeSuEspecialidad = (casosTablon ?? []).filter(c => especialidadesPropias.has(c.especialidad)).length;

  document.getElementById('inicioSolicitudesPendientes').textContent = String(pendientes);
  document.getElementById('inicioCasosTablon').textContent = String(casosDeSuEspecialidad);
  document.getElementById('inicioResenasTotales').textContent = String(resenasTotales);
}

// ─── "Requiere su atención" ───────────────────────────────────────────────────
// Misma idea y mismo diseño visual que getItemsAtencion() en panel-cliente.js
// (clases .atencion-item*, ver main.css) — pero con los 3 tipos propios del
// abogado. Sin consultas adicionales: usa solicitudesActuales (ya cargada
// por cargarSolicitudes()) y estadoVerificacionActual (ya cargada en
// inicializar() para el banner de documentos).
function getItemsAtencionAbogado(solicitudes, estadoVerificacion, notificacionesNoLeidas) {
  const items = [];
  const pendientes = solicitudes.filter(s => s.estado === 'PENDIENTE');

  // TIPO 2 se evalúa primero para poder excluir de TIPO 1 las solicitudes
  // que ya caen acá — evita mostrar la misma solicitud dos veces ("nueva" y
  // "por expirar" a la vez). expires_at = created_at + 48h (migración
  // 20260625_006_solicitudes.sql).
  const idsUrgentes = new Set();
  pendientes
    .filter(s => horasHastaExpirar(s.expires_at) < 12)
    .forEach(s => {
      idsUrgentes.add(s.id);
      items.push({
        prioridad: 2,
        clase: 'atencion-item--advertencia',
        icono: 'ti-clock',
        texto: `Tiene una solicitud de ${escaparHtml(s.cliente_nombre)} que expira en menos de 12 horas.`,
        url: '/pages/solicitudes-directas',
      });
    });

  // TIPO 1 — Nueva solicitud pendiente (azul, ti-mail).
  pendientes
    .filter(s => !idsUrgentes.has(s.id))
    .forEach(s => {
      items.push({
        prioridad: 1,
        clase: 'atencion-item--info',
        icono: 'ti-mail',
        texto: `${escaparHtml(s.cliente_nombre)} le envió una solicitud de consulta.`,
        url: '/pages/solicitudes-directas',
      });
    });

  // TIPO 3 — Verificación rechazada (rojo, ti-alert-circle).
  if (abogadoActual.verificacion === 'RECHAZADO') {
    const motivo = estadoVerificacion?.motivo_rechazo;
    items.push({
      prioridad: 3,
      clase: 'atencion-item--error',
      icono: 'ti-alert-circle',
      texto: `Su verificación fue rechazada.${motivo ? ` Motivo: ${escaparHtml(motivo)}.` : ''} Suba nuevos documentos para continuar.`,
      url: '/pages/subir-documentos',
    });
  }

  // TIPO 4 — Mensaje de chat sin leer (celeste, ti-message). Igual patrón
  // que TIPO 1/2: se aproxima con las notificaciones no leídas de tipo
  // 'mensaje_nuevo' (migración 085), cruzadas contra solicitudesActuales
  // para resolver el nombre del cliente remitente.
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
        prioridad: 4,
        clase: 'atencion-item--info',
        icono: 'ti-message',
        texto: `Tiene ${n} ${n === 1 ? 'mensaje' : 'mensajes'} sin leer de ${escaparHtml(s.cliente_nombre)}.`,
        url: urlSolicitudChat(s),
      });
    });

  return items.sort((a, b) => a.prioridad - b.prioridad);
}

function horasHastaExpirar(expiresAtIso) {
  if (!expiresAtIso) return Infinity;
  return (new Date(expiresAtIso).getTime() - Date.now()) / 3600000;
}

// A diferencia de las URLs estáticas del resto de items de esta función
// (siempre "/pages/solicitudes-directas", sin mecanismo de "resaltar" acá),
// el item de "mensaje sin leer" sí necesita apuntar a la solicitud puntual
// para poder abrir su chat -- ver ?chat=true en solicitudes-directas.js /
// solicitudes-tablon.js (migración 083).
function urlSolicitudChat(s) {
  const pagina = s.caso_tablon_id ? 'solicitudes-tablon' : 'solicitudes-directas';
  return `/pages/${pagina}?solicitud=${s.id}&chat=true`;
}

// url_destino la escribe fn_notificar_mensaje_nuevo (migración 085) -- acá
// no se navega con ella, solo se le extrae el id de solicitud, así que basta
// con no dejar que un valor malformado tire una excepción no capturada.
function idSolicitudDesdeUrl(url) {
  try {
    return new URL(url, window.location.origin).searchParams.get('solicitud');
  } catch {
    return null;
  }
}

function renderizarAtencion(items) {
  const seccion = document.getElementById('atencionPanel');
  const lista = document.getElementById('atencionLista');

  if (items.length === 0) {
    seccion.hidden = true;
    lista.innerHTML = '';
    return;
  }

  seccion.hidden = false;
  lista.innerHTML = items.map(generarItemAtencion).join('');
}

function generarItemAtencion(item) {
  return `
    <a href="${escaparAtrib(item.url)}" class="atencion-item ${item.clase}">
      <span class="atencion-item__icono" aria-hidden="true"><i class="ti ${item.icono}"></i></span>
      <span class="atencion-item__texto">${item.texto}</span>
      <span class="atencion-item__ver">Ver &rarr;</span>
    </a>
  `;
}

// ─── Acceso limitado: verificación PENDIENTE o RECHAZADA ────────────────────
// Un abogado sin verificacion='VERIFICADO' no tiene solicitudes ni reseñas
// posibles todavía (su perfil no es visible en búsquedas ni en El Tablón —
// esas páginas lo redirigen acá, ver utils.js/redirigirSiAbogadoNoAprobado),
// así que esas dos pestañas se ocultan en vez de mostrar contenido vacío.
function aplicarAccesoLimitado() {
  const aprobado = abogadoActual.verificacion === 'VERIFICADO';
  document.getElementById('tabSolicitudes').hidden = !aprobado;
  document.getElementById('tabResenas').hidden = !aprobado;

  // A diferencia de las pestañas (ocultas: no hay contenido posible sin
  // aprobar), los accesos rápidos del dashboard quedan siempre visibles
  // pero deshabilitados con tooltip mientras no está aprobado — el abogado
  // ve que la función existe y por qué todavía no puede usarla.
  aplicarEstadoDeshabilitado(document.getElementById('accesoRapidoSolicitudes'), !aprobado);
  aplicarEstadoDeshabilitado(document.getElementById('accesoRapidoTablon'), !aprobado);
}

// ─── Banners: vencimiento de suscripción, documentos y onboarding ────────────
function actualizarBanners() {
  actualizarBannerSuscripcion();
  actualizarBannerVerificacionDocumentos();
  actualizarBannerOnboarding();
}

function actualizarBannerSuscripcion() {
  const banner = document.getElementById('bannerSuscripcion');
  const vigenteHasta = abogadoActual.suscripcion_vigente_hasta;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  // El perfil sigue siendo visible durante el período de gracia de 4 días tras el
  // vencimiento (CLAUDE.md §6) — el banner solo debe aparecer cuando ya no lo es.
  const finGracia = vigenteHasta ? new Date(`${vigenteHasta}T00:00:00`) : null;
  if (finGracia) finGracia.setDate(finGracia.getDate() + 4);
  const suscripcionInactiva = !vigenteHasta || finGracia < hoy;

  if (!suscripcionInactiva) {
    banner.hidden = true;
    return;
  }

  document.getElementById('bannerSuscripcionTexto').textContent =
    'Su suscripción no está activa. Su perfil no es visible para los clientes.';
  banner.hidden = false;
}

// Cuenta con acceso limitado: PENDIENTE (nunca subió documentos, o los subió
// y sigue esperando revisión — la fila PENDIENTE se crea vacía al registrarse,
// migración 20260725_061) o RECHAZADO (debe volver a subirlos). El caso
// PENDIENTE se divide en dos textos según si ya subió documentos
// (estadoVerificacionActual.doc_carnet_url) — antes de subirlos se detalla
// explícitamente lo que el acceso limitado le impide hacer, para que el
// abogado entienda por qué su panel se ve reducido; después de subirlos ya
// no tiene sentido repetir esa lista ni mostrar el botón "Subir documentos"
// (ver aplicarEstadoRechazo en subir-documentos.js para el flujo de reintento).
const RESTRICCIONES_ACCESO_LIMITADO = [
  'Aparecer en búsquedas de clientes',
  'Recibir solicitudes de consulta',
  'Ver ni aplicar a casos en El Tablón',
  'Ver su perfil público',
];

function actualizarBannerVerificacionDocumentos() {
  const banner = document.getElementById('bannerVerificacionDocumentos');
  const textoEl = document.getElementById('bannerVerificacionDocumentosTexto');
  const listaEl = document.getElementById('bannerVerificacionDocumentosLista');
  const cierreEl = document.getElementById('bannerVerificacionDocumentosCierre');
  const botonEl = document.getElementById('bannerVerificacionDocumentosBoton');

  if (abogadoActual.verificacion === 'VERIFICADO') {
    banner.hidden = true;
    return;
  }

  listaEl.hidden = true;
  listaEl.innerHTML = '';
  cierreEl.hidden = true;

  if (abogadoActual.verificacion === 'SUSPENDIDO') {
    // Ventana angosta antes de que app.js cierre la sesión en la próxima
    // carga de index.html (ver CLAUDE.md) — no tiene sentido ofrecer
    // "Subir documentos": la fila ya no puede volver a PENDIENTE por RLS.
    textoEl.textContent = 'Su cuenta ha recibido una suspensión definitiva y no puede acceder a la plataforma. Si cree que esto es un error, contáctenos en [EMAIL_SOPORTE_PENDIENTE].';
    botonEl.hidden = true;
  } else if (abogadoActual.verificacion === 'RECHAZADO') {
    textoEl.textContent = `Su verificación fue rechazada${estadoVerificacionActual?.motivo_rechazo ? `: ${estadoVerificacionActual.motivo_rechazo}` : ''}. Vuelva a subir sus documentos para que el administrador revise su solicitud nuevamente.`;
    botonEl.hidden = false;
  } else if (estadoVerificacionActual?.doc_carnet_url) {
    // PENDIENTE con documentos ya recibidos: esperando revisión del admin.
    textoEl.textContent = 'Sus documentos fueron recibidos. El administrador revisará su solicitud en 24-48 horas hábiles. Le notificaremos cuando su cuenta sea aprobada.';
    botonEl.hidden = true;
  } else {
    // PENDIENTE sin documentos todavía: detalla las restricciones del acceso limitado.
    textoEl.textContent = 'Su cuenta está pendiente de verificación. Mientras no suba sus documentos y sean aprobados, no podrá:';
    listaEl.innerHTML = RESTRICCIONES_ACCESO_LIMITADO.map(r => `<li>${r}</li>`).join('');
    listaEl.hidden = false;
    cierreEl.textContent = 'Para activar su cuenta, suba sus documentos de verificación.';
    cierreEl.hidden = false;
    botonEl.hidden = false;
  }

  banner.hidden = false;
}

function actualizarBannerOnboarding() {
  const banner = document.getElementById('bannerOnboarding');
  banner.hidden = calcularPorcentajePerfil() === 100;
}

async function manejarToggleDisponible() {
  const controles = document.querySelectorAll('.js-toggle-disponible');
  const estadoEl = document.getElementById('toggleDisponibleEstado');

  controles.forEach(el => { el.disabled = true; });
  estadoEl.textContent = '';

  const { toggle_disponible, error } = await api.abogados.toggleDisponible();

  if (error) {
    controles.forEach(el => { el.checked = abogadoActual.toggle_disponible; });
    const mensaje = mensajeAmigable(error, 'No se pudo actualizar la disponibilidad. Intente de nuevo.');
    estadoEl.textContent = mensaje;
    toast.error(mensaje);
  } else {
    abogadoActual.toggle_disponible = toggle_disponible;
    controles.forEach(el => { el.checked = toggle_disponible; });
    actualizarEtiquetaDisponible(toggle_disponible);
    toast.info(toggle_disponible ? 'Ahora está disponible.' : 'Ahora no está disponible.');
  }

  controles.forEach(el => { el.disabled = false; });
}

// 5 campos = 20% cada uno: foto, descripción, especialidades, precio, provincia.
// Se mantiene acá (duplicado de editar-perfil-abogado.js) porque alimenta el
// badge "Perfil completo" de la cabecera y el banner de onboarding — ninguno
// de los dos vive en la página de edición del perfil.
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

// ─── Solicitudes ──────────────────────────────────────────────────────────────
// Solo alimenta el conteo de pendientes en Inicio y la caché usada por el
// toggle de seguimiento — el listado y las acciones (aceptar/rechazar) viven
// ahora en solicitudes-directas.html/solicitudes-tablon.html (ver CLAUDE.md §17/módulo 1).
async function cargarSolicitudes() {
  solicitudesActuales = await api.solicitudes.getSolicitudesAbogado();
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

  const telefonoHtml = s.cliente_telefono
    ? `Teléfono: <strong>${escaparHtml(s.cliente_telefono)}</strong>`
    : 'El cliente no registró teléfono — puede contactarlo por email.';

  const contactoHtml = s.estado === 'ACEPTADA'
    ? `
      <div class="solicitud-item__contacto">
        Contacto revelado — correo: <strong>${escaparHtml(s.cliente_email ?? 'No registrado')}</strong>.
        ${telefonoHtml}
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

  const seguimientoHtml = generarCheckboxSeguimiento(idSeguro, s.en_seguimiento_abogado);

  // Menú de tres puntos: única opción hoy es "Bloquear cliente" (CLAUDE.md
  // módulo 3 de la ronda de fixes — reemplaza al link de texto suelto).
  const menuHtml = generarMenuTarjeta([
    { texto: 'Bloquear cliente', accion: 'bloquear-cliente', id: escaparAtrib(s.cliente_id), dataNombre: escaparAtrib(s.cliente_nombre) },
  ]);

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div class="solicitud-item__cliente">
          <div class="solicitud-item__avatar">${avatarHtml}</div>
          <div>
            <p class="solicitud-item__nombre">${escaparHtml(s.cliente_nombre)}</p>
            <p class="solicitud-item__fecha">${formatearFechaHora(s.created_at)}</p>
          </div>
        </div>
        <div class="solicitud-item__header-derecha">
          <span class="badge ${claseEstado}">${etiquetaEstado}</span>
          ${menuHtml}
        </div>
      </div>
      ${detalleHtml}
      ${motivoRechazoHtml}
      ${contactoHtml}
      ${accionesHtml}
      ${seguimientoHtml}
    </article>
  `;
}

function actualizarSolicitudLocal(id, datosActualizados) {
  const entrada = solicitudesActuales.find(s => s.id === id);
  if (entrada) Object.assign(entrada, datosActualizados);
}

function manejarClickSeguimiento(e) {
  const btnSeguimiento = e.target.closest('[data-accion="toggle-seguimiento"]');
  if (btnSeguimiento) {
    manejarToggleSeguimiento(btnSeguimiento.dataset.id);
    return;
  }

  const btnBloquear = e.target.closest('[data-accion="bloquear-cliente"]');
  if (btnBloquear) manejarBloquearCliente(btnBloquear.dataset.id, btnBloquear.dataset.nombre);
}

async function manejarBloquearCliente(clienteId, nombreCliente) {
  const bloqueado = await abrirModalBloqueo(nombreCliente, clienteId);
  if (!bloqueado) return;

  // La solicitud fue cancelada automáticamente por el trigger de bloqueos —
  // se refresca desde el servidor en vez de intentar adivinar el nuevo
  // estado local (no tenemos el id de la solicitud acá, solo el del cliente).
  const misSeguimientos = await api.seguimiento.getMisSeguimientos();
  renderizarSeguimiento(misSeguimientos);
}

async function manejarToggleSeguimiento(id) {
  const { data, error } = await api.seguimiento.toggleSolicitud(id, 'abogado');

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo actualizar el seguimiento. Intente de nuevo.'));
    return;
  }

  actualizarSolicitudLocal(id, data);

  const misSeguimientos = await api.seguimiento.getMisSeguimientos();
  renderizarSeguimiento(misSeguimientos);

  toast.info(data.en_seguimiento_abogado ? MENSAJE_AGREGADO_SEGUIMIENTO : 'Quitado de seguimiento.');
}

// ─── En seguimiento ───────────────────────────────────────────────────────────
function renderizarSeguimiento({ solicitudes, casosTablon }) {
  const contenedorSolicitudes = document.getElementById('seguimientoSolicitudesLista');
  const vacioSolicitudes = document.getElementById('estadoSinSeguimientoSolicitudes');

  if (!solicitudes || solicitudes.length === 0) {
    contenedorSolicitudes.innerHTML = '';
    vacioSolicitudes.hidden = false;
  } else {
    vacioSolicitudes.hidden = true;
    contenedorSolicitudes.innerHTML = solicitudes.map(generarSolicitudCard).join('');
  }

  const contenedorCasos = document.getElementById('seguimientoCasosLista');
  const vacioCasos = document.getElementById('estadoSinSeguimientoCasos');

  if (!casosTablon || casosTablon.length === 0) {
    contenedorCasos.innerHTML = '';
    vacioCasos.hidden = false;
  } else {
    vacioCasos.hidden = true;
    contenedorCasos.innerHTML = casosTablon.map(generarCasoSeguimientoCard).join('');
  }
}

function generarCasoSeguimientoCard(c) {
  const idSeguro = escaparAtrib(c.id);
  const claseEstado = CLASE_ESTADO_CASO_TABLON[c.estado] ?? 'badge--estado-expirada';
  const etiquetaEstado = ETIQUETAS_ESTADO_CASO_TABLON[c.estado] ?? c.estado;

  return `
    <article class="solicitud-item">
      <div class="solicitud-item__header">
        <div>
          <p class="caso-tablon-card__titulo"><a href="/pages/tablon-caso?id=${idSeguro}">${escaparHtml(c.titulo)}</a></p>
          <p class="solicitud-item__fecha">${formatearFecha(c.created_at)} · ${c.especialidad ? escaparHtml(c.especialidad) : 'Sin especialidad definida'}</p>
        </div>
        <span class="badge ${claseEstado}">${etiquetaEstado}</span>
      </div>
      <div class="solicitud-item__acciones">
        <a href="/pages/tablon-caso?id=${idSeguro}" class="btn btn--secundario btn--sm">Ver caso</a>
      </div>
    </article>
  `;
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

function formatearFechaHora(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  return `${formatearFecha(fechaIso)}, ${hora}:${minutos}`;
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
