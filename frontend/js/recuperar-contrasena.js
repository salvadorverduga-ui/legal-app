// recuperar-contrasena.js
// Lógica de la página recuperar-contrasena.html.
// Importa todo desde api.js — nunca consulta Supabase directamente.

import * as api from './api.js';
import { obtenerConfig } from './config.js';

document.addEventListener('DOMContentLoaded', inicializar);

async function inicializar() {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
    api.inicializarCliente(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } catch (err) {
    console.error('[recuperar-contrasena] Error al cargar configuración:', err);
    document.getElementById('errorRecuperar').textContent = 'Ocurrió un error. Intente de nuevo más tarde.';
    return;
  }

  document.getElementById('formRecuperar').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarEnvio();
  });
}

async function manejarEnvio() {
  const email = document.getElementById('recuperarEmail').value.trim();
  const errorEl = document.getElementById('errorRecuperar');
  const btnEl = document.getElementById('btnRecuperar');

  errorEl.textContent = '';

  if (!email) {
    errorEl.textContent = 'Ingrese su correo electrónico.';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = 'Enviando...';

  try {
    const { error } = await api.auth.recuperarContrasena(email);

    // No se distingue "correo no existe" de "enviado correctamente": evita
    // que un tercero pueda usar este formulario para averiguar qué correos
    // tienen cuenta registrada.
    if (error) {
      console.error('[recuperar-contrasena] Error al solicitar el enlace:', error.message);
    }

    document.getElementById('formRecuperar').hidden = true;
    document.getElementById('confirmacionRecuperar').hidden = false;
  } catch (err) {
    console.error('[recuperar-contrasena] Error inesperado al solicitar el enlace:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Enviar enlace de recuperación';
  }
}
