// Panel del Administrador: lista usuarios y permite cambiar rol, tienda y estado.
// El servidor vuelve a comprobar que quien llama es Administrador (403 si no lo es).
const mensaje = document.getElementById('mensaje');
const tbody = document.getElementById('tabla-usuarios');
let tiendas = [];

const ESTADOS = {
  CONFIRMED: 'Confirmado',
  UNCONFIRMED: 'Sin verificar',
  EXTERNAL_PROVIDER: 'Login social',
  FORCE_CHANGE_PASSWORD: 'Cambio de contraseña',
  RESET_REQUIRED: 'Restablecer contraseña',
};

// Crea un <select> con opciones [valor, texto]
function selectCon(opciones, seleccionado, etiqueta) {
  const s = crear('select', { className: 'select-pequeno', 'aria-label': etiqueta });
  for (const [valor, texto] of opciones) s.add(new Option(texto, valor, false, valor === seleccionado));
  return s;
}

function filaUsuario(u, yo, roles) {
  const esYo = u.username === yo;
  const selectRol = selectCon([['', '— Sin rol —'], ...roles.map((r) => [r, NOMBRES_ROL[r] || r])], u.rol || '', `Rol de ${u.email}`);
  const selectTienda = selectCon([['', '— Sin tienda —'], ...tiendas.map((t) => [t.id, t.nombre])], u.tienda || '', `Tienda de ${u.email}`);

  const guardar = crear('button', { type: 'button', className: 'btn btn-primario btn-pequeno' }, icono('check'), 'Guardar');
  const estado = crear(
    'button',
    { type: 'button', className: 'btn btn-secundario btn-pequeno' },
    u.habilitado ? 'Deshabilitar' : 'Habilitar'
  );

  // Un administrador no puede cambiarse el rol ni deshabilitarse a sí mismo
  if (esYo) selectRol.disabled = selectTienda.disabled = guardar.disabled = estado.disabled = true;

  guardar.addEventListener('click', async () => {
    if (!selectRol.value) return mostrarMensaje(mensaje, 'Selecciona un rol.');
    guardar.disabled = true;
    const { ok, datos } = await pedir('PUT', `/api/admin/usuarios/${encodeURIComponent(u.username)}`, {
      rol: selectRol.value,
      tienda: selectTienda.value || undefined,
    });
    guardar.disabled = false;
    mostrarMensaje(mensaje, ok ? `${u.email}: ${datos.mensaje}` : datos.error, ok ? 'ok' : 'error');
    if (ok) cargarUsuarios();
  });

  estado.addEventListener('click', async () => {
    estado.disabled = true;
    const { ok, datos } = await pedir('PATCH', `/api/admin/usuarios/${encodeURIComponent(u.username)}/estado`, {
      habilitado: !u.habilitado,
    });
    estado.disabled = false;
    mostrarMensaje(mensaje, ok ? `${u.email}: ${datos.mensaje}` : datos.error, ok ? 'ok' : 'error');
    if (ok) cargarUsuarios();
  });

  return crear(
    'tr',
    { className: u.habilitado ? '' : 'fila-apagada' },
    crear(
      'td',
      {},
      crear('strong', {}, u.nombre || '(sin nombre)', esYo ? crear('span', { className: 'insignia insignia--yo' }, 'Tú') : null),
      crear('div', { className: 'nota-en-linea' }, u.email || u.username)
    ),
    crear(
      'td',
      {},
      crear('span', { className: u.habilitado ? 'insignia' : 'insignia insignia--bajo' }, u.habilitado ? 'Habilitado' : 'Deshabilitado'),
      crear('div', { className: 'nota-en-linea' }, ESTADOS[u.estado] || u.estado)
    ),
    crear('td', {}, selectRol),
    crear('td', {}, selectTienda),
    crear('td', { className: 'col-acciones' }, crear('div', { className: 'acciones-fila' }, guardar, estado))
  );
}

async function cargarUsuarios() {
  const { ok, status, datos } = await getJSON('/api/admin/usuarios');
  if (status === 401) return location.replace('/login.html');
  if (!ok) {
    // 403: el usuario no es Administrador
    mostrarMensaje(mensaje, datos.error || 'No se pudo cargar la lista de usuarios.');
    return setTimeout(() => location.replace('/dashboard.html'), 2500);
  }
  const usuarios = datos.usuarios.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  tbody.replaceChildren(...usuarios.map((u) => filaUsuario(u, datos.yo, datos.roles)));
  document.getElementById('usuarios-vacio').hidden = usuarios.length > 0;
}

(async () => {
  tiendas = (await getJSON('/api/tiendas')).datos || [];
  await cargarUsuarios();
})();
