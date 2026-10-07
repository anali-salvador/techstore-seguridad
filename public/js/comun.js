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
  const res = await fetch(url);
  const datos = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, datos };
}
