// Panel principal: muestra los datos del usuario tomados de su JWT
const mensaje = document.getElementById('mensaje');

// Nombres legibles de los grupos de Cognito
const ROLES = {
  Administrador: 'Administrador',
  GerenteTienda: 'Gerente de Tienda',
  EmpleadoVentas: 'Empleado de Ventas',
  Auditor: 'Auditor',
};

const fecha = (segundos) => new Date(segundos * 1000).toLocaleString('es-PE');
const poner = (id, texto) => (document.getElementById(id).textContent = texto);

async function cargarSesion() {
  // El navegador envía solo la cookie httpOnly; el servidor verifica el JWT
  const { ok, datos } = await getJSON('/api/auth/sesion');
  if (!ok) return location.replace('/login.html');

  const u = datos.usuario;
  const tiendas = (await getJSON('/api/tiendas')).datos || [];
  const tienda = tiendas.find((t) => t.id === u.tienda);

  poner('saludo', `Hola, ${u.nombre || u.email}`);
  poner('rol', u.grupos.map((g) => ROLES[g] || g).join(', ') || 'Sin rol');
  poner('tienda', tienda ? tienda.nombre : 'Sin tienda');
  poner('dato-email', u.email);
  poner('dato-grupos', u.grupos.join(', ') || '(ninguno)');
  poner('dato-tienda', u.tienda || '(sin asignar)');
  poner('dato-emitido', fecha(u.emitido));
  poner('dato-expira', fecha(u.expira));
  poner('token-vista', datos.token.vista);
  poner('token-longitud', `${datos.token.longitud} caracteres · guardado en cookie httpOnly`);
}

document.getElementById('cerrar-sesion').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  await postJSON('/api/auth/logout', {});
  mostrarMensaje(mensaje, 'Sesión cerrada.', 'ok');
  setTimeout(() => location.replace('/login.html'), 800);
});

cargarSesion();
