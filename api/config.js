// api/config.js
// Vercel Serverless Function (Node.js). Expone al frontend estático las
// variables de entorno públicas configuradas en Vercel → Project Settings →
// Environment Variables, para que SUPABASE_URL y SUPABASE_ANON_KEY no queden
// hardcodeadas ni commiteadas en el repositorio (ver .env.example).
//
// Por qué un endpoint y no un build step: este proyecto es HTML/CSS/JS
// vanilla sin build step (CLAUDE.md §2). Vercel solo inyecta variables de
// entorno en archivos estáticos cuando el proyecto usa un framework con
// soporte para eso en build time; sin framework no hay ese paso. Un endpoint
// serverless corre en cada request y no requiere compilar nada.
//
// SUPABASE_ANON_KEY es pública por diseño: el acceso real lo controla RLS
// en Supabase, no el secreto de esta key (CLAUDE.md §4.1 y §4.4). Por eso es
// seguro devolverla desde un endpoint público.
//
// Nunca agregar SUPABASE_SERVICE_ROLE_KEY aquí: esa key sí es secreta,
// bypassea RLS por completo y solo debe usarse dentro de Supabase Edge
// Functions.
module.exports = (req, res) => {
  res.status(200).json({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  });
};
