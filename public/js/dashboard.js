// Panel principal: perfil (JWT), inventario, reportes y prueba de permisos.
// IMPORTANTE: ocultar botones aquí es solo comodidad visual. La seguridad real
// está en el servidor (middleware), que responde 403 aunque se llame a la API a mano.
const mensaje = document.getElementById('mensaje');
const mensajeInventario = document.getElementById('mensaje-inventario');
const tbody = document.getElementById('tabla-productos');
const inputBuscar = document.getElementById('buscar');
const filtroTienda = document.getElementById('filtro-tienda');

let usuario = null; // datos del JWT + rol, alcance y permisos
let tiendas = []; // [{ id, nombre }]
let productos = []; // inventario cargado
let productoEnEdicion = null; // null = creando uno nuevo

const puede = (accion) => usuario.permisos.includes(accion);
const nombreTienda = (id) => (tiendas.find((t) => t.id === id) || {}).nombre || id || '—';
const fecha = (segundos) => new Date(segundos * 1000).toLocaleString('es-PE');
const poner = (id, texto) => (document.getElementById(id).textContent = texto);

// Lista de permisos que se muestran en el perfil
const ACCIONES = [
  ['productos:ver', 'Ver productos'],
  ['productos:crear', 'Crear productos'],
  ['productos:editar', 'Editar productos'],
  ['productos:precio', 'Modificar precios'],
  ['productos:stock', 'Actualizar stock'],
  ['productos:eliminar', 'Eliminar productos'],
  ['reportes:ver', 'Ver reportes'],
  ['usuarios:gestionar', 'Gestionar usuarios'],
];

// ---------- 1. Perfil ----------
async function cargarSesion() {
  const { ok, datos } = await getJSON('/api/auth/sesion');
  if (!ok) return false;
  usuario = datos.usuario;
  tiendas = (await getJSON('/api/tiendas')).datos || [];

  poner('saludo', `Hola, ${usuario.nombre || usuario.email}`);
  poner('rol', NOMBRES_ROL[usuario.rol] || 'Sin rol asignado');
  poner('tienda', usuario.tienda ? nombreTienda(usuario.tienda) : 'Sin tienda');
  poner('dato-email', usuario.email);
  poner('dato-grupos', usuario.grupos.join(', ') || '(ninguno)');
  poner('dato-tienda', usuario.tienda || '(sin asignar)');
  poner('dato-emitido', fecha(usuario.emitido));
  poner('dato-expira', fecha(usuario.expira));
  poner('token-vista', datos.token.vista);
  poner('token-longitud', `${datos.token.longitud} caracteres · guardado en cookie httpOnly`);
  poner(
    'alcance',
    usuario.alcance === 'todas' ? '· todas las tiendas' : usuario.alcance === 'propia' ? '· solo tu tienda' : ''
  );

  // Permisos con ✓ o ✗
  const lista = document.getElementById('lista-permisos');
  for (const [accion, texto] of ACCIONES) {
    const si = puede(accion);
    lista.append(
      crear('li', { className: si ? 'permiso si' : 'permiso no' }, icono(si ? 'check' : 'cerrar'), texto)
    );
  }

  document.getElementById('enlace-admin').hidden = !puede('usuarios:gestionar');
  return true;
}

// ---------- 2. Inventario ----------
async function cargarProductos() {
  if (!puede('productos:ver')) {
    document.getElementById('seccion-inventario').hidden = true;
    return;
  }
  const filtro = filtroTienda.value ? `?tienda=${encodeURIComponent(filtroTienda.value)}` : '';
  const { ok, datos } = await getJSON(`/api/productos${filtro}`);
  if (!ok) return mostrarMensaje(mensajeInventario, datos.error || 'No se pudo cargar el inventario.');
  mensajeInventario.hidden = true;
  productos = datos.sort((a, b) => a.tienda.localeCompare(b.tienda) || a.nombre.localeCompare(b.nombre));
  pintarProductos();
}

function pintarProductos() {
  const texto = inputBuscar.value.trim().toLowerCase();
  const visibles = productos.filter(
    (p) => !texto || p.nombre.toLowerCase().includes(texto) || p.categoria.toLowerCase().includes(texto)
  );
  tbody.replaceChildren(...visibles.map(filaProducto));
  document.getElementById('inventario-vacio').hidden = visibles.length > 0;
}

// Una fila de la tabla: los botones dependen de los permisos del rol
function filaProducto(p) {
  const acciones = crear('div', { className: 'acciones-fila' });

  if (puede('productos:editar')) {
    acciones.append(
      crear('button', { type: 'button', className: 'btn-icono', title: 'Editar', 'aria-label': `Editar ${p.nombre}`, onclick: () => abrirFormulario(p) }, icono('lapiz'))
    );
  } else if (puede('productos:stock')) {
    // Empleado de Ventas: solo puede cambiar el stock
    const input = crear('input', { type: 'number', min: 0, step: 1, value: p.stock, className: 'input-pequeno', 'aria-label': `Stock de ${p.nombre}` });
    acciones.append(
      input,
      crear('button', { type: 'button', className: 'btn-icono', title: 'Guardar stock', 'aria-label': `Guardar stock de ${p.nombre}`, onclick: (e) => guardarStock(p, input, e.currentTarget) }, icono('check'))
    );
  }
  if (puede('productos:eliminar')) {
    acciones.append(
      crear('button', { type: 'button', className: 'btn-icono btn-icono--peligro', title: 'Eliminar', 'aria-label': `Eliminar ${p.nombre}`, onclick: () => confirmarEliminar(p) }, icono('basura'))
    );
  }
  if (!acciones.children.length) acciones.append(crear('span', { className: 'nota-en-linea' }, 'Solo lectura'));

  // Si el rol no puede cambiar precios, se muestra un candado junto al precio
  const precio = crear('td', { className: 'num' }, formatoSoles.format(p.precio || 0));
  if (!puede('productos:precio')) {
    precio.prepend(crear('span', { className: 'candado', title: 'Tu rol no puede modificar precios' }, icono('candado')));
  }

  return crear(
    'tr',
    {},
    crear('td', {}, crear('strong', {}, p.nombre)),
    crear('td', {}, p.categoria),
    crear('td', {}, nombreTienda(p.tienda)),
    precio,
    crear('td', { className: 'num' }, crear('span', { className: p.stock < 5 ? 'insignia insignia--bajo' : 'insignia' }, p.stock)),
    crear('td', { className: 'col-acciones' }, acciones)
  );
}

// Empleado de Ventas: PATCH solo del stock
async function guardarStock(p, input, boton) {
  boton.disabled = true;
  const { ok, datos } = await pedir('PATCH', `/api/productos/${p.tienda}/${p.productoId}/stock`, { stock: Number(input.value) });
  boton.disabled = false;
  if (!ok) return mostrarMensaje(mensajeInventario, datos.error || 'No se pudo actualizar el stock.');
  mostrarMensaje(mensajeInventario, `Stock de "${p.nombre}" actualizado a ${datos.stock}.`, 'ok');
  await cargarProductos();
}

// ---------- Diálogo de producto (crear / editar) ----------
const dialogoProducto = document.getElementById('dialogo-producto');
const formProducto = document.getElementById('form-producto');
const mensajeProducto = document.getElementById('mensaje-producto');

function abrirFormulario(p = null) {
  productoEnEdicion = p;
  formProducto.reset();
  mensajeProducto.hidden = true;
  poner('dialogo-producto-titulo', p ? 'Editar producto' : 'Nuevo producto');

  // La tienda solo se elige al crear y si el rol trabaja con todas las tiendas
  const selectTienda = document.getElementById('p-tienda');
  document.getElementById('p-tienda-campo').hidden = Boolean(p) || usuario.alcance !== 'todas';
  selectTienda.value = usuario.tienda || (tiendas[0] || {}).id;

  if (p) {
    formProducto.nombre.value = p.nombre;
    formProducto.categoria.value = p.categoria;
    formProducto.precio.value = p.precio;
    formProducto.stock.value = p.stock;
  }
  // Si el rol no puede cambiar precios, el campo queda bloqueado
  formProducto.precio.disabled = !puede('productos:precio');
  dialogoProducto.showModal();
  formProducto.nombre.focus();
}

formProducto.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(formProducto));
  const boton = formProducto.querySelector('button[type="submit"]');
  boton.disabled = true;
  const respuesta = productoEnEdicion
    ? await pedir('PUT', `/api/productos/${productoEnEdicion.tienda}/${productoEnEdicion.productoId}`, datos)
    : await pedir('POST', '/api/productos', datos);
  boton.disabled = false;

  if (!respuesta.ok) return mostrarMensaje(mensajeProducto, respuesta.datos.error || 'No se pudo guardar.');
  dialogoProducto.close();
  mostrarMensaje(mensajeInventario, productoEnEdicion ? 'Producto actualizado.' : 'Producto creado.', 'ok');
  await Promise.all([cargarProductos(), cargarReporte()]);
});

// ---------- Diálogo de eliminar ----------
const dialogoEliminar = document.getElementById('dialogo-eliminar');
let productoAEliminar = null;

function confirmarEliminar(p) {
  productoAEliminar = p;
  poner('eliminar-nombre', p.nombre);
  dialogoEliminar.showModal();
}

document.getElementById('confirmar-eliminar').addEventListener('click', async (e) => {
  const boton = e.currentTarget;
  boton.disabled = true;
  const p = productoAEliminar;
  const { ok, datos } = await pedir('DELETE', `/api/productos/${p.tienda}/${p.productoId}`);
  boton.disabled = false;
  dialogoEliminar.close();
  if (!ok) return mostrarMensaje(mensajeInventario, datos.error || 'No se pudo eliminar.');
  mostrarMensaje(mensajeInventario, `"${p.nombre}" fue eliminado.`, 'ok');
  await Promise.all([cargarProductos(), cargarReporte()]);
});

// Botones "Cancelar" / "X" de los diálogos
for (const boton of document.querySelectorAll('[data-cerrar]')) {
  boton.addEventListener('click', () => boton.closest('dialog').close());
}

// ---------- 3. Reportes ----------
async function cargarReporte() {
  if (!puede('reportes:ver')) return;
  document.getElementById('seccion-reportes').hidden = false;
  const { ok, datos } = await getJSON('/api/reportes');
  if (!ok) return;

  const t = datos.totales;
  const tarjeta = (titulo, valor, extra = '') =>
    crear('div', { className: `estadistica ${extra}` }, crear('span', {}, titulo), crear('strong', {}, valor));
  document.getElementById('estadisticas').replaceChildren(
    tarjeta('Productos', t.productos),
    tarjeta('Unidades en stock', t.unidades),
    tarjeta('Valor del inventario', formatoSoles.format(t.valor)),
    tarjeta(`Stock bajo (< ${datos.umbralStockBajo})`, t.stockBajo, t.stockBajo ? 'estadistica--alerta' : '')
  );
  document.getElementById('tabla-reporte').replaceChildren(
    ...datos.tiendas.map((r) =>
      crear(
        'tr',
        {},
        crear('td', {}, crear('strong', {}, r.nombre)),
        crear('td', { className: 'num' }, r.productos),
        crear('td', { className: 'num' }, r.unidades),
        crear('td', { className: 'num' }, formatoSoles.format(r.valor)),
        crear('td', {}, r.stockBajo.length ? r.stockBajo.map((p) => `${p.nombre} (${p.stock})`).join(', ') : '—')
      )
    )
  );
  poner('reporte-pie', `Generado el ${new Date(datos.generado).toLocaleString('es-PE')} por ${datos.generadoPor}.`);
}

// ---------- 4. Prueba de permisos ----------
// Para cada acción PROHIBIDA, un botón llama a la API real. Se usa un producto
// inexistente ("prueba-inexistente"): aunque hubiera un error de permisos, nada se borraría.
function cargarPruebas() {
  const miTienda = usuario.tienda || 'lima-centro';
  const otraTienda = (tiendas.find((t) => t.id !== usuario.tienda) || {}).id;
  const base = `/api/productos/${miTienda}/prueba-inexistente`;

  const pruebas = [
    ['productos:crear', 'Crear un producto', 'POST', '/api/productos', { tienda: miTienda }],
    ['productos:precio', 'Modificar un precio', 'PUT', base, { precio: 1 }],
    ['productos:stock', 'Actualizar stock', 'PATCH', `${base}/stock`, { stock: 1 }],
    ['productos:eliminar', 'Eliminar un producto', 'DELETE', base],
    ['reportes:ver', 'Ver reportes', 'GET', '/api/reportes'],
    ['usuarios:gestionar', 'Listar usuarios (panel de administrador)', 'GET', '/api/admin/usuarios'],
  ].filter(([accion]) => !puede(accion));

  // El Empleado puede actualizar stock, pero no colar un precio por esa ruta
  if (puede('productos:stock') && !puede('productos:precio')) {
    pruebas.push(['', 'Cambiar el precio por la ruta de stock', 'PATCH', `${base}/stock`, { stock: 1, precio: 1 }]);
  }
  // Roles con alcance "propia": intentar ver otra tienda
  if (usuario.alcance === 'propia' && otraTienda) {
    pruebas.push(['', `Ver productos de ${nombreTienda(otraTienda)}`, 'GET', `/api/productos?tienda=${otraTienda}`]);
  }

  if (!pruebas.length) return;
  document.getElementById('seccion-pruebas').hidden = false;
  document.getElementById('lista-pruebas').replaceChildren(
    ...pruebas.map(([, texto, metodo, url, cuerpo]) => {
      const resultado = crear('span', { className: 'prueba-resultado' });
      const boton = crear('button', { type: 'button', className: 'btn btn-secundario btn-pequeno' }, 'Intentar');
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        const r = await pedir(metodo, url, cuerpo);
        boton.disabled = false;
        resultado.className = `prueba-resultado ${r.status === 403 ? 'bloqueado' : 'permitido'}`;
        resultado.textContent = `HTTP ${r.status} · ${r.datos.error || r.datos.mensaje || 'OK'}`;
      });
      return crear(
        'li',
        {},
        crear('div', { className: 'prueba-texto' }, crear('strong', {}, texto), crear('code', {}, `${metodo} ${url}`)),
        boton,
        resultado
      );
    })
  );
}

// ---------- Eventos generales ----------
inputBuscar.addEventListener('input', pintarProductos);
filtroTienda.addEventListener('change', cargarProductos);
document.getElementById('nuevo-producto').addEventListener('click', () => abrirFormulario());
document.getElementById('generar-reporte').addEventListener('click', cargarReporte);

document.getElementById('cerrar-sesion').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  await postJSON('/api/auth/logout', {});
  mostrarMensaje(mensaje, 'Sesión cerrada.', 'ok');
  setTimeout(() => location.replace('/login.html'), 800);
});

// ---------- Inicio ----------
(async () => {
  if (!(await cargarSesion())) return location.replace('/login.html');

  // Selects de tienda: filtro (roles con todas las tiendas) y formulario
  for (const t of tiendas) {
    filtroTienda.add(new Option(t.nombre, t.id));
    document.getElementById('p-tienda').add(new Option(t.nombre, t.id));
  }
  document.getElementById('filtro-tienda-caja').hidden = usuario.alcance !== 'todas';
  document.getElementById('nuevo-producto').hidden = !puede('productos:crear');

  if (!usuario.rol) {
    mostrarMensaje(mensaje, 'Tu cuenta aún no tiene un rol asignado. Pide a un administrador que te asigne uno.', 'aviso');
  }
  await Promise.all([cargarProductos(), cargarReporte()]);
  cargarPruebas();
})();
