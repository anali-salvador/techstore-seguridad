// Punto de entrada del servidor Express de TechStore
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const config = require('./config/env');

const app = express();

// Permite leer JSON y formularios en el body de las peticiones
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sesión del servidor: guarda datos temporales (ej. contador de intentos, sesión MFA)
app.use(
  session({
    secret: config.sessionSecret || 'solo-desarrollo-cambiar',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 }, // 1 hora
  })
);

// Sirve las páginas HTML de la carpeta /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Ruta de prueba para verificar que el servidor está vivo
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'TechStore', hora: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`TechStore escuchando en http://localhost:${config.port}`);
});
