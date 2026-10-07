// Middleware de seguridad:
// 1) autenticar: valida el JWT de Cognito (firma, expiración, emisor y App Client)
// 2) requierePermiso: revisa que el ROL del usuario tenga la acción pedida
// 3) puedeAccederTienda: revisa que la TIENDA pedida sea la del usuario (si su alcance es "propia")
const jwt = require('../services/jwt');
const { DESCRIPCION, rolPrincipal, permisosDe } = require('../config/permisos');

// Toma el token del header "Authorization: Bearer <token>" o de la cookie httpOnly
function extraerToken(req) {
  const cabecera = req.headers.authorization || '';
  if (cabecera.startsWith('Bearer ')) return cabecera.slice(7);
  return req.cookies[jwt.COOKIE_ID];
}

async function autenticar(req, res, next) {
  const token = extraerToken(req);
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión.' });

  let claims;
  try {
    claims = await jwt.verificarIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Tu sesión no es válida o expiró. Inicia sesión de nuevo.' });
  }

  // req.usuario queda disponible para las rutas siguientes
  const usuario = jwt.datosUsuario(claims);
  usuario.rol = rolPrincipal(usuario.grupos);
  const { alcance, acciones } = permisosDe(usuario.rol);
  usuario.alcance = alcance;
  usuario.permisos = acciones;
  req.usuario = usuario;
  next();
}

// Registra en consola cada acceso denegado (rastro de auditoría)
function registrarDenegado(req, motivo) {
  const u = req.usuario || {};
  console.warn(`[403] ${u.email} (${u.rol || 'sin rol'}) ${req.method} ${req.originalUrl} -> ${motivo}`);
}

// Fábrica de middleware: requierePermiso('productos:eliminar')
function requierePermiso(accion) {
  return (req, res, next) => {
    if (req.usuario.permisos.includes(accion)) return next();
    registrarDenegado(req, accion);
    res.status(403).json({
      error: `Tu rol (${req.usuario.rol || 'sin rol'}) no tiene permiso para ${DESCRIPCION[accion]}.`,
      permiso: accion,
    });
  };
}

// ¿Puede el usuario trabajar con esta tienda?
function puedeAccederTienda(usuario, tienda) {
  if (usuario.alcance === 'todas') return true;
  return usuario.alcance === 'propia' && Boolean(usuario.tienda) && usuario.tienda === tienda;
}

// Responde 403 si la tienda no es la del usuario. Devuelve true si se negó.
function negarSiOtraTienda(req, res, tienda) {
  if (puedeAccederTienda(req.usuario, tienda)) return false;
  registrarDenegado(req, `tienda ${tienda}`);
  res.status(403).json({
    error: `Solo puedes gestionar productos de tu tienda (${req.usuario.tienda || 'sin tienda asignada'}).`,
  });
  return true;
}

module.exports = { autenticar, requierePermiso, puedeAccederTienda, negarSiOtraTienda };
