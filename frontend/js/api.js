// api.js
// Única capa de acceso a Supabase en el frontend.
// Ninguna otra capa debe importar ni usar el cliente de Supabase directamente.
//
// Uso:
//   import * as api from './api.js';
//   api.inicializarCliente(supabaseClient);  // llamar una sola vez en app.js
//   await api.auth.iniciarSesion(email, pass);

let _cliente = null;

/**
 * Inicializa el módulo con el cliente Supabase creado en app.js.
 * Debe llamarse antes de cualquier otra función de este módulo.
 */
export function inicializarCliente(cliente) {
  _cliente = cliente;
}

/**
 * Sube un archivo al bucket verificacion-docs bajo `${carpetaId}/${prefijo}-timestamp.ext`
 * y retorna el path relativo guardado en verificaciones.doc_*_url.
 * Lanza el error de Storage si la subida falla (el llamador lo captura).
 */
async function _subirDocumento(carpetaId, archivo, prefijo) {
  const extension = archivo.name.split('.').pop();
  const path = `${carpetaId}/${prefijo}-${Date.now()}.${extension}`;
  const { error } = await _cliente.storage
    .from('verificacion-docs')
    .upload(path, archivo, { upsert: true });

  if (error) throw error;
  return path;
}


// ════════════════════════════════════════════════════════════
// AUTH
// Autenticación de usuarios vía Supabase Auth.
// ════════════════════════════════════════════════════════════
export const auth = {

  /**
   * Inicia sesión con email y contraseña.
   * Retorna { perfil, error } donde perfil incluye rol, nombre y ciudad
   * (necesario para el routing inmediato en app.js).
   * Si hay error de Supabase, retorna { perfil: null, error }.
   */
  async iniciarSesion(email, password) {
    const { data, error } = await _cliente.auth.signInWithPassword({ email, password });
    if (error) return { perfil: null, error };

    const { data: perfil, error: errPerfil } = await _cliente
      .from('perfiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (errPerfil) return { perfil: null, error: errPerfil };
    return { perfil, error: null };
  },

  /**
   * Registra un nuevo usuario con rol='cliente'. El cliente no tiene cédula
   * (a diferencia de abogados/estudios, que sí necesitan un identificador
   * para verificación) — perfiles.cedula queda NULL para estos usuarios.
   * Pasa nombre_completo y rol en raw_user_meta_data para que el trigger
   * fn_crear_perfil_en_registro los use al crear la fila en perfiles.
   * El email de confirmación lo envía Supabase automáticamente.
   * Retorna { data, error }.
   */
  async registrarCliente({ email, password, nombre_completo }) {
    const { data, error } = await _cliente.auth.signUp({
      email,
      password,
      options: {
        data: { rol: 'cliente', nombre_completo },
      },
    });

    if (error) {
      console.error('[api.auth.registrarCliente]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Registra un nuevo usuario con rol='abogado' (incluye abogado individual
   * y quienes se unen a una red de colaboradores: la cuenta es idéntica,
   * la vinculación a la red se hace después desde el panel del abogado).
   * El trigger fn_crear_fila_abogado crea automáticamente la fila en abogados
   * con verificacion='PENDIENTE', toggle_disponible=true, y copia
   * numero_carnet/especialidades desde raw_user_meta_data.
   * datos: { email, password, nombre_completo, cedula, numero_carnet, especialidades: string[], provincia }
   * Retorna { data, error }.
   */
  async registrarAbogado({ email, password, nombre_completo, cedula, numero_carnet, especialidades, provincia }) {
    const { data, error } = await _cliente.auth.signUp({
      email,
      password,
      options: {
        data: { rol: 'abogado', nombre_completo, cedula, numero_carnet, especialidades, provincia },
      },
    });

    if (error) {
      console.error('[api.auth.registrarAbogado]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Registra un nuevo usuario con rol='estudio'. nombre_completo del perfil
   * corresponde al representante legal (quien inicia sesión), no al estudio.
   * El trigger fn_crear_fila_estudio crea automáticamente la fila en estudios
   * (plan='PEQUENO' por defecto) copiando nombre_estudio/ruc/especialidades/
   * provincia desde raw_user_meta_data.
   * datos: { email, password, nombre_representante, nombre_estudio, ruc, especialidades: string[], provincia }
   * Retorna { data, error }.
   */
  async registrarEstudio({ email, password, nombre_representante, nombre_estudio, ruc, especialidades, provincia }) {
    const { data, error } = await _cliente.auth.signUp({
      email,
      password,
      options: {
        data: {
          rol: 'estudio',
          nombre_completo: nombre_representante,
          nombre_estudio,
          ruc,
          especialidades,
          provincia,
        },
      },
    });

    if (error) {
      console.error('[api.auth.registrarEstudio]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Cierra la sesión del usuario actual en todos los dispositivos.
   * Retorna { error }.
   */
  async cerrarSesion() {
    const { error } = await _cliente.auth.signOut();
    if (error) console.error('[api.auth.cerrarSesion]', error.message);
    return { error };
  },

  /**
   * Retorna la sesión activa o null si no hay sesión.
   * Usar siempre esta función; nunca leer localStorage directamente.
   * Retorna el objeto session de Supabase o null.
   */
  async getSession() {
    const { data, error } = await _cliente.auth.getSession();
    if (error) {
      console.error('[api.auth.getSession]', error.message);
      return null;
    }
    return data.session ?? null;
  },

  /**
   * Suscribe un callback a cambios de estado de autenticación.
   * Eventos posibles: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED.
   * Retorna la función para cancelar la suscripción (llamar al desmontar).
   */
  onAuthStateChange(callback) {},

  /**
   * Envía un correo con un enlace para restablecer la contraseña.
   * El enlace lleva a nueva-contrasena.html, donde Supabase completa el
   * inicio de sesión temporal (tipo 'recovery') a partir del token en la URL.
   * No revela si el correo existe o no en el sistema (comportamiento
   * estándar de Supabase Auth) — siempre retorna éxito salvo error de red.
   * Retorna { error }.
   */
  async recuperarContrasena(email) {
    const { error } = await _cliente.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/pages/nueva-contrasena`,
    });

    if (error) {
      console.error('[api.auth.recuperarContrasena]', error.message);
      return { error };
    }
    return { error: null };
  },

  /**
   * Establece una nueva contraseña para la sesión de recuperación activa
   * (creada por Supabase al abrir el enlace de nueva-contrasena.html).
   * Retorna { error }.
   */
  async actualizarContrasena(nuevaPassword) {
    const { error } = await _cliente.auth.updateUser({ password: nuevaPassword });

    if (error) {
      console.error('[api.auth.actualizarContrasena]', error.message);
      return { error };
    }
    return { error: null };
  },

};


// ════════════════════════════════════════════════════════════
// PERFILES
// Datos de perfil del usuario autenticado y de otros usuarios.
// ════════════════════════════════════════════════════════════
export const perfiles = {

  /**
   * Retorna el perfil completo del usuario autenticado desde la tabla perfiles.
   * Incluye: id, rol, nombre_completo, cedula, telefono, ciudad, provincia, foto_url.
   * Retorna null si no hay sesión activa.
   */
  async getPerfilActual() {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) return null;

    const { data, error } = await _cliente
      .from('perfiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('[api.perfiles.getPerfilActual]', error.message);
      return null;
    }
    return data;
  },

  /**
   * Actualiza los datos editables del perfil del usuario autenticado.
   * Campos permitidos: nombre_completo, telefono, ciudad, provincia.
   * El campo rol está bloqueado por la política RLS WITH CHECK en perfiles.
   * Retorna { data, error }.
   */
  async actualizarPerfil(datos) {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { data: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    const CAMPOS_PERMITIDOS = ['nombre_completo', 'telefono', 'ciudad', 'provincia'];
    const actualizacion = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (datos[campo] !== undefined) actualizacion[campo] = datos[campo];
    }

    const { data, error } = await _cliente
      .from('perfiles')
      .update(actualizacion)
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[api.perfiles.actualizarPerfil]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Sube una foto de perfil a Supabase Storage (bucket: avatares)
   * y actualiza perfiles.foto_url con el path resultante.
   * El archivo debe ser image/jpeg, image/png o image/webp. Tamaño máximo: 10MB.
   * Retorna { url, error } donde url es el path en Storage.
   */
  async subirFotoPerfil(archivo) {
    const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
    const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

    if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
      return { url: null, error: { message: 'El archivo debe ser JPG, PNG o WEBP.' } };
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return { url: null, error: { message: 'El archivo no debe superar los 10MB.' } };
    }

    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { url: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    const extension = archivo.name.split('.').pop();
    const path = `${user.id}/foto-${Date.now()}.${extension}`;

    const { error: errUpload } = await _cliente.storage
      .from('avatares')
      .upload(path, archivo, { upsert: true });

    if (errUpload) {
      console.error('[api.perfiles.subirFotoPerfil]', errUpload.message);
      return { url: null, error: errUpload };
    }

    const { error: errUpdate } = await _cliente
      .from('perfiles')
      .update({ foto_url: path })
      .eq('id', user.id);

    if (errUpdate) {
      console.error('[api.perfiles.subirFotoPerfil]', errUpdate.message);
      return { url: null, error: errUpdate };
    }

    return { url: path, error: null };
  },

};


// ════════════════════════════════════════════════════════════
// ABOGADOS
// Datos profesionales y búsqueda de abogados.
// Solo retorna abogados visibles (RLS filtra no verificados / sin suscripción).
// ════════════════════════════════════════════════════════════
export const abogados = {

  /**
   * Busca abogados visibles aplicando filtros opcionales sobre la vista busqueda_abogados.
   * La vista ya excluye abogados no verificados, no disponibles y con suscripción vencida.
   * filtros: {
   *   especialidad?:     string,  // búsqueda en el array especialidades con operador @>
   *   caso_frecuente?:   string,  // búsqueda en casos_frecuentes
   *   provincia_id?:     number,  // coincide con provincia_id (principal) O zonas_servicio_ids
   *   tipo?:             'individual' | 'estudio' | 'red',
   * }
   * Retorna array con tipo_badge ('individual' | 'estudio' | 'red') y datos públicos.
   * Cuando se filtra por provincia_id, los resultados cuya provincia principal coincide
   * aparecen antes que los que solo la tienen como zona de servicio adicional.
   */
  async buscar(filtros = {}) {
    const LIMITE_RESULTADOS = 100; // tope para MVP; paginación en V2

    // IMPORTANTE: no agregar condiciones de visibilidad aquí.
    // La vista busqueda_abogados ya las tiene en su WHERE clause.
    // El RLS sobre abogados es la fuente de verdad — no duplicar en el frontend.
    // Prerequisito: GRANT SELECT ON busqueda_abogados TO authenticated;
    // (agregar en supabase/migrations/20260625_011_grants.sql si aún no existe)
    let query = _cliente
      .from('busqueda_abogados')
      .select('*')
      .order('rating_promedio', { ascending: false })
      .order('total_resenas',   { ascending: false });

    // El operador @> (contains) comprueba que el array de la BD contiene el elemento.
    // Usa el GIN index de migration 004. Requiere coincidencia exacta con el valor del array.
    if (filtros.especialidad?.trim()) {
      query = query.contains('especialidades', [filtros.especialidad.trim()]);
    }

    if (filtros.caso_frecuente?.trim()) {
      query = query.contains('casos_frecuentes', [filtros.caso_frecuente.trim()]);
    }

    // Coincide si la provincia buscada es la principal del abogado o
    // aparece en sus zonas de servicio adicionales (zonas_servicio_ids).
    if (filtros.provincia_id) {
      query = query.or(`provincia_id.eq.${filtros.provincia_id},zonas_servicio_ids.cs.{${filtros.provincia_id}}`);
    } else {
      // Sin filtro de provincia no hace falta reordenar en el cliente: el tope
      // se aplica directo en la consulta SQL.
      query = query.limit(LIMITE_RESULTADOS);
    }

    // tipo_badge es columna calculada en la vista: 'individual' | 'estudio' | 'red'
    if (filtros.tipo && ['individual', 'estudio', 'red'].includes(filtros.tipo)) {
      query = query.eq('tipo_badge', filtros.tipo);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[api.abogados.buscar]', error.message);
      return { data: [], error };
    }

    let resultado = data ?? [];

    // Prioriza coincidencia por provincia principal sobre coincidencia por zona
    // de servicio adicional, preservando el orden por rating dentro de cada grupo
    // (Array.prototype.sort es estable desde ES2019, así que el orden por rating
    // ya aplicado en la consulta SQL se conserva dentro de cada grupo).
    //
    // Este reordenamiento no puede vivir en la definición de la vista
    // busqueda_abogados (migración 009/028): una vista no recibe parámetros, así
    // que no hay forma de que su propio ORDER BY sepa qué provincia se está
    // buscando en cada consulta. Por eso el tope de resultados tampoco se aplica
    // en la consulta SQL en este caso — se aplica acá, después de reordenar, para
    // no truncar de forma prematura y descartar por error abogados cuya provincia
    // principal coincide en favor de abogados que solo la tienen como zona de
    // servicio adicional.
    if (filtros.provincia_id) {
      resultado = [...resultado]
        .sort((a, b) => {
          const aEsPrincipal = a.provincia_id === filtros.provincia_id ? 0 : 1;
          const bEsPrincipal = b.provincia_id === filtros.provincia_id ? 0 : 1;
          return aEsPrincipal - bEsPrincipal;
        })
        .slice(0, LIMITE_RESULTADOS);
    }

    return { data: resultado, error: null };
  },

  /**
   * Retorna el perfil público de un abogado por su id desde la vista busqueda_abogados.
   * Retorna null si el abogado no existe o no cumple las condiciones de visibilidad.
   */
  async getAbogado(id) {
    const { data, error } = await _cliente
      .from('busqueda_abogados')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[api.abogados.getAbogado]', error.message);
      return null;
    }
    return data;
  },

  /**
   * Retorna la fila propia del abogado autenticado desde la tabla abogados
   * (no desde la vista busqueda_abogados, que oculta perfiles no visibles).
   * Incluye verificacion, toggle_disponible, suscripcion_vigente_hasta y los
   * datos profesionales, sin importar el estado de verificación o suscripción.
   * Retorna null si no hay sesión activa o falla la consulta.
   */
  async getPerfilPropio() {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) return null;

    const { data, error } = await _cliente
      .from('abogados')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('[api.abogados.getPerfilPropio]', error.message);
      return null;
    }
    return data;
  },

  /**
   * Actualiza los datos profesionales del abogado autenticado en la tabla abogados.
   * Campos permitidos: especialidades, casos_frecuentes, descripcion,
   *                    precio_consulta, numero_registro, provincia_id, canton_id.
   * verificacion y suscripcion_vigente_hasta no se pueden modificar desde el cliente.
   * Retorna { data, error }.
   */
  async actualizarPerfilAbogado(datos) {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { data: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    const CAMPOS_PERMITIDOS = ['especialidades', 'casos_frecuentes', 'descripcion', 'precio_consulta', 'numero_registro', 'provincia_id', 'canton_id'];
    const actualizacion = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (datos[campo] !== undefined) actualizacion[campo] = datos[campo];
    }

    const { data, error } = await _cliente
      .from('abogados')
      .update(actualizacion)
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[api.abogados.actualizarPerfilAbogado]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Alterna toggle_disponible del abogado autenticado (true → false o false → true).
   * Un abogado con toggle_disponible=false no aparece en búsquedas ni recibe solicitudes,
   * incluso si tiene verificación y suscripción vigente.
   * Retorna { toggle_disponible: boolean, error }.
   */
  async toggleDisponible() {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { toggle_disponible: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    const { data: actual, error: errActual } = await _cliente
      .from('abogados')
      .select('toggle_disponible')
      .eq('id', user.id)
      .single();

    if (errActual) {
      console.error('[api.abogados.toggleDisponible]', errActual.message);
      return { toggle_disponible: null, error: errActual };
    }

    const { data, error } = await _cliente
      .from('abogados')
      .update({ toggle_disponible: !actual.toggle_disponible })
      .eq('id', user.id)
      .select('toggle_disponible')
      .single();

    if (error) {
      console.error('[api.abogados.toggleDisponible]', error.message);
      return { toggle_disponible: null, error };
    }
    return { toggle_disponible: data.toggle_disponible, error: null };
  },

  /**
   * Sube los documentos de verificación a Supabase Storage (bucket: verificacion-docs)
   * e inserta una fila en la tabla verificaciones con estado='PENDIENTE'.
   * La cédula se sube en dos archivos separados (anverso y reverso), cada
   * uno con su propio prefijo en el path de Storage.
   * archivos: { carnet: File, cedulaAnverso: File, cedulaReverso: File }
   * El admin revisa manualmente desde el panel y aprueba o rechaza.
   * Retorna { data, error }.
   */
  async enviarDocumentosVerificacion(archivos) {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { data: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    try {
      const doc_carnet_url = await _subirDocumento(user.id, archivos.carnet, 'carnet');
      const doc_cedula_url = await _subirDocumento(user.id, archivos.cedulaAnverso, 'cedula-anverso');
      const doc_cedula_reverso_url = await _subirDocumento(user.id, archivos.cedulaReverso, 'cedula-reverso');

      const { data, error } = await _cliente
        .from('verificaciones')
        .insert({ abogado_id: user.id, doc_carnet_url, doc_cedula_url, doc_cedula_reverso_url })
        .select()
        .single();

      if (error) {
        console.error('[api.abogados.enviarDocumentosVerificacion]', error.message);
        return { data: null, error };
      }
      return { data, error: null };

    } catch (err) {
      console.error('[api.abogados.enviarDocumentosVerificacion]', err.message);
      return { data: null, error: err };
    }
  },

  /**
   * Retorna el estado actual de la verificación del abogado autenticado.
   * Consulta la tabla verificaciones ordenada por created_at DESC (la más reciente).
   * Retorna { estado, motivo_rechazo, created_at } o null si nunca envió documentos.
   */
  async getEstadoVerificacion() {},

  /**
   * Retorna las provincias donde el abogado autenticado presta servicios
   * además de su provincia principal (abogados.provincia_id), junto con el
   * cantón específico si lo marcó (canton_id null = toda la provincia).
   * Retorna array de { provincia_id, canton_id, provincias: { nombre }, cantones: { nombre } | null }.
   */
  async getZonasServicio() {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) return [];

    const { data, error } = await _cliente
      .from('abogado_zonas_servicio')
      .select('provincia_id, canton_id, provincias (nombre), cantones (nombre)')
      .eq('abogado_id', user.id);

    if (error) {
      console.error('[api.abogados.getZonasServicio]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * Reemplaza el conjunto completo de zonas de servicio adicionales del
   * abogado autenticado por la lista recibida.
   * No debe incluir la provincia principal (abogados.provincia_id) — eso
   * se valida en el frontend antes de llamar esta función.
   * zonas: { provincia_id: number, canton_id?: number|null }[]
   *   canton_id ausente o null = atiende en toda la provincia.
   * Retorna { data, error }.
   */
  async actualizarZonasServicio(zonas = []) {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { data: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    const { error: errDelete } = await _cliente
      .from('abogado_zonas_servicio')
      .delete()
      .eq('abogado_id', user.id);

    if (errDelete) {
      console.error('[api.abogados.actualizarZonasServicio]', errDelete.message);
      return { data: null, error: errDelete };
    }

    if (zonas.length === 0) {
      return { data: [], error: null };
    }

    const filas = zonas.map(({ provincia_id, canton_id }) => ({
      abogado_id: user.id,
      provincia_id,
      canton_id: canton_id ?? null,
    }));
    const { data, error } = await _cliente
      .from('abogado_zonas_servicio')
      .insert(filas)
      .select();

    if (error) {
      console.error('[api.abogados.actualizarZonasServicio]', error.message);
      return { data: null, error };
    }
    return { data: data ?? [], error: null };
  },

};


// ════════════════════════════════════════════════════════════
// GEO
// Catálogo de provincias y cantones del Ecuador (datos de referencia,
// tablas provincias/cantones). Usado para poblar selectores de ubicación
// en el panel del abogado y en el filtro de búsqueda.
// ════════════════════════════════════════════════════════════
export const geo = {

  /**
   * Retorna todas las provincias ordenadas alfabéticamente.
   * Retorna array de { id, nombre } (puede estar vacío si falla la consulta).
   */
  async getProvincias() {
    const { data, error } = await _cliente
      .from('provincias')
      .select('*')
      .order('nombre');

    if (error) {
      console.error('[api.geo.getProvincias]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * Retorna los cantones de una provincia, ordenados alfabéticamente.
   * Retorna array de { id, nombre, provincia_id } (puede estar vacío).
   */
  async getCantonesPorProvincia(provinciaId) {
    if (!provinciaId) return [];

    const { data, error } = await _cliente
      .from('cantones')
      .select('*')
      .eq('provincia_id', provinciaId)
      .order('nombre');

    if (error) {
      console.error('[api.geo.getCantonesPorProvincia]', error.message);
      return [];
    }
    return data ?? [];
  },

};


// ════════════════════════════════════════════════════════════
// ESTUDIOS
// Datos organizacionales del estudio jurídico del representante legal.
// ════════════════════════════════════════════════════════════
export const estudios = {

  /**
   * Retorna el estudio del representante legal autenticado.
   * Retorna null si el usuario no representa ningún estudio.
   */
  async getEstudioPropio() {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) return null;

    const { data, error } = await _cliente
      .from('estudios')
      .select('*')
      .eq('representante_legal_id', user.id)
      .single();

    if (error) {
      console.error('[api.estudios.getEstudioPropio]', error.message);
      return null;
    }
    return data;
  },

  /**
   * Sube los documentos de verificación del estudio (RUC y nombramiento del
   * representante legal) a Supabase Storage (bucket: verificacion-docs)
   * e inserta una fila en verificaciones con estado='PENDIENTE'.
   * archivos: { ruc: File, nombramiento: File }
   * Retorna { data, error }.
   */
  async enviarDocumentosVerificacion(archivos) {
    const estudio = await this.getEstudioPropio();
    if (!estudio) {
      return { data: null, error: { message: 'No se encontró el estudio del representante.' } };
    }

    try {
      const doc_ruc_url = await _subirDocumento(estudio.id, archivos.ruc, 'ruc');
      const doc_nombramiento_url = await _subirDocumento(estudio.id, archivos.nombramiento, 'nombramiento');

      const { data, error } = await _cliente
        .from('verificaciones')
        .insert({ estudio_id: estudio.id, doc_ruc_url, doc_nombramiento_url })
        .select()
        .single();

      if (error) {
        console.error('[api.estudios.enviarDocumentosVerificacion]', error.message);
        return { data: null, error };
      }
      return { data, error: null };

    } catch (err) {
      console.error('[api.estudios.enviarDocumentosVerificacion]', err.message);
      return { data: null, error: err };
    }
  },

};


// ════════════════════════════════════════════════════════════
// SOLICITUDES
// Flujo mediado de contacto entre cliente y abogado.
// ════════════════════════════════════════════════════════════
export const solicitudes = {

  /**
   * Crea una nueva solicitud de consulta.
   * Antes de insertar, llama a abogado_es_visible() para validar que el abogado
   * aún es visible según la fecha del servidor (nunca la del cliente).
   * Solo pueden crearlas usuarios con rol='cliente' (política RLS de INSERT).
   * datos: { descripcion_caso?: string, disponibilidad_horaria?: string }
   * Retorna { data, error }.
   */
  async crearSolicitud(abogadoId, datos = {}) {
    const { data: visible, error: errVisible } = await _cliente
      .rpc('abogado_es_visible', { p_abogado_id: abogadoId });

    if (errVisible) {
      console.error('[api.solicitudes.crearSolicitud]', errVisible.message);
      return { data: null, error: errVisible };
    }

    if (!visible) {
      return { data: null, error: { message: 'Este abogado ya no está disponible.' } };
    }

    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { data: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    const { data, error } = await _cliente
      .from('solicitudes')
      .insert({
        cliente_id: user.id,
        abogado_id: abogadoId,
        descripcion_caso: datos.descripcion_caso?.trim() || null,
        disponibilidad_horaria: datos.disponibilidad_horaria || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[api.solicitudes.crearSolicitud]', error.message);
      if (error.code === '23505') {
        return { data: null, error: { message: 'Ya tiene una solicitud activa con este abogado.' } };
      }
      return { data: null, error };
    }

    return { data, error: null };
  },

  /**
   * Retorna todas las solicitudes del cliente autenticado.
   * Usa la vista panel_solicitudes_cliente para incluir datos públicos del abogado.
   * Ordenadas por created_at DESC.
   * Retorna array de solicitudes con estado, abogado_nombre, abogado_rating, tiene_resena.
   */
  async getSolicitudesCliente() {
    const { data, error } = await _cliente
      .from('panel_solicitudes_cliente')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api.solicitudes.getSolicitudesCliente]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * Retorna todas las solicitudes dirigidas al abogado autenticado.
   * Usa la vista panel_solicitudes_abogado.
   * cliente_telefono y cliente_email son null en estado PENDIENTE;
   * el trigger fn_revelar_contacto_al_aceptar los completa al aceptar.
   * Ordenadas por created_at DESC.
   */
  async getSolicitudesAbogado() {
    const { data, error } = await _cliente
      .from('panel_solicitudes_abogado')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api.solicitudes.getSolicitudesAbogado]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * El abogado acepta una solicitud en estado PENDIENTE.
   * El trigger fn_revelar_contacto_al_aceptar copia el teléfono y email del cliente
   * en solicitudes.cliente_telefono / cliente_email.
   * Notificación al cliente: pendiente de implementar con Edge Function.
   * Retorna { data, error }.
   */
  async aceptarSolicitud(solicitudId) {
    const { data, error } = await _cliente
      .from('solicitudes')
      .update({ estado: 'ACEPTADA' })
      .eq('id', solicitudId)
      .eq('estado', 'PENDIENTE')
      .select()
      .single();

    if (error) {
      console.error('[api.solicitudes.aceptarSolicitud]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * El abogado rechaza una solicitud en estado PENDIENTE.
   * motivo es interno; el cliente recibe "no disponible en este momento".
   * Retorna { data, error }.
   */
  async rechazarSolicitud(solicitudId, motivo = '') {
    const { data, error } = await _cliente
      .from('solicitudes')
      .update({ estado: 'RECHAZADA', motivo_rechazo: motivo.trim() || null })
      .eq('id', solicitudId)
      .eq('estado', 'PENDIENTE')
      .select()
      .single();

    if (error) {
      console.error('[api.solicitudes.rechazarSolicitud]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * El cliente marca una solicitud ACEPTADA como COMPLETADA.
   * Esta transición habilita la opción de dejar reseña.
   * Solo es posible si el estado actual es ACEPTADA (validar antes de llamar).
   * Retorna { data, error }.
   */
  async completarSolicitud(solicitudId) {
    const { data, error } = await _cliente
      .from('solicitudes')
      .update({ estado: 'COMPLETADA' })
      .eq('id', solicitudId)
      .eq('estado', 'ACEPTADA')
      .select()
      .single();

    if (error) {
      console.error('[api.solicitudes.completarSolicitud]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * El cliente cancela su propia solicitud mientras está PENDIENTE.
   * La política RLS "cliente_cancela_solicitud" solo permite esta transición
   * exacta (PENDIENTE -> CANCELADA).
   * Retorna { data, error }.
   */
  async cancelar(solicitudId) {
    const { data, error } = await _cliente
      .from('solicitudes')
      .update({ estado: 'CANCELADA' })
      .eq('id', solicitudId)
      .eq('estado', 'PENDIENTE')
      .select()
      .single();

    if (error) {
      console.error('[api.solicitudes.cancelar]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * El cliente edita descripcion_caso y/o disponibilidad_horaria de su
   * propia solicitud mientras sigue PENDIENTE. La política RLS
   * "cliente_edita_solicitud_pendiente" (migración 033) exige que la
   * solicitud siga PENDIENTE antes y después del update, y bloquea
   * cualquier otra columna (abogado_id, datos de contacto, metadatos del
   * ciclo de vida).
   * datos: { descripcion_caso?: string, disponibilidad_horaria?: string }
   * Retorna { data, error }.
   */
  async editar(solicitudId, datos = {}) {
    const CAMPOS_PERMITIDOS = ['descripcion_caso', 'disponibilidad_horaria'];
    const actualizacion = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (datos[campo] !== undefined) actualizacion[campo] = datos[campo];
    }

    const { data, error } = await _cliente
      .from('solicitudes')
      .update(actualizacion)
      .eq('id', solicitudId)
      .eq('estado', 'PENDIENTE')
      .select()
      .single();

    if (error) {
      console.error('[api.solicitudes.editar]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Retorna los abogados con los que el cliente autenticado tuvo una
   * solicitud ACEPTADA, COMPLETADA o RESEÑADA — una fila por abogado (ver
   * vista panel_abogados_contactados, migración 034).
   * Ordenados: primero los que tienen una solicitud ACEPTADA en curso
   * (tiene_solicitud_activa=true), luego por fecha de última interacción
   * descendente dentro de cada grupo.
   * Retorna array (puede estar vacío).
   */
  async getAbogadosContactados() {
    const { data, error } = await _cliente
      .from('panel_abogados_contactados')
      .select('*')
      .order('tiene_solicitud_activa', { ascending: false })
      .order('ultima_interaccion', { ascending: false });

    if (error) {
      console.error('[api.solicitudes.getAbogadosContactados]', error.message);
      return [];
    }
    return data ?? [];
  },

};


// ════════════════════════════════════════════════════════════
// SUSCRIPCIONES
// Historial de suscripciones del usuario autenticado.
// En MVP, el admin registra los pagos manualmente.
// ════════════════════════════════════════════════════════════
export const suscripciones = {

  /**
   * Retorna la suscripción ACTIVA más reciente del abogado o estudio autenticado.
   * Incluye tipo, fecha_vencimiento y monto.
   * Retorna null si no hay suscripción activa vigente.
   */
  async getSuscripcionActual() {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) return null;

    const { data, error } = await _cliente
      .from('suscripciones')
      .select('*')
      .eq('abogado_id', user.id)
      .eq('estado', 'ACTIVA')
      .order('fecha_vencimiento', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[api.suscripciones.getSuscripcionActual]', error.message);
      return null;
    }
    return data;
  },

  /**
   * Retorna el historial completo de suscripciones (activas, vencidas, canceladas).
   * Ordenadas por fecha_inicio DESC.
   * Útil para mostrar el historial de pagos en el panel del abogado.
   */
  async getHistorialSuscripciones() {},

};


// ════════════════════════════════════════════════════════════
// RESEÑAS
// Sistema de reseñas verificadas por solicitud completada.
// ════════════════════════════════════════════════════════════
export const resenas = {

  /**
   * Crea una reseña para una solicitud en estado COMPLETADA o RESEÑADA.
   * La política RLS de INSERT verifica que solicitud_id pertenece al cliente
   * autenticado y que está en un estado que permite reseña.
   * abogado_id se obtiene de la propia solicitud (no lo decide el llamador)
   * para que coincida siempre con el abogado_id que exige la política RLS.
   * Después de insertar, transiciona la solicitud a RESEÑADA; el cliente
   * puede hacerlo por la política RLS "cliente_completa_solicitud".
   * datos: { calificacion: 1-5, comentario?: string }
   * Retorna { data, error }.
   */
  async crearResena(solicitudId, datos) {
    const { data: { user }, error: errUser } = await _cliente.auth.getUser();
    if (errUser || !user) {
      return { data: null, error: errUser ?? { message: 'No hay sesión activa.' } };
    }

    const { data: solicitud, error: errSolicitud } = await _cliente
      .from('solicitudes')
      .select('id, abogado_id')
      .eq('id', solicitudId)
      .single();

    if (errSolicitud || !solicitud) {
      console.error('[api.resenas.crearResena]', errSolicitud?.message);
      return { data: null, error: errSolicitud ?? { message: 'No se encontró la solicitud.' } };
    }

    const { data, error } = await _cliente
      .from('resenas')
      .insert({
        solicitud_id: solicitudId,
        cliente_id: user.id,
        abogado_id: solicitud.abogado_id,
        calificacion: datos.calificacion,
        comentario: datos.comentario?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[api.resenas.crearResena]', error.message);
      if (error.code === '23505') {
        return { data: null, error: { message: 'Ya dejó una reseña para esta solicitud.' } };
      }
      return { data: null, error };
    }

    const { error: errEstado } = await _cliente
      .from('solicitudes')
      .update({ estado: 'RESEÑADA' })
      .eq('id', solicitudId)
      .eq('estado', 'COMPLETADA');

    if (errEstado) {
      console.error('[api.resenas.crearResena] No se pudo marcar la solicitud como RESEÑADA:', errEstado.message);
    }

    return { data, error: null };
  },

  /**
   * Retorna las reseñas dejadas por el cliente autenticado, con los datos
   * públicos del abogado reseñado, desde la vista panel_resenas_cliente.
   * Ordenadas por created_at DESC.
   * Retorna array (puede estar vacío).
   */
  async getMisResenas() {
    const { data, error } = await _cliente
      .from('panel_resenas_cliente')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api.resenas.getMisResenas]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * Retorna las reseñas públicas (oculta=false) de un abogado desde la vista
   * resenas_publicas. Incluye calificacion, comentario, created_at,
   * respuesta_abogado y cliente_nombre (para mostrar iniciales del autor).
   * Ordenadas por created_at DESC.
   * Retorna array (puede estar vacío).
   */
  async getResenasAbogado(abogadoId) {
    const { data, error } = await _cliente
      .from('resenas_publicas')
      .select('*')
      .eq('abogado_id', abogadoId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api.resenas.getResenasAbogado]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * El abogado autenticado agrega o edita su respuesta pública a una reseña.
   * La política RLS verifica que el abogado es el dueño de la reseña
   * y que no puede modificar calificación ni comentario del cliente.
   * Retorna { data, error }.
   */
  async responderResena(resenaId, respuesta) {},

};


// ════════════════════════════════════════════════════════════
// ADMIN
// Verificaciones, suscripciones y métricas del panel de administración.
// Toda función aquí depende de es_admin() en la vista/función de la BD;
// un usuario sin rol='admin' recibe una lista vacía o un error de RPC.
// ════════════════════════════════════════════════════════════
export const admin = {

  /**
   * Retorna la cola de verificaciones pendientes desde la vista
   * admin_verificaciones_pendientes, ordenadas por antigüedad (más antigua primero).
   * Incluye tipo ('abogado' | 'estudio'), nombre_solicitante, nombre_estudio
   * y los paths de los documentos subidos.
   * Retorna array (puede estar vacío).
   */
  async getVerificacionesPendientes() {
    const { data, error } = await _cliente
      .from('admin_verificaciones_pendientes')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[api.admin.getVerificacionesPendientes]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * Aprueba una verificación en estado PENDIENTE.
   * El trigger fn_propagar_estado_verificacion copia el nuevo estado
   * a abogados.verificacion o estudios.verificacion.
   * Retorna { data, error }.
   */
  async aprobarVerificacion(verificacionId) {
    const { data, error } = await _cliente
      .from('verificaciones')
      .update({ estado: 'VERIFICADO' })
      .eq('id', verificacionId)
      .eq('estado', 'PENDIENTE')
      .select()
      .single();

    if (error) {
      console.error('[api.admin.aprobarVerificacion]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Rechaza una verificación en estado PENDIENTE con un motivo visible
   * para el solicitante.
   * Retorna { data, error }.
   */
  async rechazarVerificacion(verificacionId, motivo) {
    const { data, error } = await _cliente
      .from('verificaciones')
      .update({ estado: 'RECHAZADO', motivo_rechazo: motivo.trim() || null })
      .eq('id', verificacionId)
      .eq('estado', 'PENDIENTE')
      .select()
      .single();

    if (error) {
      console.error('[api.admin.rechazarVerificacion]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Retorna todas las suscripciones desde la vista admin_suscripciones,
   * con el nombre del abogado/estudio ya resuelto, ordenadas por
   * fecha de vencimiento descendente (las más recientes primero).
   * Retorna array (puede estar vacío).
   */
  async getSuscripciones() {
    const { data, error } = await _cliente
      .from('admin_suscripciones')
      .select('*')
      .order('fecha_vencimiento', { ascending: false });

    if (error) {
      console.error('[api.admin.getSuscripciones]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * Retorna las métricas agregadas del panel: total_abogados_verificados,
   * total_clientes, total_solicitudes_mes y tasa_aceptacion.
   * Llama a la función RPC admin_obtener_metricas(), que lanza un error
   * si quien la ejecuta no tiene rol='admin'.
   * Retorna null si falla la consulta.
   */
  async getMetricas() {
    const { data, error } = await _cliente.rpc('admin_obtener_metricas');

    if (error) {
      console.error('[api.admin.getMetricas]', error.message);
      return null;
    }
    return data?.[0] ?? null;
  },

  /**
   * Retorna el historial de acciones del admin (aprobar/rechazar verificaciones)
   * desde la vista admin_log_detalle, con el nombre del admin y del abogado/estudio
   * afectado ya resueltos. Ordenadas por fecha descendente (más reciente primero).
   * La tabla admin_log solo se completa desde el trigger fn_propagar_estado_verificacion
   * (migración 024) — nunca se inserta desde el frontend.
   * Retorna array (puede estar vacío).
   */
  async getLogAcciones() {
    const { data, error } = await _cliente
      .from('admin_log_detalle')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api.admin.getLogAcciones]', error.message);
      return [];
    }
    return data ?? [];
  },

};


// ════════════════════════════════════════════════════════════
// NOTIFICACIONES
// Notificaciones internas del usuario autenticado (CLAUDE.md módulo 5).
// Se insertan únicamente desde triggers de la BD (fn_notificar_*); el
// frontend solo lee, marca como leídas y escucha nuevas vía Realtime.
// ════════════════════════════════════════════════════════════
export const notificaciones = {

  /**
   * Retorna las notificaciones no leídas del usuario autenticado,
   * más recientes primero. Tope de 30 para el dropdown del panel.
   * Retorna array (puede estar vacío).
   */
  async getNoLeidas() {
    const { data, error } = await _cliente
      .from('notificaciones')
      .select('*')
      .eq('leida', false)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('[api.notificaciones.getNoLeidas]', error.message);
      return [];
    }
    return data ?? [];
  },

  /**
   * Marca una notificación propia como leída.
   * Retorna { data, error }.
   */
  async marcarLeida(id) {
    const { data, error } = await _cliente
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[api.notificaciones.marcarLeida]', error.message);
      return { data: null, error };
    }
    return { data, error: null };
  },

  /**
   * Marca todas las notificaciones no leídas del usuario autenticado como leídas.
   * Retorna { error }.
   */
  async marcarTodasLeidas() {
    const { error } = await _cliente
      .from('notificaciones')
      .update({ leida: true })
      .eq('leida', false);

    if (error) {
      console.error('[api.notificaciones.marcarTodasLeidas]', error.message);
    }
    return { error };
  },

  /**
   * Se suscribe vía Supabase Realtime a nuevas notificaciones (INSERT).
   * El RLS de la tabla ya restringe el stream a las filas del usuario
   * autenticado, así que no hace falta filtrar por usuario_id acá.
   * callback recibe la fila insertada.
   * Retorna el canal (pasar a dejarDeEscuchar() para cancelar la suscripción).
   */
  escucharNuevas(callback) {
    return _cliente
      .channel('notificaciones-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, (payload) => {
        callback(payload.new);
      })
      .subscribe();
  },

  /**
   * Cancela la suscripción de Realtime creada por escucharNuevas().
   */
  dejarDeEscuchar(canal) {
    if (canal) _cliente.removeChannel(canal);
  },

};


// ════════════════════════════════════════════════════════════
// STORAGE
// Utilidades para Supabase Storage (URLs públicas de archivos).
// El bucket debe ser público (configurado en Supabase Dashboard → Storage).
// ════════════════════════════════════════════════════════════
export const storage = {

  /**
   * Genera la URL pública de un archivo almacenado en Supabase Storage.
   * path: valor de foto_url / logo_url tal como está en la BD (path relativo).
   * bucket: nombre de un bucket público ('avatares', 'logos').
   * NO usar con 'verificacion-docs' — ese bucket es privado (ver getUrlFirmada).
   * Retorna string con la URL completa o null si path es falsy.
   */
  getPublicUrl(bucket, path) {
    if (!_cliente || !path) return null;
    const { data } = _cliente.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl ?? null;
  },

  /**
   * Genera una URL firmada de corta duración para un archivo en un bucket
   * privado ('verificacion-docs'). Solo funciona si la política RLS de
   * Storage autoriza al usuario autenticado a leer ese path (el propio
   * abogado/estudio dueño del documento, o el admin).
   * expiraEnSegundos: vigencia del link (default 5 minutos).
   * Retorna string con la URL firmada o null si falla o path es falsy.
   */
  async getUrlFirmada(bucket, path, expiraEnSegundos = 300) {
    if (!_cliente || !path) return null;
    const { data, error } = await _cliente.storage.from(bucket).createSignedUrl(path, expiraEnSegundos);

    if (error) {
      console.error('[api.storage.getUrlFirmada]', error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  },

};
