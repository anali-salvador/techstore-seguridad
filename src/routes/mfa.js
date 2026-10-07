// Rutas del MFA TOTP (Fase 4).
// Solo se pueden usar después de pasar el paso 1 del login (correo + contraseña),
// porque necesitan la Session temporal de Cognito guardada en req.session.mfa.
const express = require('express');
const QRCode = require('qrcode');
const cognito = require('../services/cognito');
const jwt = require('../services/jwt');
const { intentosMfa } = require('../services/contadores');

const router = express.Router();

// Errores de Cognito que significan "código incorrecto"
const ERRORES_CODIGO = ['CodeMismatchException', 'EnableSoftwareTokenMFAException'];

// Middleware: exige que exista un login pendiente de MFA
function requiereRetoMfa(req, res, next) {
  if (!req.session.mfa) {
    return res.status(401).json({
      error: 'Primero inicia sesión con tu correo y contraseña.',
      siguiente: '/login.html',
    });
  }
  next();
}
router.use(requiereRetoMfa);

// Crea una sesión nueva (nuevo ID de cookie) al completar el login
const regenerarSesion = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

// Valida el formato del código: exactamente 6 dígitos (no cuenta como intento)
const codigoValido = (codigo) => /^\d{6}$/.test(codigo);

// Maneja un error de Cognito al verificar un código MFA
function manejarErrorCodigo(req, res, err) {
  const { email } = req.session.mfa;
  console.error('[mfa]', err.name, err.message);

  // Código incorrecto: suma un intento. Al 3.º se cancela el login.
  if (ERRORES_CODIGO.includes(err.name)) {
    const estado = intentosMfa.registrarFallo(email);
    if (estado.bloqueado) {
      delete req.session.mfa; // la Session de Cognito se descarta: hay que volver a empezar
      return res.status(423).json({
        error: `Código incorrecto. Superaste los ${estado.maximo} intentos: el inicio de sesión fue cancelado.`,
        intentos: estado,
        siguiente: '/login.html',
      });
    }
    return res.status(401).json({ error: 'Código incorrecto.', intentos: estado });
  }

  // La Session de Cognito dura pocos minutos o ya no es válida
  if (err.name === 'NotAuthorizedException' || err.name === 'ExpiredCodeException') {
    delete req.session.mfa;
    return res.status(401).json({
      error: 'La verificación expiró. Inicia sesión de nuevo.',
      siguiente: '/login.html',
    });
  }

  res.status(500).json({ error: cognito.traducirError(err) });
}

// MFA correcto: entrega los JWT en cookies httpOnly y limpia el estado temporal
async function completarLogin(req, res, resultado) {
  const { email } = req.session.mfa;
  intentosMfa.reiniciar(email);
  await regenerarSesion(req); // borra req.session.mfa y cambia el ID de sesión
  jwt.guardarTokens(res, resultado);
  res.json({ mensaje: 'Verificación correcta. Bienvenido a TechStore.', siguiente: '/dashboard.html' });
}

// GET /api/mfa/estado -> qué reto está pendiente y cómo va el contador
router.get('/estado', (req, res) => {
  const { email, reto } = req.session.mfa;
  res.json({ email, reto, intentos: intentosMfa.estado(email) });
});

// POST /api/mfa/configurar/iniciar -> genera la clave TOTP y el QR (solo primer login)
router.post('/configurar/iniciar', async (req, res) => {
  const mfa = req.session.mfa;
  if (mfa.reto !== 'MFA_SETUP') return res.status(400).json({ error: 'Tu MFA ya está configurado.' });

  // Si la página se recarga, se reutiliza el mismo QR (no se pide otra clave a Cognito)
  if (mfa.qr) return res.json({ qr: mfa.qr, secreto: mfa.secreto, intentos: intentosMfa.estado(mfa.email) });

  try {
    const r = await cognito.asociarTotp(mfa.cognitoSession);
    mfa.cognitoSession = r.Session; // Cognito entrega una Session nueva para el siguiente paso

    // URI estándar "otpauth" que entiende Google Authenticator:
    // TOTP, 6 dígitos, cambia cada 30 segundos
    const uri =
      `otpauth://totp/TechStore:${encodeURIComponent(mfa.email)}` +
      `?secret=${r.SecretCode}&issuer=TechStore&algorithm=SHA1&digits=6&period=30`;
    mfa.qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    mfa.secreto = r.SecretCode;

    res.json({ qr: mfa.qr, secreto: mfa.secreto, intentos: intentosMfa.estado(mfa.email) });
  } catch (err) {
    manejarErrorCodigo(req, res, err);
  }
});

// POST /api/mfa/configurar/verificar -> primer código: activa el TOTP y entrega el JWT
router.post('/configurar/verificar', async (req, res) => {
  const mfa = req.session.mfa;
  const codigo = (req.body.codigo || '').trim();
  if (mfa.reto !== 'MFA_SETUP' || !mfa.secreto) {
    return res.status(400).json({ error: 'Primero genera el código QR.' });
  }
  if (!codigoValido(codigo)) return res.status(400).json({ error: 'El código debe tener 6 dígitos.' });

  try {
    const verificado = await cognito.verificarTotp(mfa.cognitoSession, codigo);
    if (verificado.Status !== 'SUCCESS') {
      return manejarErrorCodigo(req, res, { name: 'CodeMismatchException', message: verificado.Status });
    }
    const r = await cognito.completarConfiguracionMfa(verificado.Session, mfa.email);
    await completarLogin(req, res, r.AuthenticationResult);
  } catch (err) {
    manejarErrorCodigo(req, res, err);
  }
});

// POST /api/mfa/verificar -> logins siguientes: código de 6 dígitos y entrega el JWT
router.post('/verificar', async (req, res) => {
  const mfa = req.session.mfa;
  const codigo = (req.body.codigo || '').trim();
  if (mfa.reto !== 'SOFTWARE_TOKEN_MFA') return res.status(400).json({ error: 'Primero configura tu MFA.' });
  if (!codigoValido(codigo)) return res.status(400).json({ error: 'El código debe tener 6 dígitos.' });

  try {
    const r = await cognito.responderCodigoMfa(mfa.cognitoSession, mfa.email, codigo);
    await completarLogin(req, res, r.AuthenticationResult);
  } catch (err) {
    manejarErrorCodigo(req, res, err);
  }
});

// POST /api/mfa/cancelar -> abandona el login a medias
router.post('/cancelar', (req, res) => {
  delete req.session.mfa;
  res.json({ mensaje: 'Inicio de sesión cancelado.', siguiente: '/login.html' });
});

module.exports = router;
