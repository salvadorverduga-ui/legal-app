// tablon-publicar.js
// Lógica de tablon-publicar.html: formulario de publicación de un caso en
// El Tablón. Página independiente desde el rediseño de tablon.html (formato
// foro) — antes este formulario vivía inline en tablon.html/tablon.js.
// Solo accesible para usuarios con rol='cliente'. Importa todo desde
// api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';
import { inicializarHeader } from './header.js';

let limitePublicacionesDiarias = null; // config_tablon.limite_publicaciones_diarias_cliente; null = sin límite

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[tablon-publicar] Error al cargar configuración:', err);
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

  inicializarHeader({
    rol: perfilActual.rol,
    nombre: perfilActual.nombre_completo,
    fotoPath: perfilActual.foto_url,
  });

  await cargarAvisoLimite();

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

// Aviso de límite diario: se calcula igual que antes en tablon.js, pero acá
// solo bloquea el envío del formulario (no hay botón "Publicar caso" que
// deshabilitar en esta página).
async function cargarAvisoLimite() {
  const [misCasos, config] = await Promise.all([
    api.tablon.getMisCasos(),
    api.tablon.getConfigTablon(),
  ]);

  const limite = config.find(c => c.clave === 'limite_publicaciones_diarias_cliente');
  limitePublicacionesDiarias = limite?.valor != null ? Number(limite.valor) : null;

  const aviso = document.getElementById('avisoLimiteCasos');
  const btnGuardar = document.getElementById('btnGuardarCaso');

  if (limitePublicacionesDiarias == null) {
    aviso.hidden = true;
    return;
  }

  const hoy = new Date().toDateString();
  const publicadosHoy = misCasos.filter(c => new Date(c.created_at).toDateString() === hoy).length;
  const alcanzoLimite = publicadosHoy >= limitePublicacionesDiarias;

  aviso.textContent = alcanzoLimite
    ? `Ya publicó el máximo de ${limitePublicacionesDiarias} casos hoy. Podrá publicar de nuevo mañana.`
    : `Puede publicar hasta ${limitePublicacionesDiarias} casos por día.`;
  aviso.hidden = false;
  btnGuardar.disabled = alcanzoLimite;
}

function configurarEventos() {
  document.getElementById('formPublicarCaso').addEventListener('submit', manejarSubmitPublicarCaso);
  document.getElementById('descripcionCaso').addEventListener('input', (e) => {
    document.getElementById('contadorDescripcionCaso').textContent = `${e.target.value.length} / 600`;
  });
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

  if (!datos.titulo.trim() || !datos.descripcion.trim()) {
    errorEl.textContent = 'Complete el título y la descripción.';
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

  toast.exito('Caso publicado en El Tablón.');
  window.location.href = '/pages/tablon';
}
