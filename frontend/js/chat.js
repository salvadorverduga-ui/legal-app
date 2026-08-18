// chat.js
// Componente de chat interno (migración 083), insertable en cualquier página
// que ya resolvió una solicitud ACEPTADA/COMPLETADA entre cliente y abogado.
//
// Uso:
//   import { inicializarChat, destruirChat } from './chat.js';
//   await inicializarChat('contenedorChat123', solicitudId, miId, nombreOtro);
//   ...
//   destruirChat('contenedorChat123');
//
// El llamador decide cuándo abrir/cerrar cada chat (ver solicitudes-directas.js
// / solicitudes-tablon.js: la regla "solo un chat abierto a la vez" se aplica
// ahí, llamando a destruirChat() del contenedor anterior antes de abrir uno
// nuevo). Este módulo solo garantiza que reinicializar el mismo contenedorId
// no deja dos suscripciones de Realtime activas sobre él.
//
// Todo el texto proveniente de la base de datos (contenido del mensaje,
// nombre del otro participante) se asigna vía textContent, nunca vía
// innerHTML — no hace falta una función escaparHtml() en este archivo.

import * as api from './api.js';
import { toast, mensajeAmigable } from './utils.js';

const LIMITE_CARACTERES = 2000;
const UMBRAL_CONTADOR_ROJO = 1800;

const instancias = new Map(); // contenedorId -> estado de esa instancia de chat

/**
 * Renderiza el chat de una solicitud dentro de #contenedorId, carga los
 * últimos 25 mensajes, marca como leídos y se suscribe a Realtime.
 * miId: id (auth.uid()) del usuario autenticado. nombreOtro: nombre a
 * mostrar en los mensajes que no son propios.
 */
export async function inicializarChat(contenedorId, solicitudId, miId, nombreOtro) {
  const contenedor = document.getElementById(contenedorId);
  if (!contenedor) return;

  if (instancias.has(contenedorId)) {
    destruirChat(contenedorId);
  }

  const estado = {
    contenedorId,
    solicitudId,
    miId,
    nombreOtro,
    pagina: 1,
    total: 0,
    cargandoAnteriores: false,
    cancelarEscucha: null,
    elementos: {},
  };
  instancias.set(contenedorId, estado);

  contenedor.innerHTML = `
    <div class="chat">
      <div class="chat__mensajes" role="log" aria-live="polite" aria-label="Mensajes del chat"></div>
      <div class="chat__input-area">
        <textarea class="chat__textarea" placeholder="Escriba su mensaje..." maxlength="${LIMITE_CARACTERES}"
          rows="2" aria-label="Escriba su mensaje"></textarea>
        <div class="chat__pie">
          <span class="chat__contador">0 / ${LIMITE_CARACTERES}</span>
          <button type="button" class="btn btn--primario btn--sm chat__btn-enviar">Enviar</button>
        </div>
      </div>
    </div>
  `;

  estado.elementos.listaMensajes = contenedor.querySelector('.chat__mensajes');
  estado.elementos.textarea = contenedor.querySelector('.chat__textarea');
  estado.elementos.contador = contenedor.querySelector('.chat__contador');
  estado.elementos.btnEnviar = contenedor.querySelector('.chat__btn-enviar');

  estado.elementos.textarea.addEventListener('input', () => actualizarContador(estado));
  estado.elementos.textarea.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      manejarEnvio(estado);
    }
  });
  estado.elementos.btnEnviar.addEventListener('click', () => manejarEnvio(estado));

  mostrarCargando(estado);
  await cargarPrimeraPagina(estado);

  estado.cancelarEscucha = api.chat.escuchar(solicitudId, (nuevoMensaje) => {
    manejarMensajeNuevo(estado, nuevoMensaje);
  });
}

/**
 * Cancela la suscripción de Realtime y vacía el contenedor. Segura de
 * llamar aunque el chat de ese contenedorId ya haya sido destruido o nunca
 * se haya inicializado.
 */
export function destruirChat(contenedorId) {
  const estado = instancias.get(contenedorId);
  if (!estado) return;

  if (estado.cancelarEscucha) estado.cancelarEscucha();

  const contenedor = document.getElementById(contenedorId);
  if (contenedor) contenedor.innerHTML = '';

  instancias.delete(contenedorId);
}

async function cargarPrimeraPagina(estado) {
  const { data, total, error } = await api.chat.getMensajes(estado.solicitudId, 1);

  if (error) {
    mostrarError(estado);
    return;
  }

  estado.pagina = 1;
  estado.total = total;

  const lista = estado.elementos.listaMensajes;
  lista.innerHTML = '';

  if (data.length === 0) {
    mostrarVacio(estado);
  } else {
    if (total > data.length) {
      lista.appendChild(crearBotonCargarAnteriores(estado));
    }
    data.forEach(mensaje => lista.appendChild(crearBurbuja(mensaje, estado)));
    lista.scrollTop = lista.scrollHeight;
  }

  api.chat.marcarLeidos(estado.solicitudId);
}

function crearBotonCargarAnteriores(estado) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn btn--secundario btn--sm chat__btn-anteriores';
  boton.textContent = 'Cargar mensajes anteriores';
  boton.addEventListener('click', () => cargarAnteriores(estado, boton));
  return boton;
}

async function cargarAnteriores(estado, boton) {
  if (estado.cargandoAnteriores) return;
  estado.cargandoAnteriores = true;
  boton.disabled = true;
  boton.textContent = 'Cargando...';

  const siguientePagina = estado.pagina + 1;
  const { data, total, error } = await api.chat.getMensajes(estado.solicitudId, siguientePagina);

  estado.cargandoAnteriores = false;

  if (error) {
    toast.error('No se pudieron cargar los mensajes anteriores. Intente de nuevo.');
    boton.disabled = false;
    boton.textContent = 'Cargar mensajes anteriores';
    return;
  }

  estado.pagina = siguientePagina;
  estado.total = total;

  const lista = estado.elementos.listaMensajes;
  // Se agregan mensajes arriba del scroll visible -- se preserva la posición
  // relativa del usuario en vez de saltar al tope de la lista.
  const alturaPrevia = lista.scrollHeight;
  const scrollPrevio = lista.scrollTop;

  const fragmento = document.createDocumentFragment();
  data.forEach(mensaje => fragmento.appendChild(crearBurbuja(mensaje, estado)));
  boton.after(fragmento);

  lista.scrollTop = scrollPrevio + (lista.scrollHeight - alturaPrevia);

  if (estado.total <= estado.pagina * 25) {
    boton.remove();
  } else {
    boton.disabled = false;
    boton.textContent = 'Cargar mensajes anteriores';
  }
}

function manejarMensajeNuevo(estado, nuevoMensaje) {
  const lista = estado.elementos.listaMensajes;
  if (!lista) return;

  const vacio = lista.querySelector('.chat__vacio');
  if (vacio) vacio.remove();

  lista.appendChild(crearBurbuja(nuevoMensaje, estado));
  estado.total += 1;
  lista.scrollTop = lista.scrollHeight;

  // Solo el receptor marca como leído -- si el mensaje nuevo es propio (otra
  // pestaña, u otro dispositivo con la misma sesión), no hay nada que marcar.
  if (nuevoMensaje.emisor_id !== estado.miId) {
    api.chat.marcarLeidos(estado.solicitudId);
  }
}

async function manejarEnvio(estado) {
  const textarea = estado.elementos.textarea;
  const contenido = textarea.value.trim();
  if (!contenido) return;

  estado.elementos.btnEnviar.disabled = true;

  const { error } = await api.chat.enviarMensaje(estado.solicitudId, contenido);

  estado.elementos.btnEnviar.disabled = false;

  if (error) {
    toast.error(mensajeAmigable(error, 'No se pudo enviar el mensaje. Intente de nuevo.'));
    return;
  }

  // No se agrega la burbuja acá de forma optimista: Realtime la entrega de
  // vuelta (el emisor también cumple la política SELECT de mensajes sobre
  // su propia fila), así que hay una sola vía de renderizado para todos los
  // mensajes, propios y ajenos.
  textarea.value = '';
  actualizarContador(estado);
  textarea.focus();
}

function actualizarContador(estado) {
  const longitud = estado.elementos.textarea.value.length;
  estado.elementos.contador.textContent = `${longitud} / ${LIMITE_CARACTERES}`;
  estado.elementos.contador.classList.toggle('chat__contador--limite', longitud > UMBRAL_CONTADOR_ROJO);
}

function crearBurbuja(mensaje, estado) {
  const esPropia = mensaje.emisor_id === estado.miId;

  const burbuja = document.createElement('div');
  burbuja.className = `chat__burbuja ${esPropia ? 'chat__burbuja--propia' : 'chat__burbuja--otro'}`;

  const contenido = document.createElement('p');
  contenido.className = 'chat__burbuja-contenido';
  contenido.textContent = mensaje.contenido;

  const meta = document.createElement('p');
  meta.className = 'chat__burbuja-meta';
  const nombre = esPropia ? 'Usted' : estado.nombreOtro;
  meta.textContent = `${nombre} · ${formatearHora(mensaje.created_at)}`;

  burbuja.appendChild(contenido);
  burbuja.appendChild(meta);
  return burbuja;
}

function formatearHora(fechaIso) {
  const fecha = new Date(fechaIso);
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  return `${hora}:${minutos}`;
}

function mostrarCargando(estado) {
  estado.elementos.listaMensajes.innerHTML =
    '<div class="spinner chat__spinner" role="status" aria-label="Cargando mensajes"></div>';
}

function mostrarVacio(estado) {
  const lista = estado.elementos.listaMensajes;
  lista.innerHTML = '';
  const parrafo = document.createElement('p');
  parrafo.className = 'chat__vacio';
  parrafo.textContent = 'Aún no hay mensajes. Sea el primero en escribir.';
  lista.appendChild(parrafo);
}

function mostrarError(estado) {
  const lista = estado.elementos.listaMensajes;
  lista.innerHTML = '';

  const contenedorError = document.createElement('div');
  contenedorError.className = 'chat__error';

  const parrafo = document.createElement('p');
  parrafo.textContent = 'No se pudo cargar el chat. Intente de nuevo.';

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn btn--secundario btn--sm';
  boton.textContent = 'Reintentar';
  boton.addEventListener('click', () => {
    mostrarCargando(estado);
    cargarPrimeraPagina(estado);
  });

  contenedorError.appendChild(parrafo);
  contenedorError.appendChild(boton);
  lista.appendChild(contenedorError);
}
