// app.js
// Inicialización de Supabase, detección de sesión y routing por rol.
// No ejecuta queries directamente: toda consulta va a través de api.js.

import * as api from './api.js';
import { obtenerConfig } from './config.js';

// ─── Configuración de Supabase ────────────────────────────────────────────────
// SUPABASE_URL y SUPABASE_ANON_KEY se obtienen de /api/config (ver config.js)
// en lugar de estar hardcodeadas. El ANON_KEY es seguro en el frontend: el
// acceso real lo controla RLS en Supabase, no el secreto de esta key.
let clienteSupabase = null;

// window.supabase (UMD) queda disponible por el script cargado antes de este módulo en HTML
async function inicializarClienteSupabase() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();
  clienteSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Compartir el cliente inicializado con api.js
  api.inicializarCliente(clienteSupabase);

  // Detecta cambios de sesión en otras pestañas del mismo navegador.
  clienteSupabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT' && window.location.pathname !== '/') {
      window.location.href = '/';
    }
  });
}


// ─── Rutas por rol ────────────────────────────────────────────────────────────
const RUTAS = {
  cliente: '/pages/busqueda',
  abogado: '/pages/panel-abogado',
  estudio: '/pages/panel-estudio',
  admin:   '/pages/panel-admin',
};

function redirigirSegunRol(rol) {
  const destino = RUTAS[rol];
  if (destino) window.location.href = destino;
}


// ─── Inicialización ───────────────────────────────────────────────────────────
// Tiempo máximo de espera para la verificación de sesión. Si getSession() se
// cuelga (p.ej. lock de sesión corrupto en el navegador), no dejamos el
// spinner girando para siempre: se asume "sin sesión" y se muestra el login.
const TIMEOUT_VERIFICACION_SESION_MS = 5000;

function esperarConTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function inicializar() {
  mostrarCargando(true);

  try {
    await inicializarClienteSupabase();

    const sesion = await esperarConTimeout(api.auth.getSession(), TIMEOUT_VERIFICACION_SESION_MS);

    if (sesion) {
      const perfil = await esperarConTimeout(api.perfiles.getPerfilActual(), TIMEOUT_VERIFICACION_SESION_MS);
      if (perfil?.rol) {
        redirigirSegunRol(perfil.rol);
        return; // detener ejecución mientras se redirige
      }
    }

    mostrarCargando(false);
    mostrarContenido(true);
    configurarUI();

  } catch (err) {
    console.error('[app] Error al inicializar:', err);
    mostrarCargando(false);
    mostrarContenido(true);
    configurarUI();
  }
}


// ─── Control de visibilidad de secciones ─────────────────────────────────────
function mostrarCargando(visible) {
  document.getElementById('cargando').hidden = !visible;
}

function mostrarContenido(visible) {
  document.getElementById('contenidoPrincipal').hidden = !visible;
}


// ─── Configuración de eventos UI ─────────────────────────────────────────────
let rolActivo = null;

function configurarUI() {
  document.getElementById('btnCliente').addEventListener('click', () => seleccionarRol('cliente'));
  document.getElementById('btnAbogado').addEventListener('click', () => seleccionarRol('abogado'));
  document.getElementById('btnVolver').addEventListener('click', volverASeleccion);
  document.getElementById('tabIngresar').addEventListener('click', () => cambiarTab('ingresar'));
  document.getElementById('tabRegistro').addEventListener('click', () => cambiarTab('registro'));
  document.getElementById('formIngresar').addEventListener('submit', manejarIngresar);
}

function seleccionarRol(rol) {
  rolActivo = rol;

  document.querySelectorAll('.tarjeta-rol').forEach(btn => {
    const activa = btn.dataset.rol === rol;
    btn.setAttribute('aria-pressed', String(activa));
    btn.classList.toggle('tarjeta-rol--activa', activa);
  });

  const etiquetas = {
    cliente: 'Accediendo como cliente',
    abogado: 'Accediendo como abogado / estudio',
  };
  document.getElementById('rolSeleccionado').textContent = etiquetas[rol] ?? '';
  document.getElementById('enlaceRegistro').href = `/pages/registro?rol=${rol}`;

  const seccionAuth = document.getElementById('seccionAuth');
  seccionAuth.hidden = false;
  seccionAuth.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function volverASeleccion() {
  rolActivo = null;

  document.getElementById('seccionAuth').hidden = true;

  document.querySelectorAll('.tarjeta-rol').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('tarjeta-rol--activa');
  });

  limpiarErrores();
}

function cambiarTab(tab) {
  const esIngresar = tab === 'ingresar';

  document.getElementById('panelIngresar').hidden = !esIngresar;
  document.getElementById('panelRegistro').hidden = esIngresar;

  document.getElementById('tabIngresar').classList.toggle('auth-tab--activo', esIngresar);
  document.getElementById('tabRegistro').classList.toggle('auth-tab--activo', !esIngresar);
  document.getElementById('tabIngresar').setAttribute('aria-selected', String(esIngresar));
  document.getElementById('tabRegistro').setAttribute('aria-selected', String(!esIngresar));

  limpiarErrores();
}

function limpiarErrores() {
  document.getElementById('errorIngresar').textContent = '';
}


// ─── Handler: ingresar ────────────────────────────────────────────────────────
async function manejarIngresar(evento) {
  evento.preventDefault();

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl  = document.getElementById('errorIngresar');
  const btnEl    = document.getElementById('btnIngresar');

  if (!email || !password) {
    errorEl.textContent = 'Complete todos los campos.';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = 'Ingresando...';
  errorEl.textContent = '';

  try {
    const { perfil, error } = await api.auth.iniciarSesion(email, password);

    if (error) {
      errorEl.textContent = traducirErrorAuth(error);
      return;
    }

    redirigirSegunRol(perfil.rol);

  } catch (err) {
    console.error('[app] Error inesperado al ingresar:', err);
    errorEl.textContent = 'Ocurrió un error. Intente de nuevo.';
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Ingresar';
  }
}


// ─── Traducción de errores de Supabase Auth ───────────────────────────────────
// Supabase devuelve mensajes en inglés; los traducimos para el usuario.
function traducirErrorAuth(error) {
  const MENSAJES = {
    'Invalid login credentials':                   'El correo o la contraseña son incorrectos.',
    'Email not confirmed':                         'Debe confirmar su correo antes de ingresar.',
    'User already registered':                     'Ya existe una cuenta con ese correo.',
    'Password should be at least 6 characters':    'La contraseña debe tener al menos 8 caracteres.',
    'Unable to validate email address: invalid format': 'Ingrese un correo electrónico válido.',
  };
  return MENSAJES[error.message] ?? 'Ocurrió un error inesperado. Intente de nuevo.';
}


// ─── Entry point ─────────────────────────────────────────────────────────────
// Los módulos (type="module") se ejecutan con defer automático,
// pero DOMContentLoaded garantiza que el DOM está listo en cualquier caso.
document.addEventListener('DOMContentLoaded', inicializar);
