// Lógica compartida de las dos páginas MFA:
// - mfa-configurar.html: primer login, muestra el QR y activa el TOTP
// - mfa-codigo.html: logins siguientes, solo pide el código de 6 dígitos
const form = document.getElementById('form-mfa');
const mensaje = document.getElementById('mensaje');
const boton = form.querySelector('button[type="submit"]');
const inputCodigo = document.getElementById('codigo');

const esConfiguracion = document.body.dataset.pagina === 'mfa-configurar';
const RUTA_VERIFICAR = esConfiguracion ? '/api/mfa/configurar/verificar' : '/api/mfa/verificar';
const CONSECUENCIA = 'antes de cancelar el inicio de sesión';

const irA = (url, ms = 2000) => setTimeout(() => (location.href = url), ms);

function habilitarFormulario(habilitado) {
  for (const el of form.elements) el.disabled = !habilitado;
  boton.classList.toggle('bloqueado', !habilitado);
}

// Al abrir la página: comprueba que haya un login pendiente de MFA
async function iniciar() {
  const { ok, datos } = await getJSON('/api/mfa/estado');
  if (!ok) {
    habilitarFormulario(false);
    mostrarMensaje(mensaje, datos.error || 'Primero inicia sesión.', 'aviso');
    return irA(datos.siguiente || '/login.html');
  }

  // Si el usuario abrió la página equivocada, lo lleva a la correcta
  const paginaCorrecta = datos.reto === 'MFA_SETUP' ? '/mfa-configurar.html' : '/mfa-codigo.html';
  if (location.pathname !== paginaCorrecta) return location.replace(paginaCorrecta);

  document.getElementById('email-usuario').textContent = datos.email;
  pintarContador(datos.intentos, CONSECUENCIA);
  if (esConfiguracion) await cargarQr();
  inputCodigo.focus();
}

// Pide al servidor la clave TOTP (AssociateSoftwareToken) y muestra el QR
async function cargarQr() {
  const { ok, datos } = await postJSON('/api/mfa/configurar/iniciar', {});
  if (!ok) {
    mostrarMensaje(mensaje, datos.error || 'No se pudo generar el código QR.');
    if (datos.siguiente) {
      habilitarFormulario(false);
      irA(datos.siguiente, 3000);
    }
    return;
  }
  const img = document.getElementById('qr');
  img.src = datos.qr;
  img.hidden = false;
  document.getElementById('qr-cargando').hidden = true;
  // La clave se muestra en grupos de 4 para escribirla más fácil
  const secreto = document.getElementById('secreto');
  secreto.textContent = datos.secreto.match(/.{1,4}/g).join(' ');
  secreto.dataset.valor = datos.secreto;
}

// Botón para copiar la clave manual
const botonCopiar = document.getElementById('copiar');
if (botonCopiar) {
  botonCopiar.addEventListener('click', async () => {
    const valor = document.getElementById('secreto').dataset.valor;
    if (!valor) return;
    await navigator.clipboard.writeText(valor).catch(() => {});
    botonCopiar.classList.add('copiado');
    setTimeout(() => botonCopiar.classList.remove('copiado'), 1500);
  });
}

// Solo permite escribir números (máximo 6)
inputCodigo.addEventListener('input', () => {
  inputCodigo.value = inputCodigo.value.replace(/\D/g, '').slice(0, 6);
});

// Barra que muestra cuánto le queda al código actual (cambia cada 30 s)
function actualizarCicloTotp() {
  const segundos = 30 - (Math.floor(Date.now() / 1000) % 30);
  document.getElementById('ciclo-texto').textContent = `Nuevo código en ${segundos} s`;
  document.getElementById('ciclo-progreso').style.width = `${(segundos / 30) * 100}%`;
}
actualizarCicloTotp();
setInterval(actualizarCicloTotp, 1000);

// Enviar el código
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigo = inputCodigo.value.trim();
  if (!/^\d{6}$/.test(codigo)) return mostrarMensaje(mensaje, 'El código debe tener 6 dígitos.');

  boton.disabled = true;
  const { ok, datos } = await postJSON(RUTA_VERIFICAR, { codigo });
  boton.disabled = false;

  // Código correcto: el servidor ya guardó el JWT en una cookie segura
  if (ok) {
    habilitarFormulario(false);
    mostrarMensaje(mensaje, datos.mensaje, 'ok');
    return irA(datos.siguiente, 1000);
  }

  if (datos.intentos) pintarContador(datos.intentos, CONSECUENCIA);

  // 3 intentos agotados o verificación expirada: vuelve al login
  if (datos.siguiente) {
    habilitarFormulario(false);
    mostrarMensaje(mensaje, datos.error);
    return irA(datos.siguiente, 3500);
  }

  const tipo = datos.intentos && datos.intentos.restantes === 1 ? 'aviso' : 'error';
  mostrarMensaje(mensaje, datos.error || 'No se pudo verificar el código.', tipo);
  inputCodigo.value = '';
  inputCodigo.focus();
});

// Cancelar: descarta el login a medias en el servidor
document.getElementById('cancelar').addEventListener('click', async (e) => {
  e.preventDefault();
  await postJSON('/api/mfa/cancelar', {});
  location.href = '/login.html';
});

iniciar();
