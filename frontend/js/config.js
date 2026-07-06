// config.js
// Carga SUPABASE_URL y SUPABASE_ANON_KEY desde /api/config en lugar de
// hardcodearlas en el código fuente.
//
// Por qué un endpoint y no variables de entorno "de build":
// Este proyecto es HTML/CSS/JS vanilla sin build step (CLAUDE.md §2), así
// que no existe un paso de compilación donde Vercel pueda reemplazar
// variables de entorno dentro de este archivo antes de servirlo. La
// alternativa es api/config.js: una Vercel Serverless Function que lee
// process.env en cada request y devuelve los valores como JSON. Las
// credenciales reales se configuran una sola vez en Vercel → Project
// Settings → Environment Variables y nunca se commitean al repositorio
// (ver .env.example).
//
// Nota de seguridad: SUPABASE_ANON_KEY es pública por diseño — el acceso
// real a los datos lo controla RLS en Supabase (CLAUDE.md §4.1 y §4.4), no
// el secreto de esta key. Este mecanismo evita tenerla escrita en el
// código versionado (para poder rotarla o cambiar de proyecto Supabase sin
// tocar el repo), pero no la trata como un secreto que haya que ocultar del
// navegador.
//
// Uso:
//   import { obtenerConfig } from './config.js';
//   const { SUPABASE_URL, SUPABASE_ANON_KEY } = await obtenerConfig();

let _configCache = null;

export async function obtenerConfig() {
  if (_configCache) return _configCache;

  const respuesta = await fetch('/api/config');
  if (!respuesta.ok) {
    throw new Error('No se pudo cargar la configuración de Supabase desde /api/config.');
  }

  const config = await respuesta.json();
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    throw new Error('Configuración de Supabase incompleta. Verifique las variables de entorno en Vercel.');
  }

  _configCache = config;
  return _configCache;
}
