// supabase/functions/notificar-solicitud/index.ts
//
// Envía notificaciones por email vía Resend cuando:
//   - se crea una solicitud nueva (INSERT, estado=PENDIENTE)   -> avisa al abogado.
//   - una solicitud pasa de PENDIENTE a ACEPTADA (UPDATE)      -> avisa al cliente.
//
// Se invoca desde un Database Webhook de Supabase configurado sobre la tabla
// `solicitudes` para los eventos INSERT y UPDATE (Dashboard -> Database ->
// Webhooks). Ese webhook debe enviar el header
// `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — Supabase valida ese
// JWT automáticamente antes de invocar esta función (verify_jwt por defecto),
// así que no hace falta lógica de autenticación propia aquí.
//
// El resto de transiciones de estado (RECHAZADA, COMPLETADA, RESEÑADA,
// EXPIRADA) no generan email en esta fase — no lo pidió el alcance actual.
//
// Variables de entorno (configurar con `supabase secrets set`):
//   RESEND_API_KEY  — obligatoria. Sin ella no se envía ningún correo.
//   EMAIL_FROM      — remitente. Debe ser una dirección de un dominio
//                      verificado en Resend; si no hay dominio verificado,
//                      Resend solo permite enviar desde onboarding@resend.dev
//                      y únicamente al email del dueño de la cuenta Resend.
//   APP_URL         — URL pública de la app, para armar los links del email.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente
// en toda Edge Function; no hace falta configurarlas.

import { createClient } from 'npm:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'LegalEC <onboarding@resend.dev>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://legal-app-two.vercel.app';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { type, record, old_record } = payload;

  try {
    if (type === 'INSERT' && record?.estado === 'PENDIENTE') {
      await notificarNuevaSolicitud(record);
    } else if (
      type === 'UPDATE' &&
      old_record?.estado === 'PENDIENTE' &&
      record?.estado === 'ACEPTADA'
    ) {
      await notificarSolicitudAceptada(record);
    }
  } catch (err) {
    // Un fallo de email no debe hacer que Supabase reintente el webhook:
    // la solicitud ya se creó/actualizó correctamente en la transacción original.
    console.error('[notificar-solicitud]', err);
  }

  return new Response('ok', { status: 200 });
});

async function notificarNuevaSolicitud(solicitud: Record<string, any>) {
  const { data: abogadoPerfil, error: errPerfil } = await admin
    .from('perfiles')
    .select('nombre_completo')
    .eq('id', solicitud.abogado_id)
    .single();

  if (errPerfil || !abogadoPerfil) {
    console.error('[notificar-solicitud] No se encontró el perfil del abogado:', errPerfil?.message);
    return;
  }

  const { data: authData, error: errAuth } = await admin.auth.admin.getUserById(solicitud.abogado_id);
  const abogadoEmail = authData?.user?.email;
  if (errAuth || !abogadoEmail) {
    console.error('[notificar-solicitud] No se encontró el email del abogado:', errAuth?.message);
    return;
  }

  await enviarEmail({
    to: abogadoEmail,
    subject: 'Nueva solicitud de consulta — LegalEC',
    html: `
      <p>Hola ${escapar(abogadoPerfil.nombre_completo)},</p>
      <p>Recibió una nueva solicitud de consulta en LegalEC.</p>
      ${solicitud.descripcion_caso ? `<p><strong>Caso:</strong> ${escapar(solicitud.descripcion_caso)}</p>` : ''}
      ${solicitud.disponibilidad_horaria ? `<p><strong>Disponibilidad:</strong> ${escapar(solicitud.disponibilidad_horaria)}</p>` : ''}
      <p>Ingrese a su panel para aceptarla o rechazarla:</p>
      <p><a href="${APP_URL}/pages/panel-abogado">${APP_URL}/pages/panel-abogado</a></p>
      <p>Tiene 48 horas para responder antes de que la solicitud expire automáticamente.</p>
    `,
  });
}

async function notificarSolicitudAceptada(solicitud: Record<string, any>) {
  if (!solicitud.cliente_email) {
    console.error('[notificar-solicitud] La solicitud aceptada no tiene cliente_email; no se envía correo.');
    return;
  }

  const { data: abogadoPerfil } = await admin
    .from('perfiles')
    .select('nombre_completo')
    .eq('id', solicitud.abogado_id)
    .single();

  await enviarEmail({
    to: solicitud.cliente_email,
    subject: 'Su solicitud fue aceptada — LegalEC',
    html: `
      <p>Buenas noticias.</p>
      <p>${escapar(abogadoPerfil?.nombre_completo ?? 'El abogado')} aceptó su solicitud de consulta.</p>
      <p>Ingrese a su panel para ver los detalles de contacto:</p>
      <p><a href="${APP_URL}/pages/panel-cliente">${APP_URL}/pages/panel-cliente</a></p>
    `,
  });
}

async function enviarEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY) {
    console.error('[notificar-solicitud] RESEND_API_KEY no configurada; email no enviado.');
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
  });

  if (!res.ok) {
    console.error('[notificar-solicitud] Resend respondió con error:', res.status, await res.text());
  }
}

function escapar(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
