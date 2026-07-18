// cambiar-contrasena.js
// Lógica de la página cambiar-contrasena.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.
//
// A diferencia de nueva-contrasena.js (sesión temporal de recuperación
// creada por el enlace del correo), acá el usuario ya tiene una sesión
// normal activa. Antes de cambiar la contraseña, se reautentica llamando
// a iniciarSesion() con la contraseña actual — así una sesión abierta sin
// vigilancia no puede cambiar la contraseña sin conocerla.

import * as api from './api.js';
import { obtenerConfig } from './config.js';
import { toast, mensajeAmigable } from './utils.js';
import { inicializarHeader } from './header.js';

let emailUsuario = null;
let rolUsuario = null;

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[cambiar-contrasena] Error al cargar configuración:', err);
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    window.location.href = '/';
    return;
  }

  emailUsuario = sesion.user.email;

  const perfilActual = await api.perfiles.getPerfilActual();
  rolUsuario = perfilActual?.rol ?? null;

  if (perfilActual) {
    inicializarHeader({ rol: perfilActual.rol, nombre: perfilActual.nombre_completo, fotoPath: perfilActual.foto_url });
  }

  const rutaPanel = document.querySelector('.logo').getAttribute('href');
  document.getElementById('enlaceVolverPanel').href = rutaPanel;

  mostrarFormulario();
  document.getElementById('formCambiarContrasena').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarEnvio();
  });
}

function mostrarFormulario() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoFormulario').hidden = false;
}

async function manejarEnvio() {
  const actual = document.getElementById('passwordActual').value;
  const nueva = document.getElementById('passwordNueva').value;
  const confirmacion = document.getElementById('passwordConfirmacion').value;
  const errorEl = document.getElementById('errorCambiarContrasena');
  const btn = document.getElementById('btnGuardarContrasena');

  errorEl.textContent = '';

  if (nueva.length < 8) {
    errorEl.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.';
    return;
  }
  if (nueva !== confirmacion) {
    errorEl.textContent = 'Las contraseñas nuevas no coinciden.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const { error: errorReautenticar } = await api.auth.iniciarSesion(emailUsuario, actual);

  if (errorReautenticar) {
    errorEl.textContent = 'La contraseña actual no es correcta.';
    toast.error('La contraseña actual no es correcta.');
    btn.disabled = false;
    btn.textContent = 'Guardar nueva contraseña';
    return;
  }

  const { error } = await api.auth.cambiarContrasena(nueva);

  if (error) {
    const mensaje = mensajeAmigable(error, 'No se pudo actualizar la contraseña. Intente de nuevo.');
    errorEl.textContent = mensaje;
    toast.error(mensaje);
    btn.disabled = false;
    btn.textContent = 'Guardar nueva contraseña';
    return;
  }

  toast.exito('Contraseña actualizada.');
  document.getElementById('contenidoFormulario').hidden = true;
  document.getElementById('confirmacionCambiarContrasena').hidden = false;
}
