// Lógica de la página de login (paso 1: correo + contraseña)
const form = document.getElementById('form-login');
const mensaje = document.getElementById('mensaje');
const boton = form.querySelector('button');
const inputPassword = document.getElementById('password');

// Elementos del contador visible de intentos (pintarContador está en comun.js)
const contador = document.getElementById('contador');
const contadorAyuda = document.getElementById('contador-ayuda');
let temporizador = null;

// Activa o desactiva el formulario completo
function habilitarFormulario(habilitado) {
  for (const el of form.elements) el.disabled = !habilitado;
  boton.classList.toggle('bloqueado', !habilitado);
}

// Bloqueo: deshabilita el formulario y muestra una cuenta regresiva
function bloquear(segundos) {
  habilitarFormulario(false);
  const fin = Date.now() + segundos * 1000;
  const actualizar = () => {
    const restante = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
    const mm = String(Math.floor(restante / 60)).padStart(2, '0');
    const ss = String(restante % 60).padStart(2, '0');
    contadorAyuda.textContent = `Podrás intentarlo de nuevo en ${mm}:${ss}.`;
    if (restante === 0) desbloquear();
  };
  actualizar();
  temporizador = setInterval(actualizar, 1000);
}

function desbloquear() {
  clearInterval(temporizador);
  habilitarFormulario(true);
  contador.hidden = true;
  mensaje.hidden = true;
}

// Errores del login social: el servidor solo manda un código, nunca el detalle técnico
const ERRORES_SOCIALES = {
  social: 'No se pudo iniciar sesión con el proveedor externo. Inténtalo de nuevo.',
  correo: 'Tu cuenta de GitHub no tiene un correo verificado. Verifica uno en GitHub e inténtalo de nuevo.',
  vinculo: 'No se pudo vincular tu cuenta: el correo debe estar verificado en ambas cuentas.',
  bloqueado: 'La verificación en dos pasos está bloqueada temporalmente por códigos incorrectos.',
  deshabilitado: 'Tu cuenta está deshabilitada. Contacta al administrador.',
};
const errorSocial = new URLSearchParams(location.search).get('error');
if (ERRORES_SOCIALES[errorSocial]) {
  mostrarMensaje(mensaje, ERRORES_SOCIALES[errorSocial]);
  history.replaceState(null, '', '/login.html'); // limpia la URL
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(form));
  if (!datos.email.trim() || !datos.password) {
    return mostrarMensaje(mensaje, 'Ingresa tu correo y contraseña.');
  }

  boton.disabled = true;
  const { ok, status, datos: resp } = await postJSON('/api/auth/login', datos);
  boton.disabled = false;

  // Credenciales correctas: Cognito pide el MFA (aún no hay JWT)
  if (ok) {
    contador.hidden = true;
    mostrarMensaje(mensaje, resp.mensaje, 'ok');
    habilitarFormulario(false);
    // Primer login -> mfa-configurar.html | logins siguientes -> mfa-codigo.html
    setTimeout(() => (location.href = resp.siguiente), 900);
    return;
  }

  if (resp.intentos) pintarContador(resp.intentos);

  // 423 = cuenta bloqueada
  if (status === 423) {
    mostrarMensaje(mensaje, resp.error);
    if (resp.intentos && resp.intentos.segundosBloqueo > 0) {
      contador.hidden = false; // también se muestra si el bloqueo vino del MFA
      bloquear(resp.intentos.segundosBloqueo);
    }
    return;
  }

  // Cuenta sin verificar: lleva a la página del código de correo
  if (resp.siguiente) {
    mostrarMensaje(mensaje, resp.error, 'aviso');
    setTimeout(() => (location.href = resp.siguiente), 2000);
    return;
  }

  // Último intento antes del bloqueo: aviso en ámbar
  const tipo = resp.intentos && resp.intentos.restantes === 1 ? 'aviso' : 'error';
  mostrarMensaje(mensaje, resp.error || 'No se pudo iniciar sesión.', tipo);
  inputPassword.value = '';
  inputPassword.focus();
});
