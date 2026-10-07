// Login social (Fase 6):
// - Google: a través de Cognito (proveedor federado + Hosted UI, OAuth 2.0 "authorization code")
// - GitHub: con Passport.js (GitHub no es proveedor de Cognito, así que la app firma su propio JWT)
// En ambos casos, ANTES de entregar el JWT se pide el MFA TOTP de la app (ver routes/mfa.js).
const express = require('express');
const crypto = require('crypto');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const config = require('../config/env');
const cognito = require('../services/cognito');
const jwt = require('../services/jwt');
const { intentosMfa } = require('../services/contadores');

const router = express.Router();
const DIEZ_MINUTOS = 10 * 60 * 1000;

// ---------- Utilidades de seguridad ----------

// Valor aleatorio impredecible (para "state" y PKCE)
const aleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// Compara en tiempo constante (no revela por el tiempo de respuesta cuántos caracteres coinciden)
function igualSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Nueva sesión (nuevo ID de cookie): evita la fijación de sesión
const regenerarSesion = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

// Error genérico: nunca se explica al navegador qué falló exactamente
function fallo(res, codigo = 'social') {
  res.redirect(`/login.html?error=${codigo}`);
}

// Cognito puede entregar email_verified como booleano o como texto
const correoVerificado = (claims) => claims.email_verified === true || claims.email_verified === 'true';

// Deja el login "pendiente de MFA": los tokens se guardan SOLO en la sesión del servidor
// y el navegador va a la página del código. Sin el código correcto no recibe ninguna cookie de sesión.
async function iniciarMfaSocial(req, res, datos) {
  if (intentosMfa.estado(datos.email).bloqueado) return fallo(res, 'bloqueado');
  await regenerarSesion(req);
  req.session.mfa = {
    tipo: 'social',
    proveedor: datos.proveedor,
    email: datos.email,
    username: datos.username,
    // Si ya tiene clave TOTP social, solo pide el código; si no, primero la configura (QR)
    reto: datos.secretoCifrado ? 'SOFTWARE_TOKEN_MFA' : 'MFA_SETUP',
    secretoCifrado: datos.secretoCifrado || null,
    tokens: datos.tokens || null, // Google: tokens de Cognito (aún no entregados)
    usuarioApp: datos.usuarioApp || null, // GitHub: datos para firmar el JWT propio
    creadoEn: Date.now(),
  };
  res.redirect(datos.secretoCifrado ? '/mfa-codigo.html' : '/mfa-configurar.html');
}

// ---------- Google (vía Cognito) ----------

// Canjea el "code" por tokens en el endpoint /oauth2/token de Cognito.
// El App Client es público (sin secret), por eso se usa PKCE (code_verifier).
async function canjearCodigo(code, verificador) {
  const respuesta = await fetch(new URL('/oauth2/token', config.cognito.domain), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.cognito.clientId,
      code,
      redirect_uri: config.cognito.redirectUri,
      code_verifier: verificador,
    }),
  });
  if (!respuesta.ok) throw Object.assign(new Error(`token endpoint ${respuesta.status}`), { name: 'CanjeFallido' });
  return respuesta.json();
}

// GET /auth/google -> redirige al Hosted UI de Cognito, que a su vez manda a Google
router.get('/auth/google', (req, res) => {
  if (!config.cognito.domain || !config.cognito.redirectUri) return fallo(res);

  // state: valor aleatorio que debe volver idéntico en el callback (protege contra CSRF:
  // un atacante no puede hacer que tu navegador complete un login que él inició).
  // PKCE: el "code" robado no sirve sin el verificador, que nunca sale del servidor.
  const state = aleatorio();
  const verificador = aleatorio(48);
  const desafio = crypto.createHash('sha256').update(verificador).digest('base64url');
  req.session.oauthGoogle = { state, verificador, creadoEn: Date.now() };

  const url = new URL('/oauth2/authorize', config.cognito.domain);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.cognito.clientId,
    redirect_uri: config.cognito.redirectUri,
    identity_provider: 'Google', // salta la pantalla de Cognito y va directo a Google
    scope: 'openid email profile',
    state,
    code_challenge: desafio,
    code_challenge_method: 'S256',
  }).toString();
  res.redirect(url.toString());
});

// GET /auth/google/callback?code=...&state=...
router.get('/auth/google/callback', async (req, res) => {
  const guardado = req.session.oauthGoogle;
  delete req.session.oauthGoogle; // el state es de un solo uso
  const { code, state, error } = req.query;

  // 1) Validar state (CSRF) y que el intento no sea viejo
  if (error || !guardado || !code || !state || !igualSeguro(state, guardado.state) || Date.now() - guardado.creadoEn > DIEZ_MINUTOS) {
    console.warn('[google] callback rechazado: state inválido, vencido o login cancelado');
    return fallo(res);
  }

  try {
    // 2) Canjear el code por tokens y verificar el ID token (firma, emisor, audiencia, expiración)
    let tokens = await canjearCodigo(code, guardado.verificador);
    const claims = await jwt.verificarTokenCognito(tokens.id_token);
    const username = claims['cognito:username'];
    const google = (claims.identities || []).find((i) => i.providerName === 'Google');

    // 3) Vincular: si es un usuario federado nuevo ("google_...") y ya existe una cuenta
    //    con el mismo correo, se enlaza Google a esa cuenta en vez de duplicarla.
    if (username.startsWith('google_') && google) {
      const existentes = (await cognito.buscarPorEmail(claims.email)).filter(
        (u) => u.username !== username && u.estado !== 'EXTERNAL_PROVIDER'
      );
      if (existentes.length) {
        // Solo si AMBOS correos están verificados (evita tomar la cuenta de otra persona)
        const destino = existentes.find((u) => u.emailVerificado && u.estado !== 'UNCONFIRMED');
        if (!correoVerificado(claims) || !destino) {
          console.warn('[google] vinculación rechazada: correo sin verificar');
          return fallo(res, 'vinculo');
        }
        await cognito.vincularGoogle(username, google.userId, destino.username);
        console.log('[google] identidad de Google vinculada a una cuenta existente');
        return res.redirect('/auth/google'); // nuevo login: ahora entra a la cuenta vinculada
      }
    }

    // 4) Usuario nuevo: rol EmpleadoVentas y tienda lima-centro (no los elige él)
    const usuario = await cognito.obtenerUsuario(username);
    if (!usuario.habilitado) return fallo(res, 'deshabilitado');
    if (await cognito.asignarValoresPorDefecto(usuario, config.rolPorDefecto, config.tiendaPorDefecto)) {
      // El ID token anterior no tenía el grupo: se piden tokens nuevos que ya lo incluyan
      const nuevos = await cognito.refrescarTokens(tokens.refresh_token);
      tokens = { id_token: nuevos.IdToken, access_token: nuevos.AccessToken, expires_in: nuevos.ExpiresIn };
      await jwt.verificarTokenCognito(tokens.id_token);
    }

    // 5) MFA de la app antes de entregar el JWT (el refresh token no se guarda)
    await iniciarMfaSocial(req, res, {
      proveedor: 'google',
      username,
      email: claims.email,
      secretoCifrado: usuario.secretoMfaSocial,
      tokens: { IdToken: tokens.id_token, AccessToken: tokens.access_token, ExpiresIn: tokens.expires_in },
    });
  } catch (err) {
    console.error('[google] error en el callback:', err.name); // sin tokens ni datos sensibles
    fallo(res);
  }
});

// ---------- GitHub (Passport.js) ----------

const githubConfigurado = Boolean(config.github.clientId && config.github.clientSecret && config.appJwtSecret);

if (githubConfigurado) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.github.clientId,
        clientSecret: config.github.clientSecret,
        callbackURL: config.github.callbackUrl,
        scope: ['user:email'], // permite leer los correos, incluso los privados
        state: true, // Passport genera y valida el "state" en la sesión (anti-CSRF)
        allRawEmails: true, // trae todos los correos con sus campos "primary" y "verified"
      },
      // El access token de GitHub solo se usa aquí para leer el perfil: no se guarda ni se registra
      (accessToken, refreshToken, perfil, done) =>
        done(null, {
          nombre: perfil.displayName || perfil.username,
          correoPublico: perfil._json && perfil._json.email,
          correos: perfil.emails || [],
        })
    )
  );
}

// Elige el correo: el público si está verificado; si no, el principal verificado.
// Nunca se usa un correo sin verificar (podría ser de otra persona).
function elegirCorreo(perfil) {
  const verificados = perfil.correos.filter((c) => c.verified && c.value);
  const publico =
    perfil.correoPublico && verificados.find((c) => c.value.toLowerCase() === perfil.correoPublico.toLowerCase());
  const elegido = publico || verificados.find((c) => c.primary);
  return elegido ? elegido.value.trim().toLowerCase() : null;
}

// GET /auth/github -> redirige a GitHub
router.get('/auth/github', (req, res, next) => {
  if (!githubConfigurado) return fallo(res);
  passport.authenticate('github', { session: false })(req, res, next);
});

// GET /auth/github/callback -> Passport valida el state, canjea el code y trae el perfil
router.get('/auth/github/callback', (req, res, next) => {
  if (!githubConfigurado) return fallo(res);

  passport.authenticate('github', { session: false }, async (err, perfil) => {
    if (err || !perfil) {
      console.warn('[github] login rechazado:', err ? err.name || 'error' : 'state inválido o cancelado');
      return fallo(res);
    }
    try {
      const email = elegirCorreo(perfil);
      if (!email) return fallo(res, 'correo');

      // Vincular: si el correo ya existe en Cognito, se usa esa cuenta (no se duplica)
      const existentes = await cognito.buscarPorEmail(email);
      const cuenta = existentes.find((u) => u.estado !== 'EXTERNAL_PROVIDER') || existentes[0];
      if (cuenta && cuenta.estado === 'UNCONFIRMED') {
        // Alguien registró este correo sin verificarlo: no se vincula (evita "pre-secuestro" de cuentas)
        console.warn('[github] vinculación rechazada: la cuenta existente no está verificada');
        return fallo(res, 'vinculo');
      }
      const username = cuenta
        ? cuenta.username
        : await cognito.crearUsuarioGithub({
            email,
            nombre: String(perfil.nombre || email).slice(0, 100),
            tienda: config.tiendaPorDefecto,
          });

      let usuario = await cognito.obtenerUsuario(username);
      if (!usuario.habilitado) return fallo(res, 'deshabilitado');
      if (await cognito.asignarValoresPorDefecto(usuario, config.rolPorDefecto, config.tiendaPorDefecto)) {
        usuario = await cognito.obtenerUsuario(username);
      }

      await iniciarMfaSocial(req, res, {
        proveedor: 'github',
        username,
        email,
        secretoCifrado: usuario.secretoMfaSocial,
        usuarioApp: {
          username,
          email: usuario.email || email,
          nombre: usuario.nombre,
          tienda: usuario.tienda,
          grupos: usuario.grupos,
        },
      });
    } catch (e) {
      console.error('[github] error en el callback:', e.name);
      fallo(res);
    }
  })(req, res, next);
});

module.exports = router;
