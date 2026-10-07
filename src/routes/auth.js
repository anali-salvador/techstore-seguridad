// Rutas de autenticación: registro y confirmación de cuenta (Fase 3).
const express = require('express');
const { TIENDAS, esTiendaValida } = require('../config/tiendas');
const { validarPassword, validarEmail } = require('../services/validaciones');
const cognito = require('../services/cognito');

const router = express.Router();

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

module.exports = router;
