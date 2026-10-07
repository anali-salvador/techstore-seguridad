// Lógica de la página de registro
const form = document.getElementById('form-registro');
const mensaje = document.getElementById('mensaje');
const inputPassword = document.getElementById('password');
const selectTienda = document.getElementById('tienda');

// Mismas reglas que la política de contraseña de Cognito
const ESPECIALES = /[\^$*.[\]{}()?\-"!@#%&/\\,><':;|_~`+=]/;
const REGLAS = {
  largo: (p) => p.length >= 8,
  mayuscula: (p) => /[A-Z]/.test(p),
  numero: (p) => /[0-9]/.test(p),
  especial: (p) => ESPECIALES.test(p),
};

// Marca en verde cada regla que la contraseña ya cumple
function revisarPassword() {
  const p = inputPassword.value;
  let todasOk = true;
  for (const [nombre, cumple] of Object.entries(REGLAS)) {
    const ok = cumple(p);
    document.querySelector(`[data-regla="${nombre}"]`).classList.toggle('ok', ok);
    if (!ok) todasOk = false;
  }
  return todasOk;
}
inputPassword.addEventListener('input', revisarPassword);

// Carga las tiendas desde el servidor
fetch('/api/tiendas')
  .then((r) => r.json())
  .then((tiendas) => {
    for (const t of tiendas) selectTienda.add(new Option(t.nombre, t.id));
  });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(form));

  if (!datos.nombre.trim() || !datos.email.trim() || !datos.tienda) {
    return mostrarMensaje(mensaje, 'Completa todos los campos.');
  }
  if (!revisarPassword()) {
    return mostrarMensaje(mensaje, 'La contraseña no cumple todas las reglas.');
  }

  const boton = form.querySelector('button');
  boton.disabled = true;
  const { ok, datos: resp } = await postJSON('/api/auth/registro', datos);
  boton.disabled = false;

  if (!ok) return mostrarMensaje(mensaje, resp.error || 'No se pudo registrar.');

  mostrarMensaje(mensaje, resp.mensaje, 'ok');
  // Lleva a la página de confirmación con el correo ya escrito
  setTimeout(() => {
    location.href = `/confirmar.html?email=${encodeURIComponent(datos.email.trim())}`;
  }, 1500);
});
