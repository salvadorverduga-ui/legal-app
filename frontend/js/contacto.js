// contacto.js
// Lógica de la página contacto.html.
// A diferencia del resto de páginas, no usa Supabase: el formulario se
// envía directamente a api/contacto.js (Vercel Serverless Function), que
// reenvía el mensaje por email al equipo de soporte vía SMTP de Zoho.

document.addEventListener('DOMContentLoaded', inicializar);

function inicializar() {
  const textarea = document.getElementById('contactoMensaje');
  const contador = document.getElementById('contadorMensaje');
  textarea.addEventListener('input', () => {
    contador.textContent = `${textarea.value.length} / 2000`;
  });

  document.getElementById('formContacto').addEventListener('submit', (e) => {
    e.preventDefault();
    manejarEnvio();
  });
}

async function manejarEnvio() {
  const nombre  = document.getElementById('contactoNombre').value.trim();
  const email   = document.getElementById('contactoEmail').value.trim();
  const asunto  = document.getElementById('contactoAsunto').value;
  const mensaje = document.getElementById('contactoMensaje').value.trim();

  const errorEl = document.getElementById('errorContacto');
  const btnEl = document.getElementById('btnEnviarContacto');
  errorEl.textContent = '';

  if (!nombre || !email || !asunto || !mensaje) {
    errorEl.textContent = 'Complete todos los campos.';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = 'Enviando...';

  try {
    const respuesta = await fetch('/api/contacto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, email, asunto, mensaje }),
    });

    if (!respuesta.ok) {
      throw new Error('Respuesta no exitosa del servidor.');
    }

    document.getElementById('formContacto').hidden = true;
    document.getElementById('confirmacionContacto').hidden = false;

  } catch (err) {
    console.error('[contacto] Error al enviar el formulario:', err);
    errorEl.textContent = 'No se pudo enviar el mensaje. Intente de nuevo más tarde.';
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Enviar mensaje';
  }
}
