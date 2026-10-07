// Manejo de los JWT de la app.
// - Se guardan en cookies httpOnly: el JavaScript del navegador no puede leerlas
//   (protege contra robo de token por XSS).
// - Hay dos tipos de token:
//   1) Cognito (login normal y Google): firmado por Cognito con RS256. Se verifica con
//      aws-jwt-verify: firma (llaves públicas JWKS), expiración, User Pool y App Client.
//   2) Propio de la app (GitHub, que no es proveedor de Cognito): firmado por el servidor
//      con HS256 y APP_JWT_SECRET. Lleva los mismos claims (grupos y tienda leídos de Cognito).
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const jsonwebtoken = require('jsonwebtoken');
const config = require('../config/env');

const COOKIE_ID = 'ts_id'; // ID token: identidad, grupos (rol) y custom:tienda
const COOKIE_ACCESS = 'ts_access'; // Access token de Cognito: para cerrar sesión en Cognito

// Emisor y audiencia del JWT propio (se comprueban al verificar)
const EMISOR_APP = 'techstore-app';
const AUDIENCIA_APP = 'techstore-web';
const DURACION_APP = 3600; // 1 hora, igual que los tokens de Cognito

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

// Guarda los tokens en cookies. resultado = { IdToken, AccessToken?, ExpiresIn }
function guardarTokens(res, resultado) {
  const opciones = opcionesCookie(resultado.ExpiresIn || 3600);
  res.cookie(COOKIE_ID, resultado.IdToken, opciones);
  // Los usuarios de GitHub no tienen access token de Cognito
  if (resultado.AccessToken) res.cookie(COOKIE_ACCESS, resultado.AccessToken, opciones);
  else res.clearCookie(COOKIE_ACCESS, opcionesBorrado());
}

// Para borrar una cookie se usan las mismas opciones con las que se creó
function opcionesBorrado() {
  const { maxAge, ...resto } = opcionesCookie(0);
  return resto;
}

function borrarTokens(res) {
  res.clearCookie(COOKIE_ID, opcionesBorrado());
  res.clearCookie(COOKIE_ACCESS, opcionesBorrado());
}

// Firma el JWT propio para un usuario de GitHub, con sus datos tomados de Cognito
function firmarTokenApp(usuario) {
  const token = jsonwebtoken.sign(
    {
      'cognito:username': usuario.username,
      email: usuario.email,
      name: usuario.nombre,
      'custom:tienda': usuario.tienda || undefined,
      'cognito:groups': usuario.grupos,
      origen: 'github',
    },
    config.appJwtSecret,
    {
      algorithm: 'HS256',
      issuer: EMISOR_APP,
      audience: AUDIENCIA_APP,
      subject: usuario.username,
      expiresIn: DURACION_APP,
    }
  );
  return { IdToken: token, ExpiresIn: DURACION_APP };
}

// Verifica cualquiera de los dos tipos de token y devuelve sus claims.
// Lanza error si la firma, el emisor, la audiencia o la expiración no son válidos.
async function verificarIdToken(token) {
  // Se lee el emisor SIN confiar todavía en el token, solo para elegir cómo verificarlo
  const sinVerificar = jsonwebtoken.decode(token) || {};
  if (sinVerificar.iss === EMISOR_APP) {
    if (!config.appJwtSecret) throw new Error('APP_JWT_SECRET no configurado');
    // algorithms: ['HS256'] fija el algoritmo: evita el ataque "alg: none" o cambiar a otro algoritmo
    return jsonwebtoken.verify(token, config.appJwtSecret, {
      algorithms: ['HS256'],
      issuer: EMISOR_APP,
      audience: AUDIENCIA_APP,
    });
  }
  return obtenerVerificador().verify(token);
}

// Verifica SOLO tokens de Cognito (para el callback de Google, donde no se acepta el JWT propio)
async function verificarTokenCognito(token) {
  return obtenerVerificador().verify(token);
}

// De qué proveedor viene la sesión: cognito (correo y contraseña), google o github
function origenDe(claims) {
  if (claims.origen === 'github') return 'github';
  const identidades = claims.identities || [];
  const proveedor = identidades[0] && identidades[0].providerName;
  return proveedor ? proveedor.toLowerCase() : 'cognito';
}

// Convierte los claims a un objeto simple para la app
function datosUsuario(claims) {
  return {
    username: claims['cognito:username'], // identificador interno del usuario en Cognito
    email: claims.email,
    nombre: claims.name,
    tienda: claims['custom:tienda'] || null,
    grupos: claims['cognito:groups'] || [],
    origen: origenDe(claims),
    emitido: claims.iat,
    expira: claims.exp,
  };
}

module.exports = {
  COOKIE_ID,
  COOKIE_ACCESS,
  guardarTokens,
  borrarTokens,
  firmarTokenApp,
  verificarIdToken,
  verificarTokenCognito,
  datosUsuario,
};
