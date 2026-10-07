// Carga las variables del archivo .env y las expone en un solo objeto.
// Así el resto del código no lee process.env directamente.
// Se usa la ruta absoluta para que funcione aunque el servidor se inicie desde otra carpeta.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const config = {
  port: process.env.PORT || 3000,
  sessionSecret: process.env.SESSION_SECRET,

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
  },

  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: process.env.COGNITO_CLIENT_ID,
    domain: process.env.COGNITO_DOMAIN,
    redirectUri: process.env.COGNITO_REDIRECT_URI,
  },

  dynamoTable: process.env.DYNAMODB_TABLE || 'TechStoreProductos',

  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackUrl: process.env.GITHUB_CALLBACK_URL,
  },

  appJwtSecret: process.env.APP_JWT_SECRET,

  // Límites del contador visible de intentos
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS) || 5,
  maxMfaAttempts: Number(process.env.MAX_MFA_ATTEMPTS) || 3,
  loginBloqueoMinutos: Number(process.env.LOGIN_BLOQUEO_MINUTOS) || 15,
};

// Avisa (sin detener el servidor) si falta alguna variable importante
const requeridas = ['SESSION_SECRET', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID'];
const faltantes = requeridas.filter((v) => !process.env[v]);
if (faltantes.length) {
  console.warn(`[config] Faltan variables en .env: ${faltantes.join(', ')}`);
}

module.exports = config;
