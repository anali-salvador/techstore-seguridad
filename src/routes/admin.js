// Panel del Administrador: gestionar rol (grupo de Cognito) y tienda de los usuarios.
const express = require('express');
const cognito = require('../services/cognito');
const { esTiendaValida } = require('../config/tiendas');
const { ROLES, PRIORIDAD } = require('../config/permisos');
const { autenticar, requierePermiso } = require('../middleware/autenticacion');

const router = express.Router();
// Todas las rutas: JWT válido + permiso "usuarios:gestionar" (solo Administrador)
router.use(autenticar, requierePermiso('usuarios:gestionar'));

// Roles que necesitan una tienda asignada para poder trabajar
const ROLES_CON_TIENDA = [ROLES.GERENTE, ROLES.EMPLEADO];

const usernameValido = (u) => /^[\w@.+-]{1,128}$/.test(u);

// Un administrador no puede quitarse su propio rol ni deshabilitarse (evita quedarse sin admin)
function esUnoMismo(req) {
  return req.params.username === req.usuario.username;
}

// GET /api/admin/usuarios
router.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await cognito.listarUsuarios(PRIORIDAD);
    res.json({ usuarios, yo: req.usuario.username, roles: PRIORIDAD });
  } catch (err) {
    console.error('[admin] listar:', err.name, err.message);
    res.status(500).json({ error: 'No se pudo obtener la lista de usuarios.' });
  }
});

// PUT /api/admin/usuarios/:username  { rol, tienda }
router.put('/usuarios/:username', async (req, res) => {
  const { username } = req.params;
  const { rol, tienda } = req.body;
  if (!usernameValido(username)) return res.status(400).json({ error: 'Usuario no válido.' });
  if (esUnoMismo(req)) return res.status(403).json({ error: 'No puedes cambiar tu propio rol.' });
  if (!PRIORIDAD.includes(rol)) return res.status(400).json({ error: 'Selecciona un rol válido.' });
  if (ROLES_CON_TIENDA.includes(rol) && !esTiendaValida(tienda)) {
    return res.status(400).json({ error: 'Ese rol necesita una tienda asignada.' });
  }
  if (tienda && !esTiendaValida(tienda)) return res.status(400).json({ error: 'Tienda no válida.' });

  try {
    await cognito.cambiarRol(username, rol, PRIORIDAD);
    if (tienda) await cognito.cambiarTienda(username, tienda);
    console.log(`[admin] ${req.usuario.email} asignó rol=${rol} tienda=${tienda || '-'} a ${username}`);
    res.json({ mensaje: 'Cambios guardados. Se aplican cuando el usuario vuelva a iniciar sesión.' });
  } catch (err) {
    console.error('[admin] cambiar rol/tienda:', err.name, err.message);
    res.status(500).json({ error: cognito.traducirError(err) });
  }
});

// PATCH /api/admin/usuarios/:username/estado  { habilitado: true|false }
router.patch('/usuarios/:username/estado', async (req, res) => {
  const { username } = req.params;
  if (!usernameValido(username)) return res.status(400).json({ error: 'Usuario no válido.' });
  if (esUnoMismo(req)) return res.status(403).json({ error: 'No puedes deshabilitar tu propia cuenta.' });
  if (typeof req.body.habilitado !== 'boolean') return res.status(400).json({ error: 'Indica si se habilita o no.' });

  try {
    await cognito.cambiarEstado(username, req.body.habilitado);
    console.log(`[admin] ${req.usuario.email} ${req.body.habilitado ? 'habilitó' : 'deshabilitó'} a ${username}`);
    res.json({ mensaje: req.body.habilitado ? 'Usuario habilitado.' : 'Usuario deshabilitado.' });
  } catch (err) {
    console.error('[admin] estado:', err.name, err.message);
    res.status(500).json({ error: cognito.traducirError(err) });
  }
});

module.exports = router;
