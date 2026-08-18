// api/contacto.js
// Vercel Serverless Function (Node.js). Recibe el formulario de
// frontend/pages/contacto.html y reenvía el mensaje por email al equipo de
// soporte usando el mismo SMTP de Zoho que la Edge Function de
// notificaciones (CLAUDE.md §13) — pero configurado como variables de
// entorno de Vercel (Project Settings → Environment Variables), no como
// Supabase secrets, porque esta función corre en Vercel, no en Supabase.
//
// Variables de entorno esperadas (Vercel):
//   ZOHO_SMTP_USER      — obligatoria. Mismo valor que en Supabase secrets.
//   ZOHO_SMTP_PASSWORD  — obligatoria. Contraseña de aplicación de Zoho,
//                          nunca la contraseña principal de la cuenta.
//   EMAIL_FROM          — remitente mostrado en el correo. Si no se
//                          configura, se usa ZOHO_SMTP_USER.
//   SUPPORT_EMAIL       — bandeja de soporte que recibe el mensaje. Si no
//                          se configura, se usa ZOHO_SMTP_USER.
//   SUPABASE_URL        — ya configurada para api/config.js (CLAUDE.md §10).
//   SUPABASE_ANON_KEY    — idem. Usada acá para el rate limiting (ver abajo).
//
// El correo del remitente del formulario se usa como Reply-To, para que el
// equipo de soporte pueda responder directamente al usuario.

const nodemailer = require('nodemailer');

const ZOHO_SMTP_USER = process.env.ZOHO_SMTP_USER;
const ZOHO_SMTP_PASSWORD = process.env.ZOHO_SMTP_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || ZOHO_SMTP_USER;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || ZOHO_SMTP_USER;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ASUNTOS_PERMITIDOS = new Set([
  'Problema técnico',
  'Consulta sobre suscripción',
  'Reportar abogado',
  'Otro',
]);

// Rate limiting: 3 envíos por IP por hora. Un Map en memoria de proceso no
// sirve acá — en Vercel cada invocación puede aterrizar en una instancia
// serverless distinta y una instancia fría no comparte memoria con ninguna
// otra, así que el contador nunca se acumulaba de forma confiable. El
// contador vive en la tabla rate_limits de Supabase (migración
// 20260817_082_rate_limiting_contacto.sql), incrementado atómicamente por la
// función RPC fn_verificar_rate_limit — así el límite es real sin importar
// en qué instancia caiga cada request.
const LIMITE_POR_IP = 3;
const VENTANA_POSTGRES = '01:00:00'; // 1 hora, formato interval de Postgres

function obtenerIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'desconocida';
}

// Retorna true si el request está dentro del límite. Ante cualquier falla de
// red/configuración hacia Supabase, deja pasar el request (fail-open): un
// rate limiter caído no debe tumbar el formulario de contacto entero, y el
// resto de las validaciones (asunto de lista blanca, límites de longitud)
// ya acotan el abuso posible mientras tanto.
async function dentroDelLimite(ip) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[api/contacto] SUPABASE_URL/SUPABASE_ANON_KEY no configuradas; rate limiting deshabilitado.');
    return true;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_verificar_rate_limit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        p_ip: ip,
        p_endpoint: 'contacto',
        p_limite: LIMITE_POR_IP,
        p_ventana: VENTANA_POSTGRES,
      }),
    });

    if (!resp.ok) {
      console.error('[api/contacto] fn_verificar_rate_limit respondió con error:', resp.status, await resp.text());
      return true;
    }

    return await resp.json();
  } catch (err) {
    console.error('[api/contacto] No se pudo verificar el rate limit:', err);
    return true;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  if (!(await dentroDelLimite(obtenerIp(req)))) {
    res.status(429).json({ error: 'Demasiadas solicitudes. Intente nuevamente más tarde.' });
    return;
  }

  const { nombre, email, asunto, mensaje } = req.body || {};

  if (
    !esTextoValido(nombre, 150) ||
    !esEmailValido(email) ||
    !ASUNTOS_PERMITIDOS.has(asunto) ||
    !esTextoValido(mensaje, 2000)
  ) {
    res.status(400).json({ error: 'Datos inválidos. Verifique el formulario.' });
    return;
  }

  if (!ZOHO_SMTP_USER || !ZOHO_SMTP_PASSWORD) {
    console.error('[api/contacto] ZOHO_SMTP_USER/ZOHO_SMTP_PASSWORD no configuradas.');
    res.status(500).json({ error: 'El servicio de contacto no está disponible en este momento.' });
    return;
  }

  const transportador = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: ZOHO_SMTP_USER, pass: ZOHO_SMTP_PASSWORD },
  });

  try {
    await transportador.sendMail({
      from: EMAIL_FROM,
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `[Soporte LegalEC] ${asunto}`,
      html: `
        <p><strong>Nombre:</strong> ${escapar(nombre.trim())}</p>
        <p><strong>Correo:</strong> ${escapar(email.trim())}</p>
        <p><strong>Asunto:</strong> ${escapar(asunto)}</p>
        <p><strong>Mensaje:</strong></p>
        <p>${escapar(mensaje.trim()).replace(/\n/g, '<br>')}</p>
      `,
    });
  } catch (err) {
    console.error('[api/contacto] Zoho SMTP respondió con error:', err);
    res.status(502).json({ error: 'No se pudo enviar el mensaje. Intente de nuevo más tarde.' });
    return;
  }

  res.status(200).json({ ok: true });
};

function esTextoValido(valor, maxLength) {
  return typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= maxLength;
}

function esEmailValido(valor) {
  return typeof valor === 'string'
    && valor.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());
}

function escapar(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
