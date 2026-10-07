// Lógica de la página de login (paso 1: correo + contraseña)
const form = document.getElementById('form-login');
const mensaje = document.getElementById('mensaje');
const boton = form.querySelector('button');
const inputPassword = document.getElementById('password');

// Elementos del contador visible de intentos
const contador = document.getElementById('contador');
const contadorTexto = document.getElementById('contador-texto');
const contadorBarra = document.getElementById('contador-barra');
const contadorAyuda = document.getElementById('contador-ayuda');
let temporizador = null;

// Dibuja "X de 5" y una barra con un segmento por intento
function pintarContador(intentos) {
  contador.hidden = intentos.fallidos === 0;
  contadorTexto.textContent = `${intentos.fallidos} de ${intentos.maximo}`;
  contadorBarra.innerHTML = '';
  for (let i = 0; i < intentos.maximo; i++) {
    const segmento = document.createElement('span');
    segmento.className = i < intentos.fallidos ? 'segmento usado' : 'segmento';
    contadorBarra.appendChild(segmento);
  }
  contador.classList.toggle('critico', intentos.restantes <= 1);
  contadorAyuda.textContent = intentos.bloqueado
    ? ''
    : intentos.restantes === 1
      ? 'Te queda 1 intento antes del bloqueo.'
      : `Te quedan ${intentos.restantes} intentos antes del bloqueo.`;
}

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
    // Fase 4: aquí se redirige a resp.siguiente (configurar TOTP o ingresar el código)
    return;
  }

  if (resp.intentos) pintarContador(resp.intentos);

  // 423 = cuenta bloqueada
  if (status === 423) {
    mostrarMensaje(mensaje, resp.error);
    if (resp.intentos && resp.intentos.segundosBloqueo > 0) bloquear(resp.intentos.segundosBloqueo);
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
