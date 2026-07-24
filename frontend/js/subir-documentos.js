// subir-documentos.js
// Lógica de la página subir-documentos.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.
//
// Punto de entrada para que un abogado o estudio que ya confirmó su correo
// suba sus documentos de identidad profesional — con confirmación de correo
// obligatoria no hay sesión activa durante el registro (ver registro.js), así
// que la subida se hace acá, en el primer ingreso posterior.
// api.abogados.enviarDocumentosVerificacion()/api.estudios.enviarDocumentosVerificacion()
// ya existían para este propósito — esta página es el único punto del
// frontend que los invoca.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, validarArchivo, rutaPanelPropio } from './utils.js';
import { inicializarHeader } from './header.js';

let rolUsuario = null;

// Mismo límite que api.abogados.enviarDocumentosVerificacion() — acá solo se
// usa para decidir qué mostrar antes de intentar el envío (evita que el
// abogado llene el formulario para recién enterarse del límite al final).
const LIMITE_INTENTOS = 3;

// Campos por rol, en el mismo orden en que api.js los sube (secuencial, no en
// paralelo) — así el callback onProgreso siempre coincide con el campo que
// realmente está subiéndose en ese momento.
const CAMPOS_POR_ROL = {
  abogado: ['carnet', 'cedulaAnverso', 'cedulaReverso'],
  estudio: ['ruc', 'nombramiento'],
};

const ETIQUETAS_CAMPO = {
  carnet:        'Carné de abogado',
  cedulaAnverso: 'Cédula — parte frontal',
  cedulaReverso: 'Cédula — parte posterior',
  ruc:           'Documento de RUC',
  nombramiento:  'Nombramiento del representante legal',
};

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[subir-documentos] Error al cargar configuración:', err);
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  const perfilActual = await api.perfiles.getPerfilActual();
  if (!perfilActual || !['abogado', 'estudio'].includes(perfilActual.rol)) {
    window.location.href = '/';
    return;
  }
  rolUsuario = perfilActual.rol;

  inicializarHeader({ rol: perfilActual.rol, nombre: perfilActual.nombre_completo, fotoPath: perfilActual.foto_url });

  document.getElementById(rolUsuario === 'estudio' ? 'camposEstudio' : 'camposAbogado').hidden = false;

  // El flujo de rechazo/reintento (aviso de motivo, contador de intentos,
  // límite de 3) es específico de abogado individual — api.abogados es la
  // única de las dos funciones de envío que lleva intentos_verificacion
  // (ver PARTE 3, CLAUDE.md). Un estudio siempre ve el formulario normal.
  if (rolUsuario === 'abogado' && !(await aplicarEstadoRechazo())) {
    document.getElementById('estadoCargando').hidden = true;
    return;
  }

  mostrarFormulario();
  document.getElementById('formSubirDocumentos').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarEnvio();
  });
}

function mostrarFormulario() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoFormulario').hidden = false;
}

// Devuelve false si se alcanzó el límite de intentos (el formulario no debe
// mostrarse) — true en cualquier otro caso, incluyendo RECHAZADO con
// intentos disponibles (ahí sí se muestra el formulario, con el aviso).
async function aplicarEstadoRechazo() {
  const estadoVerificacion = await api.abogados.getEstadoVerificacion();
  if (estadoVerificacion?.estado !== 'RECHAZADO') return true;

  const intentos = estadoVerificacion.intentos_verificacion ?? 0;

  if (intentos >= LIMITE_INTENTOS) {
    document.getElementById('estadoLimiteIntentos').hidden = false;
    return false;
  }

  const aviso = document.getElementById('avisoRechazoVerificacion');
  const motivo = estadoVerificacion.motivo_rechazo
    ? ` Motivo: ${estadoVerificacion.motivo_rechazo}.`
    : '';
  document.getElementById('textoRechazoVerificacion').textContent =
    `Su verificación anterior fue rechazada.${motivo} Por favor corrija y vuelva a subir sus documentos.`;
  document.getElementById('textoIntentosVerificacion').textContent =
    `Intento ${intentos + 1} de ${LIMITE_INTENTOS}`;
  aviso.hidden = false;

  return true;
}

// ─── Barra de progreso por archivo ───────────────────────────────────────────
// El bucket de Storage no expone progreso real por bytes en la versión de
// supabase-js vendorizada acá (sin build step, ver CLAUDE.md §2) — "subiendo"
// anima la barra hacia ~90% con una transición larga (efecto de progreso
// simulado, mismo patrón que usan otras apps para subidas sin progreso real)
// y "completado" la lleva a 100% de inmediato.
function actualizarProgresoArchivo(campo, estado) {
  const idSufijo = campo[0].toUpperCase() + campo.slice(1);
  const contenedor = document.getElementById(`progreso${idSufijo}`);
  const relleno = document.getElementById(`progreso${idSufijo}Relleno`);
  const texto = document.getElementById(`progreso${idSufijo}Estado`);
  if (!contenedor) return;

  contenedor.hidden = false;
  contenedor.classList.remove('subida-progreso--completo', 'subida-progreso--error');

  if (estado === 'subiendo') {
    relleno.style.width = '90%';
    texto.textContent = 'Subiendo...';
  } else if (estado === 'completado') {
    relleno.style.width = '100%';
    texto.textContent = 'Subido ✓';
    contenedor.classList.add('subida-progreso--completo');
  }
}

function marcarErrorProgreso(campos) {
  campos.forEach(campo => {
    const idSufijo = campo[0].toUpperCase() + campo.slice(1);
    const contenedor = document.getElementById(`progreso${idSufijo}`);
    const texto = document.getElementById(`progreso${idSufijo}Estado`);
    if (!contenedor || contenedor.classList.contains('subida-progreso--completo')) return;
    contenedor.hidden = false;
    contenedor.classList.add('subida-progreso--error');
    texto.textContent = 'No se pudo subir';
  });
}

async function manejarEnvio() {
  const errorEl = document.getElementById('errorSubirDocumentos');
  const btn = document.getElementById('btnEnviarDocumentos');
  errorEl.textContent = '';

  const campos = CAMPOS_POR_ROL[rolUsuario];
  const archivos = {};
  campos.forEach(campo => {
    archivos[campo] = document.querySelector(`[data-campo="${campo}"]`).files[0];
  });

  for (const campo of campos) {
    const errorArchivo = validarArchivo(archivos[campo]);
    if (errorArchivo) {
      errorEl.textContent = `${ETIQUETAS_CAMPO[campo]}: ${errorArchivo}`;
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  const onProgreso = (campo, estado) => actualizarProgresoArchivo(campo, estado);

  const { error } = rolUsuario === 'estudio'
    ? await api.estudios.enviarDocumentosVerificacion(archivos, { onProgreso })
    : await api.abogados.enviarDocumentosVerificacion(archivos, { onProgreso });

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudieron enviar los documentos. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    marcarErrorProgreso(campos);
    btn.disabled = false;
    btn.textContent = 'Enviar documentos';
    return;
  }

  mostrarConfirmacion();
}

// ─── Confirmación y redirección automática ──────────────────────────────────
function mostrarConfirmacion() {
  document.getElementById('contenidoFormulario').hidden = true;
  document.getElementById('confirmacionSubirDocumentos').hidden = false;
  toast.exito('Documentos enviados.');
  iniciarRedireccionAutomatica();
}

function iniciarRedireccionAutomatica() {
  const el = document.getElementById('contadorRedireccionDocumentos');
  let segundos = 5;
  el.textContent = `Redirigiendo a su panel en ${segundos}...`;
  const intervalo = setInterval(() => {
    segundos--;
    if (segundos <= 0) {
      clearInterval(intervalo);
      window.location.href = rutaPanelPropio(rolUsuario);
      return;
    }
    el.textContent = `Redirigiendo a su panel en ${segundos}...`;
  }, 1000);
}
