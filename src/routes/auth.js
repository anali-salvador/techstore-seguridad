// Rutas de autenticación: registro y confirmación de cuenta (Fase 3).
const express = require('express');
const { TIENDAS, esTiendaValida } = require('../config/tiendas');
const { validarPassword, validarEmail } = require('../services/validaciones');
const cognito = require('../services/cognito');
const { intentosLogin, intentosMfa } = require('../services/contadores');
const jwt = require('../services/jwt');
const config = require('../config/env');
const { autenticar } = require('../middleware/autenticacion');

const router = express.Router();

// A qué página va el usuario según el reto MFA que devuelve Cognito
const PAGINAS_MFA = {
  MFA_SETUP: '/mfa-configurar.html', // primer login: aún no configuró Google Authenticator
  SOFTWARE_TOKEN_MFA: '/mfa-codigo.html', // logins siguientes: pide el código de 6 dígitos
};

// Crea una sesión nueva (nuevo ID de cookie) para evitar la "fijación de sesión"
const regenerarSesion = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

// Normaliza el correo para que "Ana@Mail.com" y "ana@mail.com" sean el mismo usuario
const limpiarEmail = (email) => (email || '').trim().toLowerCase();

// GET /api/tiendas -> lista para el <select> del registro
router.get('/tiendas', (req, res) => res.json(TIENDAS));

// POST /api/auth/registro
router.post('/auth/registro', async (req, res) => {
  const email = limpiarEmail(req.body.email);
  const nombre = (req.body.nombre || '').trim();
  const { password, tienda } = req.body;

  // Se valida también en el servidor: nunca se confía solo en el navegador
  if (!validarEmail(email)) return res.status(400).json({ error: 'Correo no válido.' });
  if (nombre.length < 3) return res.status(400).json({ error: 'Ingresa tu nombre completo.' });
  if (!esTiendaValida(tienda)) return res.status(400).json({ error: 'Selecciona una tienda válida.' });
  const erroresPass = validarPassword(password);
  if (erroresPass.length) {
    return res.status(400).json({ error: `La contraseña necesita: ${erroresPass.join(', ')}.` });
  }

  // Paso 1: crear el usuario en Cognito (Cognito rechaza correos repetidos)
  try {
    await cognito.registrarUsuario({ email, password, nombre });
  } catch (err) {
    console.error('[registro] SignUp:', err.name, err.message);
    return res.status(400).json({ error: cognito.traducirError(err) });
  }

  // Paso 2: el servidor asigna la tienda y el rol por defecto
  try {
    await cognito.asignarTiendaYRol(email, tienda);
  } catch (err) {
    console.error('[registro] Asignar tienda/rol:', err.name, err.message);
    return res.status(500).json({
      error: 'La cuenta se creó, pero no se pudo asignar la tienda o el rol. Contacta al administrador.',
    });
  }

  res.json({ mensaje: 'Registro exitoso. Revisa tu correo e ingresa el código de verificación.' });
});

// POST /api/auth/confirmar -> valida el código de 6 dígitos enviado al correo
router.post('/auth/confirmar', async (req, res) => {
  const email = limpiarEmail(req.body.email);
  const codigo = (req.body.codigo || '').trim();
  if (!validarEmail(email) || !/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ error: 'Ingresa tu correo y el código de 6 dígitos.' });
  }
  try {
    await cognito.confirmarRegistro(email, codigo);
    res.json({ mensaje: 'Cuenta verificada. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error('[confirmar]', err.name, err.message);
    res.status(400).json({ error: cognito.traducirError(err) });
  }
});

// POST /api/auth/reenviar-codigo
router.post('/auth/reenviar-codigo', async (req, res) => {
  const email = limpiarEmail(req.body.email);
  if (!validarEmail(email)) return res.status(400).json({ error: 'Correo no válido.' });
  try {
    await cognito.reenviarCodigo(email);
    res.json({ mensaje: 'Te enviamos un nuevo código a tu correo.' });
  } catch (err) {
    console.error('[reenviar-codigo]', err.name, err.message);
    res.status(400).json({ error: cognito.traducirError(err) });
  }
});

// POST /api/auth/login -> paso 1 del login: correo + contraseña
router.post('/auth/login', async (req, res) => {
  const email = limpiarEmail(req.body.email);
  const password = req.body.password || '';
  if (!validarEmail(email) || !password) {
    return res.status(400).json({ error: 'Ingresa tu correo y contraseña.' });
  }

  // Si la cuenta ya está bloqueada, ni siquiera se consulta a Cognito
  const previo = intentosLogin.estado(email);
  if (previo.bloqueado) {
    return res.status(423).json({ error: 'Cuenta bloqueada temporalmente por intentos fallidos.', intentos: previo });
  }

  // Si falló 3 veces el código MFA, tampoco puede volver a intentar hasta que pase el bloqueo.
  // Se revisa ANTES de consultar la contraseña para no revelar si era correcta.
  const mfa = intentosMfa.estado(email);
  if (mfa.bloqueado) {
    return res.status(423).json({
      error: 'La verificación en dos pasos está bloqueada por 3 códigos incorrectos.',
      intentos: { ...previo, bloqueado: true, segundosBloqueo: mfa.segundosBloqueo },
    });
  }

  let respuesta;
  try {
    respuesta = await cognito.iniciarSesion(email, password);
  } catch (err) {
    console.error('[login]', err.name, err.message);

    // Cuenta registrada pero sin verificar el correo (no cuenta como intento fallido)
    if (err.name === 'UserNotConfirmedException') {
      return res.status(403).json({
        error: 'Tu cuenta aún no está verificada. Ingresa el código que llegó a tu correo.',
        siguiente: `/confirmar.html?email=${encodeURIComponent(email)}`,
      });
    }

    // Contraseña incorrecta o usuario inexistente: se suma un intento fallido.
    // El mensaje es el mismo en ambos casos para no revelar qué correos existen.
    if (err.name === 'NotAuthorizedException' || err.name === 'UserNotFoundException') {
      const estado = intentosLogin.registrarFallo(email);
      // Cognito también tiene su propio bloqueo nativo tras varios fallos
      const bloqueoCognito = /attempts exceeded/i.test(err.message);
      if (estado.bloqueado || bloqueoCognito) {
        return res.status(423).json({
          error: `Cuenta bloqueada temporalmente tras ${estado.fallidos} intentos fallidos.`,
          intentos: estado,
        });
      }
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.', intentos: estado });
    }

    return res.status(500).json({ error: cognito.traducirError(err) });
  }

  // Credenciales correctas: el contador vuelve a cero
  intentosLogin.reiniciar(email);

  const reto = respuesta.ChallengeName;
  if (!PAGINAS_MFA[reto]) {
    // Con MFA obligatorio, Cognito siempre debería pedir un reto MFA
    console.error('[login] Respuesta inesperada de Cognito:', reto || 'sin reto (MFA no exigido)');
    return res.status(500).json({ error: 'El login requiere MFA y no se pudo iniciar. Contacta al administrador.' });
  }

  // Se guarda la Session de Cognito en el SERVIDOR (el navegador nunca la ve).
  // Aún NO hay JWT: el usuario solo tiene acceso después de pasar el MFA.
  await regenerarSesion(req);
  req.session.mfa = { email, reto, cognitoSession: respuesta.Session, creadoEn: Date.now() };

  res.json({
    mensaje:
      reto === 'MFA_SETUP'
        ? 'Credenciales correctas. Ahora configura tu verificación en dos pasos.'
        : 'Credenciales correctas. Ingresa tu código de verificación.',
    reto,
    siguiente: PAGINAS_MFA[reto],
  });
});

// GET /api/auth/sesion -> datos del usuario según su JWT (verificado)
// (incluye rol, alcance y permisos para que el dashboard muestre los botones correctos)
router.get('/auth/sesion', autenticar, (req, res) => {
  const token = req.cookies[jwt.COOKIE_ID] || '';
  res.json({
    usuario: req.usuario,
    // Solo una vista parcial del token, como evidencia (el token completo nunca sale de la cookie)
    token: { vista: `${token.slice(0, 32)}…${token.slice(-12)}`, longitud: token.length },
  });
});

// POST /api/auth/logout -> cierra la sesión en Cognito y en la app
router.post('/auth/logout', async (req, res) => {
  const accessToken = req.cookies[jwt.COOKIE_ACCESS];
  if (accessToken) {
    // Invalida los tokens en Cognito; si ya expiraron, igual seguimos cerrando sesión
    await cognito.cerrarSesionGlobal(accessToken).catch((err) => console.error('[logout]', err.name));
  }

  // Si entró con Google, también se cierra la sesión del Hosted UI de Cognito
  // (si no, el próximo "Continuar con Google" entraría sin preguntar)
  let siguiente = '/login.html';
  const origen = await jwt
    .verificarIdToken(req.cookies[jwt.COOKIE_ID] || '')
    .then((claims) => jwt.datosUsuario(claims).origen)
    .catch(() => null);
  if (origen === 'google' && config.cognito.domain) {
    const url = new URL('/logout', config.cognito.domain);
    url.search = new URLSearchParams({
      client_id: config.cognito.clientId,
      logout_uri: new URL('/login.html', config.cognito.redirectUri).toString(),
    }).toString();
    siguiente = url.toString();
  }

  jwt.borrarTokens(res);
  req.session.destroy(() => res.json({ mensaje: 'Sesión cerrada.', siguiente }));
});

module.exports = router;
