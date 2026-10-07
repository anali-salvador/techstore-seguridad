// Matriz de permisos de TechStore: qué puede hacer cada rol (grupo de Cognito).
// Es la ÚNICA fuente de verdad: el middleware la usa para permitir o negar (403)
// y el dashboard la recibe para mostrar u ocultar botones.

const ROLES = {
  ADMIN: 'Administrador',
  GERENTE: 'GerenteTienda',
  EMPLEADO: 'EmpleadoVentas',
  AUDITOR: 'Auditor',
};

// Si un usuario estuviera en varios grupos, manda el de mayor jerarquía
// (igual que la "precedencia" configurada en Cognito)
const PRIORIDAD = [ROLES.ADMIN, ROLES.GERENTE, ROLES.EMPLEADO, ROLES.AUDITOR];

// alcance: 'todas' = cualquier tienda | 'propia' = solo la tienda de su custom:tienda
const PERMISOS = {
  [ROLES.ADMIN]: {
    alcance: 'todas',
    acciones: [
      'productos:ver', 'productos:crear', 'productos:editar', 'productos:precio',
      'productos:stock', 'productos:eliminar', 'reportes:ver', 'usuarios:gestionar',
    ],
  },
  [ROLES.GERENTE]: {
    alcance: 'propia',
    acciones: [
      'productos:ver', 'productos:crear', 'productos:editar', 'productos:precio',
      'productos:stock', 'productos:eliminar', 'reportes:ver',
    ],
  },
  [ROLES.EMPLEADO]: {
    alcance: 'propia',
    acciones: ['productos:ver', 'productos:stock'], // NO puede modificar precios
  },
  [ROLES.AUDITOR]: {
    alcance: 'todas',
    acciones: ['productos:ver', 'reportes:ver'], // solo lectura
  },
};

// Texto legible de cada acción (para los mensajes 403)
const DESCRIPCION = {
  'productos:ver': 'ver productos',
  'productos:crear': 'crear productos',
  'productos:editar': 'editar productos',
  'productos:precio': 'modificar precios',
  'productos:stock': 'actualizar stock',
  'productos:eliminar': 'eliminar productos',
  'reportes:ver': 'ver reportes',
  'usuarios:gestionar': 'gestionar usuarios y roles',
};

// Rol principal de un usuario a partir de sus grupos de Cognito
function rolPrincipal(grupos = []) {
  return PRIORIDAD.find((rol) => grupos.includes(rol)) || null;
}

function permisosDe(rol) {
  return PERMISOS[rol] || { alcance: 'ninguna', acciones: [] };
}

module.exports = { ROLES, PRIORIDAD, PERMISOS, DESCRIPCION, rolPrincipal, permisosDe };
