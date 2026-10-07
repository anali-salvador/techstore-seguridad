// Lógica de la página de verificación de cuenta
const form = document.getElementById('form-confirmar');
const mensaje = document.getElementById('mensaje');
const inputEmail = document.getElementById('email');

// Si venimos del registro, el correo llega en la URL (?email=...)
inputEmail.value = new URLSearchParams(location.search).get('email') || '';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(form));
  if (!/^\d{6}$/.test(datos.codigo.trim())) {
    return mostrarMensaje(mensaje, 'El código debe tener 6 dígitos.');
  }

  // Deshabilita el botón mientras espera (muestra el spinner de carga)
  const boton = form.querySelector('button');
  boton.disabled = true;
  const { ok, datos: resp } = await postJSON('/api/auth/confirmar', datos);
  boton.disabled = false;
  if (!ok) return mostrarMensaje(mensaje, resp.error || 'No se pudo verificar.');

  mostrarMensaje(mensaje, resp.mensaje, 'ok');
  setTimeout(() => (location.href = '/login.html'), 1500);
});

document.getElementById('reenviar').addEventListener('click', async (e) => {
  e.preventDefault();
  if (!inputEmail.value.trim()) return mostrarMensaje(mensaje, 'Escribe tu correo primero.');
  const { ok, datos: resp } = await postJSON('/api/auth/reenviar-codigo', { email: inputEmail.value });
  mostrarMensaje(mensaje, ok ? resp.mensaje : resp.error, ok ? 'ok' : 'error');
});
