// registro.js
// Lógica de frontend/pages/registro.html — dos flujos de registro
// (cliente / abogado o estudio) según el rol elegido en index.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast } from './utils.js';

const TAMANO_MAXIMO_ARCHIVO = 5 * 1024 * 1024; // 5 MB
const TIPOS_ARCHIVO_PERMITIDOS = ['image/jpeg', 'image/png', 'application/pdf'];

let tipoProfesionalActivo = null; // 'individual' | 'estudio' | 'red'
let codigoReferido = null; // ?ref= en la URL, capturado en inicializar() y asociado al registro de abogado

// ─── Entry point ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[registro] Error al cargar configuración:', err);
  }

  configurarEventos();

  codigoReferido = new URLSearchParams(window.location.search).get('ref');
  if (codigoReferido) verificarCodigoReferido(codigoReferido);

  const rol = new URLSearchParams(window.location.search).get('rol');
  if (rol === 'cliente') {
    mostrarFlujo('cliente');
  } else if (rol === 'abogado') {
    mostrarFlujo('abogado');
  } else {
    document.getElementById('selectorCuenta').hidden = false;
  }
}

// Programa de referidos: solo aplica al registro de abogado (§20 CLAUDE.md).
// Si el código no es válido, se sigue asociando igual al registro (queda
// guardado en raw_user_meta_data) pero fn_crear_fila_abogado simplemente no
// encuentra referidor y no otorga recompensa — no hace falta bloquear el
// formulario ni limpiar codigoReferido acá.
async function verificarCodigoReferido(codigo) {
  const { valido, referidorNombre } = await api.referidos.validarCodigo(codigo);
  if (!valido) return;

  const aviso = document.getElementById('avisoReferido');
  aviso.textContent = `Fue referido por ${referidorNombre}. Si completa su registro como abogado, ambos recibirán un mes gratis.`;
  aviso.hidden = false;
}

// ─── Mostrar el flujo correspondiente ────────────────────────────────────────
function mostrarFlujo(rol) {
  document.getElementById('selectorCuenta').hidden = true;
  document.getElementById('flujoCliente').hidden = rol !== 'cliente';
  document.getElementById('flujoProfesional').hidden = rol !== 'abogado';
}

// ─── Configuración de eventos ─────────────────────────────────────────────────
function configurarEventos() {
  document.getElementById('btnSelectorCliente').addEventListener('click', () => mostrarFlujo('cliente'));
  document.getElementById('btnSelectorAbogado').addEventListener('click', () => mostrarFlujo('abogado'));

  document.getElementById('btnTipoIndividual').addEventListener('click', () => mostrarPasoTipo('individual'));
  document.getElementById('btnTipoEstudio').addEventListener('click', () => mostrarPasoTipo('estudio'));
  document.getElementById('btnTipoRed').addEventListener('click', () => mostrarPasoTipo('red'));

  document.getElementById('btnVolverPasoAbogado').addEventListener('click', volverAPasoTipo);
  document.getElementById('btnVolverPasoEstudio').addEventListener('click', volverAPasoTipo);

  document.getElementById('formCliente').addEventListener('submit', manejarRegistroCliente);
  document.getElementById('formAbogado').addEventListener('submit', manejarRegistroAbogado);
  document.getElementById('formEstudio').addEventListener('submit', manejarRegistroEstudio);
}

function mostrarPasoTipo(tipo) {
  tipoProfesionalActivo = tipo;
  document.getElementById('pasoTipo').hidden = true;

  if (tipo === 'estudio') {
    document.getElementById('pasoEstudio').hidden = false;
    document.getElementById('pasoAbogado').hidden = true;
    return;
  }

  document.getElementById('pasoAbogado').hidden = false;
  document.getElementById('pasoEstudio').hidden = true;
  document.getElementById('tituloPasoAbogado').textContent =
    tipo === 'red' ? 'Datos del abogado — red de colaboradores' : 'Datos del abogado';
  document.getElementById('avisoRed').hidden = tipo !== 'red';
}

function volverAPasoTipo() {
  document.getElementById('pasoAbogado').hidden = true;
  document.getElementById('pasoEstudio').hidden = true;
  document.getElementById('pasoTipo').hidden = false;
}

// ─── Validaciones compartidas ────────────────────────────────────────────────
function validarCedula(cedula) {
  return /^\d{10}$/.test(cedula);
}

function validarRuc(ruc) {
  return /^\d{13}$/.test(ruc);
}

function validarArchivo(archivo) {
  if (!archivo) return 'Seleccione un archivo.';
  if (!TIPOS_ARCHIVO_PERMITIDOS.includes(archivo.type)) return 'El archivo debe ser JPG, PNG o PDF.';
  if (archivo.size > TAMANO_MAXIMO_ARCHIVO) return 'El archivo no debe superar los 5 MB.';
  return null;
}

function obtenerEspecialidadesSeleccionadas(contenedorId) {
  return Array.from(
    document.querySelectorAll(`#${contenedorId} input[name="especialidades"]:checked`)
  ).map(input => input.value);
}

// ─── Handler: cliente ─────────────────────────────────────────────────────────
async function manejarRegistroCliente(evento) {
  evento.preventDefault();

  const nombre_completo = document.getElementById('clienteNombre').value.trim();
  const email = document.getElementById('clienteEmail').value.trim();
  const password = document.getElementById('clientePassword').value;
  const errorEl = document.getElementById('errorCliente');
  const btnEl = document.getElementById('btnRegistrarCliente');

  if (!nombre_completo || !email || !password) {
    errorEl.textContent = 'Complete todos los campos.';
    return;
  }
  if (password.length < 8) {
    errorEl.textContent = 'La contraseña debe tener al menos 8 caracteres.';
    return;
  }

  errorEl.textContent = '';
  btnEl.disabled = true;
  btnEl.textContent = 'Creando cuenta...';

  try {
    const { error } = await api.auth.registrarCliente({ email, password, nombre_completo });

    if (error) {
      const mensaje = traducirErrorAuth(error);
      errorEl.textContent = mensaje;
      toast.error(mensaje);
      return;
    }

    mostrarConfirmacion('formCliente', 'confirmacionCliente',
      'Le enviamos un enlace de confirmación. Al confirmarlo podrá ingresar y buscar abogados.');

  } catch (err) {
    console.error('[registro] ERROR COMPLETO (debug temporal, cliente):', err);
    console.error('[registro] Error inesperado al registrar cliente:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
    toast.error('No se pudo crear la cuenta. Intente de nuevo.');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Crear cuenta';
  }
}

// ─── Handler: abogado individual / red de colaboradores ──────────────────────
async function manejarRegistroAbogado(evento) {
  evento.preventDefault();

  const nombre_completo = document.getElementById('abogadoNombre').value.trim();
  const cedula = document.getElementById('abogadoCedula').value.trim();
  const numero_carnet = document.getElementById('abogadoCarnet').value.trim();
  const email = document.getElementById('abogadoEmail').value.trim();
  const password = document.getElementById('abogadoPassword').value;
  const provincia = document.getElementById('abogadoProvincia').value;
  const especialidades = obtenerEspecialidadesSeleccionadas('especialidadesAbogado');
  const docCarnet = document.getElementById('abogadoDocCarnet').files[0];
  const docCedulaAnverso = document.getElementById('abogadoDocCedulaAnverso').files[0];
  const docCedulaReverso = document.getElementById('abogadoDocCedulaReverso').files[0];
  const errorEl = document.getElementById('errorAbogado');
  const btnEl = document.getElementById('btnRegistrarAbogado');

  if (!nombre_completo || !cedula || !numero_carnet || !email || !password || !provincia) {
    errorEl.textContent = 'Complete todos los campos.';
    return;
  }
  if (!validarCedula(cedula)) {
    errorEl.textContent = 'La cédula debe tener exactamente 10 dígitos numéricos.';
    return;
  }
  if (password.length < 8) {
    errorEl.textContent = 'La contraseña debe tener al menos 8 caracteres.';
    return;
  }
  if (especialidades.length === 0) {
    errorEl.textContent = 'Seleccione al menos una especialidad.';
    return;
  }
  const errorCarnet = validarArchivo(docCarnet);
  if (errorCarnet) {
    errorEl.textContent = `Carné de abogado: ${errorCarnet}`;
    return;
  }
  const errorCedulaAnverso = validarArchivo(docCedulaAnverso);
  if (errorCedulaAnverso) {
    errorEl.textContent = `Cédula — parte frontal: ${errorCedulaAnverso}`;
    return;
  }
  const errorCedulaReverso = validarArchivo(docCedulaReverso);
  if (errorCedulaReverso) {
    errorEl.textContent = `Cédula — parte posterior: ${errorCedulaReverso}`;
    return;
  }

  errorEl.textContent = '';
  btnEl.disabled = true;
  btnEl.textContent = 'Creando cuenta...';

  try {
    const { data, error } = await api.auth.registrarAbogado({
      email, password, nombre_completo, cedula, numero_carnet, especialidades, provincia,
      ref: codigoReferido,
    });

    if (error) {
      const mensaje = traducirErrorAuth(error);
      errorEl.textContent = mensaje;
      toast.error(mensaje);
      return;
    }

    let notaDocumentos = 'Podrá subir sus documentos de verificación al confirmar su correo e ingresar por primera vez.';
    if (data?.session) {
      const { error: errorDocs } = await api.abogados.enviarDocumentosVerificacion({
        carnet: docCarnet,
        cedulaAnverso: docCedulaAnverso,
        cedulaReverso: docCedulaReverso,
      });
      if (!errorDocs) notaDocumentos = 'Sus documentos de verificación fueron enviados.';
    }

    const notaRed = tipoProfesionalActivo === 'red'
      ? ' Podrá vincularse a una red de colaboradores desde su panel una vez verificado.'
      : '';

    mostrarConfirmacion('formAbogado', 'confirmacionAbogado',
      `Le enviamos un enlace de confirmación. ${notaDocumentos} Su perfil será visible tras verificación en 24–48 horas hábiles.${notaRed}`,
      { redireccionAutomatica: true });

  } catch (err) {
    console.error('[registro] ERROR COMPLETO (debug temporal, abogado):', err);
    console.error('[registro] Error inesperado al registrar abogado:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
    toast.error('No se pudo crear la cuenta. Intente de nuevo.');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Crear cuenta';
  }
}

// ─── Handler: estudio jurídico ────────────────────────────────────────────────
async function manejarRegistroEstudio(evento) {
  evento.preventDefault();

  const nombre_estudio = document.getElementById('estudioNombre').value.trim();
  const ruc = document.getElementById('estudioRuc').value.trim();
  const nombre_representante = document.getElementById('estudioRepresentante').value.trim();
  const email = document.getElementById('estudioEmail').value.trim();
  const password = document.getElementById('estudioPassword').value;
  const provincia = document.getElementById('estudioProvincia').value;
  const especialidades = obtenerEspecialidadesSeleccionadas('especialidadesEstudio');
  const docRuc = document.getElementById('estudioDocRuc').files[0];
  const docNombramiento = document.getElementById('estudioDocNombramiento').files[0];
  const errorEl = document.getElementById('errorEstudio');
  const btnEl = document.getElementById('btnRegistrarEstudio');

  if (!nombre_estudio || !ruc || !nombre_representante || !email || !password || !provincia) {
    errorEl.textContent = 'Complete todos los campos.';
    return;
  }
  if (!validarRuc(ruc)) {
    errorEl.textContent = 'El RUC debe tener exactamente 13 dígitos numéricos.';
    return;
  }
  if (password.length < 8) {
    errorEl.textContent = 'La contraseña debe tener al menos 8 caracteres.';
    return;
  }
  if (especialidades.length === 0) {
    errorEl.textContent = 'Seleccione al menos una especialidad.';
    return;
  }
  const errorRuc = validarArchivo(docRuc);
  if (errorRuc) {
    errorEl.textContent = `Documento de RUC: ${errorRuc}`;
    return;
  }
  const errorNombramiento = validarArchivo(docNombramiento);
  if (errorNombramiento) {
    errorEl.textContent = `Nombramiento del representante: ${errorNombramiento}`;
    return;
  }

  errorEl.textContent = '';
  btnEl.disabled = true;
  btnEl.textContent = 'Creando cuenta...';

  try {
    const { data, error } = await api.auth.registrarEstudio({
      email, password, nombre_representante, nombre_estudio, ruc, especialidades, provincia,
    });

    if (error) {
      const mensaje = traducirErrorAuth(error);
      errorEl.textContent = mensaje;
      toast.error(mensaje);
      return;
    }

    let notaDocumentos = 'Podrá subir sus documentos de verificación al confirmar su correo e ingresar por primera vez.';
    if (data?.session) {
      const { error: errorDocs } = await api.estudios.enviarDocumentosVerificacion({ ruc: docRuc, nombramiento: docNombramiento });
      if (!errorDocs) notaDocumentos = 'Sus documentos de verificación fueron enviados.';
    }

    mostrarConfirmacion('formEstudio', 'confirmacionEstudio',
      `Le enviamos un enlace de confirmación. ${notaDocumentos} Su perfil será visible tras verificación en 24–48 horas hábiles.`);

  } catch (err) {
    console.error('[registro] ERROR COMPLETO (debug temporal, estudio):', err);
    console.error('[registro] Error inesperado al registrar estudio:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
    toast.error('No se pudo crear la cuenta. Intente de nuevo.');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Crear cuenta';
  }
}

// ─── Confirmación post-registro ───────────────────────────────────────────────
// `redireccionAutomatica` solo se usa en el flujo de abogado (§ registro abogado):
// muestra un contador visible de 5 segundos y redirige a la landing. Cliente y
// estudio conservan el comportamiento anterior (mensaje sin redirección).
function mostrarConfirmacion(idFormulario, idConfirmacion, mensaje, { redireccionAutomatica = false } = {}) {
  document.getElementById(idFormulario).hidden = true;
  const contenedor = document.getElementById(idConfirmacion);
  contenedor.hidden = false;
  contenedor.innerHTML = `
    <p class="mensaje-confirmacion__titulo">Revise su correo</p>
    <p>${mensaje}</p>
    ${redireccionAutomatica ? '<p class="mensaje-confirmacion__redireccion" id="contadorRedireccion"></p>' : ''}
  `;

  if (redireccionAutomatica) {
    toast.exito('Registro exitoso. Revise su correo para confirmar su cuenta. Una vez confirmada, podrá completar su perfil.');
    iniciarRedireccionAutomatica('contadorRedireccion');
  } else {
    toast.exito('Cuenta creada. Revise su correo para confirmar.');
  }
}

function iniciarRedireccionAutomatica(idContador) {
  const el = document.getElementById(idContador);
  let segundos = 5;
  el.textContent = `Redirigiendo en ${segundos}...`;
  const intervalo = setInterval(() => {
    segundos--;
    if (segundos <= 0) {
      clearInterval(intervalo);
      window.location.href = '/';
      return;
    }
    el.textContent = `Redirigiendo en ${segundos}...`;
  }, 1000);
}

// ─── Traducción de errores de Supabase Auth ───────────────────────────────────
function traducirErrorAuth(error) {
  const MENSAJES = {
    'User already registered': 'Ya existe una cuenta con ese correo.',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 8 caracteres.',
    'Unable to validate email address: invalid format': 'Ingrese un correo electrónico válido.',
  };
  return MENSAJES[error.message] ?? 'Ocurrió un error inesperado. Intente de nuevo.';
}
