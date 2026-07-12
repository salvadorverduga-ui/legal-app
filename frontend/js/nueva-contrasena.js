// nueva-contrasena.js
// Lógica de la página nueva-contrasena.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.
//
// Cuando el usuario llega desde el enlace del correo de recuperación,
// Supabase JS detecta el token en la URL (detectSessionInUrl, activado por
// defecto) y establece una sesión temporal de tipo 'recovery' antes de que
// la primera llamada a getSession() se resuelva. Esa sesión es la que
// permite llamar a auth.updateUser({ password }) sin pedir la contraseña
// anterior.

import * as api from './api.js';
import { obtenerConfig } from './config.js';

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[nueva-contrasena] Error al cargar configuración:', err);
    mostrarError();
    return;
  }

  const sesion = await api.auth.getSession();
  if (!sesion) {
    mostrarError();
    return;
  }

  mostrarFormulario();
  document.getElementById('formNuevaContrasena').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarEnvio();
  });
}

function mostrarError() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('estadoError').hidden = false;
}

function mostrarFormulario() {
  document.getElementById('estadoCargando').hidden = true;
  document.getElementById('contenidoFormulario').hidden = false;
}

async function manejarEnvio() {
  const password = document.getElementById('nuevaPassword').value;
  const confirmacion = document.getElementById('confirmarPassword').value;
  const errorEl = document.getElementById('errorNuevaContrasena');
  const btnEl = document.getElementById('btnGuardarContrasena');

  errorEl.textContent = '';

  if (password.length < 8) {
    errorEl.textContent = 'La contraseña debe tener al menos 8 caracteres.';
    return;
  }
  if (password !== confirmacion) {
    errorEl.textContent = 'Las contraseñas no coinciden.';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = 'Guardando...';

  const { error } = await api.auth.actualizarContrasena(password);

  if (error) {
    errorEl.textContent = 'No se pudo actualizar la contraseña. Intente de nuevo.';
    btnEl.disabled = false;
    btnEl.textContent = 'Guardar nueva contraseña';
    return;
  }

  document.getElementById('contenidoFormulario').hidden = true;
  document.getElementById('confirmacionNuevaContrasena').hidden = false;
}
