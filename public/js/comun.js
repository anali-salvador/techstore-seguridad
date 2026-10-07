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

// Muestra un mensaje verde (ok) o rojo (error) dentro del elemento indicado
function mostrarMensaje(elemento, texto, tipo = 'error') {
  elemento.textContent = texto;
  elemento.className = `msg ${tipo}`;
  elemento.hidden = false;
}
