// Funciones compartidas por todas las páginas

// Envía un POST con JSON al servidor y devuelve { ok, status, datos }
async function postJSON(url, cuerpo) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const datos = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, datos };
}

// Muestra un mensaje verde (ok), ámbar (aviso) o rojo (error) dentro del elemento indicado
function mostrarMensaje(elemento, texto, tipo = 'error') {
  elemento.textContent = texto;
  elemento.className = `msg ${tipo}`;
  elemento.hidden = false;
}

// Dibuja el contador visible de intentos: "X de N" y una barra con un segmento por intento.
// Usa los elementos #contador, #contador-texto, #contador-barra y #contador-ayuda de la página.
// "consecuencia" es lo que pasa al agotar los intentos (ej. "antes del bloqueo").
function pintarContador(intentos, consecuencia = 'antes del bloqueo') {
  const caja = document.getElementById('contador');
  const barra = document.getElementById('contador-barra');
  caja.hidden = intentos.fallidos === 0;
  document.getElementById('contador-texto').textContent = `${intentos.fallidos} de ${intentos.maximo}`;
  barra.innerHTML = '';
  for (let i = 0; i < intentos.maximo; i++) {
    const segmento = document.createElement('span');
    segmento.className = i < intentos.fallidos ? 'segmento usado' : 'segmento';
    barra.appendChild(segmento);
  }
  caja.classList.toggle('critico', intentos.restantes <= 1);
  document.getElementById('contador-ayuda').textContent = intentos.bloqueado
    ? ''
    : intentos.restantes === 1
      ? `Te queda 1 intento ${consecuencia}.`
      : `Te quedan ${intentos.restantes} intentos ${consecuencia}.`;
}

// Envía un GET y devuelve { ok, status, datos }
async function getJSON(url) {
  return pedir('GET', url);
}

// Petición con cualquier método (GET, POST, PUT, PATCH, DELETE) y devuelve { ok, status, datos }
async function pedir(metodo, url, cuerpo) {
  const opciones = { method: metodo, headers: {} };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  const res = await fetch(url, opciones);
  const datos = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, datos };
}

// Crea un elemento HTML de forma segura: el texto va con textContent (nunca innerHTML),
// así un nombre de producto como "<script>" se muestra como texto y no se ejecuta (evita XSS).
// Ej: crear('td', { className: 'num' }, 'S/ 10.00')
function crear(etiqueta, propiedades = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(propiedades)) {
    if (clave === 'dataset') Object.assign(el.dataset, valor);
    else if (clave.startsWith('aria-') || clave === 'role') el.setAttribute(clave, valor);
    else el[clave] = valor;
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

// Crea un icono del sprite: icono('lapiz')
function icono(nombre, clase = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icono ${clase}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/img/iconos.svg#${nombre}`);
  svg.appendChild(use);
  return svg;
}

// Nombres legibles de los roles (grupos de Cognito)
const NOMBRES_ROL = {
  Administrador: 'Administrador',
  GerenteTienda: 'Gerente de Tienda',
  EmpleadoVentas: 'Empleado de Ventas',
  Auditor: 'Auditor',
};

// Formato de moneda peruana: S/ 1,234.50
const formatoSoles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
