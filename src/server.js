// Punto de entrada del servidor Express de TechStore
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const passport = require('passport');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const config = require('./config/env');
const authRoutes = require('./routes/auth');
const mfaRoutes = require('./routes/mfa');
const productosRoutes = require('./routes/productos');
const reportesRoutes = require('./routes/reportes');
const adminRoutes = require('./routes/admin');
const socialRoutes = require('./routes/social');

const app = express();
app.disable('x-powered-by'); // no revelar que el servidor usa Express

// Permite leer JSON y formularios en el body de las peticiones
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sesión del servidor: guarda datos temporales (ej. contador de intentos, sesión MFA)
app.use(
  session({
    // Sin SESSION_SECRET se usa uno aleatorio (las sesiones se pierden al reiniciar, pero nunca hay un secreto fijo)
    secret: config.sessionSecret || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 }, // 1 hora
  })
);

// Passport (login con GitHub). No usa sesiones de Passport: la sesión la crea la app tras el MFA.
app.use(passport.initialize());

// Sirve las páginas HTML de la carpeta /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Ruta de prueba para verificar que el servidor está vivo
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'TechStore', hora: new Date().toISOString() });
});

// Rutas de la API
app.use('/api', authRoutes);
app.use('/api/mfa', mfaRoutes);
app.use('/api/productos', productosRoutes); // CRUD con permisos por rol y tienda
app.use('/api/reportes', reportesRoutes);
app.use('/api/admin', adminRoutes); // solo Administrador
app.use('/', socialRoutes); // /auth/google y /auth/github (login social)

app.listen(config.port, () => {
  console.log(`TechStore escuchando en http://localhost:${config.port}`);
});

// Se exporta la app para poder probarla
module.exports = app;
