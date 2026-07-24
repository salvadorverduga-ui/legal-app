// subir-documentos.js
// Lógica de la página subir-documentos.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.
//
// Punto de entrada para que un abogado o estudio que ya confirmó su correo
// suba sus documentos de identidad profesional — el registro solo los sube
// de inmediato si signUp() devuelve sesión activa, algo que nunca ocurre con
// confirmación de correo obligatoria (ver CLAUDE.md, fix de registro.js).
// api.abogados.enviarDocumentosVerificacion()/api.estudios.enviarDocumentosVerificacion()
// ya existían para este propósito — esta página es el único punto del
// frontend que los invoca fuera del registro.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable, validarArchivo, rutaPanelPropio } from './utils.js';
import { inicializarHeader } from './header.js';

let rolUsuario = null;

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

async function manejarEnvio() {
  const errorEl = document.getElementById('errorSubirDocumentos');
  const btn = document.getElementById('btnEnviarDocumentos');
  errorEl.textContent = '';

  const archivos = rolUsuario === 'estudio'
    ? {
        ruc: document.getElementById('docRuc').files[0],
        nombramiento: document.getElementById('docNombramiento').files[0],
      }
    : {
        carnet: document.getElementById('docCarnet').files[0],
        cedulaAnverso: document.getElementById('docCedulaAnverso').files[0],
        cedulaReverso: document.getElementById('docCedulaReverso').files[0],
      };

  const etiquetasArchivo = rolUsuario === 'estudio'
    ? { ruc: 'Documento de RUC', nombramiento: 'Nombramiento del representante legal' }
    : { carnet: 'Carné de abogado', cedulaAnverso: 'Cédula — parte frontal', cedulaReverso: 'Cédula — parte posterior' };

  for (const campo of Object.keys(archivos)) {
    const errorArchivo = validarArchivo(archivos[campo]);
    if (errorArchivo) {
      errorEl.textContent = `${etiquetasArchivo[campo]}: ${errorArchivo}`;
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  const { error } = rolUsuario === 'estudio'
    ? await api.estudios.enviarDocumentosVerificacion(archivos)
    : await api.abogados.enviarDocumentosVerificacion(archivos);

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudieron enviar los documentos. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    btn.disabled = false;
    btn.textContent = 'Enviar documentos';
    return;
  }

  toast.exito('Documentos enviados. Le avisaremos cuando su verificación sea revisada.');
  setTimeout(() => {
    window.location.href = rutaPanelPropio(rolUsuario);
  }, 1200);
}
