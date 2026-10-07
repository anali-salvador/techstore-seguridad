// CRUD de productos con permisos por ROL y por TIENDA (Fase 5).
// Orden de cada ruta: autenticar (JWT) -> permiso del rol -> tienda -> validar datos -> DynamoDB
const express = require('express');
const productos = require('../services/productos');
const { validarProducto } = require('../services/validaciones');
const { esTiendaValida } = require('../config/tiendas');
const { autenticar, requierePermiso, negarSiOtraTienda } = require('../middleware/autenticacion');

const router = express.Router();
router.use(autenticar); // todas las rutas de productos exigen un JWT válido

// Errores comunes de DynamoDB
function manejarError(res, err) {
  if (err.name === 'ConditionalCheckFailedException') {
    return res.status(404).json({ error: 'El producto no existe.' });
  }
  console.error('[productos]', err.name, err.message);
  res.status(500).json({ error: 'No se pudo completar la operación en el inventario.' });
}

// GET /api/productos?tienda=xxx -> lista según el alcance del rol
router.get('/', requierePermiso('productos:ver'), async (req, res) => {
  const { tienda } = req.query;
  try {
    if (req.usuario.alcance === 'todas') {
      // Administrador y Auditor: todas las tiendas, o filtran por una
      if (tienda && !esTiendaValida(tienda)) return res.status(400).json({ error: 'Tienda no válida.' });
      return res.json(tienda ? await productos.listarPorTienda(tienda) : await productos.listarTodos());
    }
    // Gerente y Empleado: SOLO su tienda (si piden otra -> 403)
    if (tienda && negarSiOtraTienda(req, res, tienda)) return;
    if (!req.usuario.tienda) return res.status(403).json({ error: 'No tienes una tienda asignada.' });
    res.json(await productos.listarPorTienda(req.usuario.tienda));
  } catch (err) {
    manejarError(res, err);
  }
});

// POST /api/productos -> crear producto
router.post('/', requierePermiso('productos:crear'), async (req, res) => {
  // El Gerente siempre crea en su tienda; el Administrador elige la tienda
  const tienda = req.usuario.alcance === 'todas' ? req.body.tienda : req.body.tienda || req.usuario.tienda;
  if (!esTiendaValida(tienda)) return res.status(400).json({ error: 'Selecciona una tienda válida.' });
  if (negarSiOtraTienda(req, res, tienda)) return;

  const { errores, campos } = validarProducto(req.body);
  if (errores.length) return res.status(400).json({ error: `Revisa los datos: ${errores.join(', ')}.` });

  try {
    const item = await productos.crear({ tienda, ...campos }, req.usuario.email);
    res.status(201).json(item);
  } catch (err) {
    manejarError(res, err);
  }
});

// PUT /api/productos/:tienda/:id -> editar nombre, categoría, precio y/o stock
router.put('/:tienda/:id', requierePermiso('productos:editar'), async (req, res) => {
  const { tienda, id } = req.params;
  if (negarSiOtraTienda(req, res, tienda)) return;

  const { errores, campos } = validarProducto(req.body, true);
  if (errores.length) return res.status(400).json({ error: `Revisa los datos: ${errores.join(', ')}.` });
  if (!Object.keys(campos).length) return res.status(400).json({ error: 'No enviaste cambios.' });

  // Cambiar el precio es un permiso aparte (por si un rol puede editar pero no fijar precios)
  if (campos.precio !== undefined && !req.usuario.permisos.includes('productos:precio')) {
    return res.status(403).json({ error: 'No tienes permiso para modificar precios.', permiso: 'productos:precio' });
  }

  try {
    res.json(await productos.actualizar(tienda, id, campos, req.usuario.email));
  } catch (err) {
    manejarError(res, err);
  }
});

// PATCH /api/productos/:tienda/:id/stock -> solo el stock (lo usa el Empleado de Ventas)
router.patch('/:tienda/:id/stock', requierePermiso('productos:stock'), async (req, res) => {
  const { tienda, id } = req.params;
  if (negarSiOtraTienda(req, res, tienda)) return;

  // Esta ruta nunca cambia el precio: si alguien lo intenta, se rechaza explícitamente
  if (req.body.precio !== undefined) {
    if (!req.usuario.permisos.includes('productos:precio')) {
      return res.status(403).json({ error: 'No tienes permiso para modificar precios.', permiso: 'productos:precio' });
    }
    return res.status(400).json({ error: 'Esta ruta solo actualiza el stock. Para cambiar el precio usa Editar.' });
  }
  const { errores, campos } = validarProducto({ stock: req.body.stock }, true);
  if (errores.length || campos.stock === undefined) {
    return res.status(400).json({ error: 'El stock debe ser un número entero entre 0 y 1 000 000.' });
  }

  try {
    res.json(await productos.actualizar(tienda, id, { stock: campos.stock }, req.usuario.email));
  } catch (err) {
    manejarError(res, err);
  }
});

// DELETE /api/productos/:tienda/:id
router.delete('/:tienda/:id', requierePermiso('productos:eliminar'), async (req, res) => {
  const { tienda, id } = req.params;
  if (negarSiOtraTienda(req, res, tienda)) return;
  try {
    await productos.eliminar(tienda, id);
    res.json({ mensaje: 'Producto eliminado.' });
  } catch (err) {
    manejarError(res, err);
  }
});

module.exports = router;
