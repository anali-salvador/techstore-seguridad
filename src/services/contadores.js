// Contadores de intentos compartidos por las rutas de login y de MFA.
// Se crean una sola vez para que todas las rutas vean los mismos números.
const ContadorIntentos = require('./intentos');
const config = require('../config/env');

// Login: 5 contraseñas incorrectas -> bloqueo
const intentosLogin = new ContadorIntentos(config.maxLoginAttempts, config.loginBloqueoMinutos);

// MFA: 3 códigos incorrectos -> se cancela el login y se bloquea el MFA de esa cuenta
const intentosMfa = new ContadorIntentos(config.maxMfaAttempts, config.loginBloqueoMinutos);

module.exports = { intentosLogin, intentosMfa };
