// Manejo de los JWT que entrega Cognito después del MFA.
// - Se guardan en cookies httpOnly: el JavaScript del navegador no puede leerlas
//   (protege contra robo de token por XSS).
// - Se verifican con aws-jwt-verify: firma (llaves públicas JWKS de Cognito),
//   expiración, User Pool emisor y App Client.
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const config = require('../config/env');

const COOKIE_ID = 'ts_id'; // ID token: identidad, grupos (rol) y custom:tienda
const COOKIE_ACCESS = 'ts_access'; // Access token: para cerrar sesión en Cognito

// Verificador del ID token de nuestro User Pool y App Client.
// Se crea la primera vez que se usa (si faltan variables en .env, el servidor igual arranca).
let verificadorId = null;
function obtenerVerificador() {
  if (!verificadorId) {
    verificadorId = CognitoJwtVerifier.create({
      userPoolId: config.cognito.userPoolId,
      clientId: config.cognito.clientId,
      tokenUse: 'id',
    });
  }
  return verificadorId;
}

// Opciones de las cookies de los tokens
function opcionesCookie(segundos) {
  return {
    httpOnly: true, // no accesible desde JavaScript
    sameSite: 'lax', // no se envía en peticiones de otros sitios (ayuda contra CSRF)
    secure: process.env.NODE_ENV === 'production', // solo HTTPS en producción
    maxAge: segundos * 1000,
  };
}

// Guarda los tokens de Cognito (AuthenticationResult) en cookies
function guardarTokens(res, resultado) {
  const opciones = opcionesCookie(resultado.ExpiresIn || 3600);
  res.cookie(COOKIE_ID, resultado.IdToken, opciones);
  res.cookie(COOKIE_ACCESS, resultado.AccessToken, opciones);
}

function borrarTokens(res) {
  res.clearCookie(COOKIE_ID);
  res.clearCookie(COOKIE_ACCESS);
}

// Verifica el ID token y devuelve sus datos (claims). Lanza error si no es válido.
async function verificarIdToken(token) {
  return obtenerVerificador().verify(token);
}

// Convierte los claims de Cognito a un objeto simple para la app
function datosUsuario(claims) {
  return {
    username: claims['cognito:username'], // identificador interno del usuario en Cognito
    email: claims.email,
    nombre: claims.name,
    tienda: claims['custom:tienda'] || null,
    grupos: claims['cognito:groups'] || [],
    emitido: claims.iat,
    expira: claims.exp,
  };
}

module.exports = {
  COOKIE_ID,
  COOKIE_ACCESS,
  guardarTokens,
  borrarTokens,
  verificarIdToken,
  datosUsuario,
};
