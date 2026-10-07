// Reportes de inventario (Administrador y Auditor: todas las tiendas; Gerente: solo la suya)
const express = require('express');
const productos = require('../services/productos');
const { TIENDAS, esTiendaValida } = require('../config/tiendas');
const { autenticar, requierePermiso, negarSiOtraTienda } = require('../middleware/autenticacion');

const router = express.Router();
const STOCK_BAJO = 5; // un producto con menos de 5 unidades se reporta como "stock bajo"

// Resume los productos de una tienda: cantidad, unidades, valor y stock bajo
function resumir(idTienda, items) {
  const tienda = TIENDAS.find((t) => t.id === idTienda);
  return {
    tienda: idTienda,
    nombre: tienda ? tienda.nombre : idTienda,
    productos: items.length,
    unidades: items.reduce((s, p) => s + (p.stock || 0), 0),
    valor: Math.round(items.reduce((s, p) => s + (p.precio || 0) * (p.stock || 0), 0) * 100) / 100,
    stockBajo: items
      .filter((p) => (p.stock || 0) < STOCK_BAJO)
      .map((p) => ({ nombre: p.nombre, stock: p.stock })),
  };
}

// GET /api/reportes?tienda=xxx
router.get('/', autenticar, requierePermiso('reportes:ver'), async (req, res) => {
  const u = req.usuario;
  let tiendas;
  if (u.alcance === 'todas') {
    if (req.query.tienda && !esTiendaValida(req.query.tienda)) return res.status(400).json({ error: 'Tienda no válida.' });
    tiendas = req.query.tienda ? [req.query.tienda] : TIENDAS.map((t) => t.id);
  } else {
    // El Gerente solo ve el reporte de su tienda
    if (req.query.tienda && negarSiOtraTienda(req, res, req.query.tienda)) return;
    if (!u.tienda) return res.status(403).json({ error: 'No tienes una tienda asignada.' });
    tiendas = [u.tienda];
  }

  try {
    const resumenes = await Promise.all(
      tiendas.map(async (t) => resumir(t, await productos.listarPorTienda(t)))
    );
    const totales = resumenes.reduce(
      (acc, r) => ({
        productos: acc.productos + r.productos,
        unidades: acc.unidades + r.unidades,
        valor: Math.round((acc.valor + r.valor) * 100) / 100,
        stockBajo: acc.stockBajo + r.stockBajo.length,
      }),
      { productos: 0, unidades: 0, valor: 0, stockBajo: 0 }
    );
    res.json({ generado: new Date().toISOString(), generadoPor: u.email, umbralStockBajo: STOCK_BAJO, totales, tiendas: resumenes });
  } catch (err) {
    console.error('[reportes]', err.name, err.message);
    res.status(500).json({ error: 'No se pudo generar el reporte.' });
  }
});

module.exports = router;
