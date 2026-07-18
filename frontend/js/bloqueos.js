// bloqueos.js
// Modal de confirmación de bloqueo con countdown de 9 segundos antes de
// habilitar "Confirmar bloqueo" (CLAUDE.md módulo 8). Reutilizado por
// perfil-abogado.html (cliente bloquea a un abogado) y panel-abogado.html
// (abogado bloquea a un cliente desde una tarjeta de solicitud) — mismo
// criterio que confirmar() en utils.js, pero con el contador propio de
// este flujo, así que no reutiliza ese modal genérico.
//
// Uso:
//   import { confirmarBloqueo } from './bloqueos.js';
//   const bloqueado = await confirmarBloqueo(usuarioId, nombre);
//   if (bloqueado) { /* actualizar la UI: ocultar la tarjeta, etc. */ }

import * as api from './api.js';
import { toast, mensajeAmigable } from './utils.js';

const SEGUNDOS_ESPERA = 9;

let elementos = null;

function obtenerModal() {
  if (elementos) return elementos;

  const overlay = document.createElement('div');
  overlay.className = 'modal-confirmar-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-confirmar" role="alertdialog" aria-modal="true" aria-labelledby="modalBloqueoMensaje">
      <p class="modal-confirmar__mensaje" id="modalBloqueoMensaje"></p>
      <div class="modal-confirmar__acciones">
        <button type="button" class="btn btn--secundario btn--sm" id="modalBloqueoCancelar">Cancelar</button>
        <button type="button" class="btn btn--primario btn--sm" id="modalBloqueoConfirmar" disabled></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  elementos = {
    overlay,
    mensaje: overlay.querySelector('#modalBloqueoMensaje'),
    btnCancelar: overlay.querySelector('#modalBloqueoCancelar'),
    btnConfirmar: overlay.querySelector('#modalBloqueoConfirmar'),
  };
  return elementos;
}

/**
 * Abre el modal de confirmación de bloqueo para `nombre` y, si se confirma,
 * llama a api.bloqueos.bloquear(usuarioId). El botón "Confirmar" queda
 * deshabilitado con un contador de 9 segundos ("Confirmar (9)", "Confirmar
 * (8)"...) antes de poder hacer clic. Muestra un toast con el resultado.
 * Retorna Promise<boolean> — true si el bloqueo se confirmó y se guardó.
 */
export function confirmarBloqueo(usuarioId, nombre) {
  const { overlay, mensaje, btnCancelar, btnConfirmar } = obtenerModal();

  mensaje.textContent =
    `¿Está seguro de que desea bloquear a ${nombre}? Al hacerlo: no podrá ver su perfil, ` +
    'no podrá enviarle solicitudes, no aparecerá en sus búsquedas, y todas las solicitudes ' +
    'activas entre ustedes serán canceladas automáticamente.';

  let segundosRestantes = SEGUNDOS_ESPERA;
  btnConfirmar.disabled = true;
  btnConfirmar.textContent = `Confirmar (${segundosRestantes})`;

  const intervalo = setInterval(() => {
    segundosRestantes -= 1;
    if (segundosRestantes <= 0) {
      clearInterval(intervalo);
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar bloqueo';
    } else {
      btnConfirmar.textContent = `Confirmar (${segundosRestantes})`;
    }
  }, 1000);

  const elementoConFocoPrevio = document.activeElement;

  return new Promise((resolve) => {
    function cerrar() {
      clearInterval(intervalo);
      overlay.hidden = true;
      btnCancelar.removeEventListener('click', manejarCancelar);
      btnConfirmar.removeEventListener('click', manejarConfirmar);
      overlay.removeEventListener('click', manejarClickOverlay);
      document.removeEventListener('keydown', manejarTecla);
      if (elementoConFocoPrevio instanceof HTMLElement) elementoConFocoPrevio.focus();
    }

    async function manejarConfirmar() {
      if (btnConfirmar.disabled) return;
      btnConfirmar.disabled = true;

      const { error } = await api.bloqueos.bloquear(usuarioId);
      cerrar();

      if (error) {
        toast.error(mensajeAmigable(error, 'No se pudo bloquear a este usuario. Intente de nuevo.'));
        resolve(false);
        return;
      }

      toast.exito(
        `Bloqueó a ${nombre}. Ya no podrán verse ni contactarse, y sus solicitudes activas fueron canceladas.`
      );
      resolve(true);
    }

    function manejarCancelar() {
      cerrar();
      resolve(false);
    }

    function manejarClickOverlay(e) {
      if (e.target === overlay) {
        cerrar();
        resolve(false);
      }
    }

    function manejarTecla(e) {
      if (e.key === 'Escape') {
        cerrar();
        resolve(false);
      }
    }

    btnCancelar.addEventListener('click', manejarCancelar);
    btnConfirmar.addEventListener('click', manejarConfirmar);
    overlay.addEventListener('click', manejarClickOverlay);
    document.addEventListener('keydown', manejarTecla);

    overlay.hidden = false;
    btnCancelar.focus();
  });
}
