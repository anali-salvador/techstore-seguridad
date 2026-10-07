// Validaciones del registro. Son las mismas reglas que configuramos en Cognito,
// así el usuario recibe el error antes de llegar a AWS.

// Caracteres especiales que Cognito acepta en una contraseña
const ESPECIALES = /[\^$*.[\]{}()?\-"!@#%&/\\,><':;|_~`+=]/;

// Devuelve la lista de reglas que la contraseña NO cumple (vacía = válida)
function validarPassword(password = '') {
  const errores = [];
  if (password.length < 8) errores.push('mínimo 8 caracteres');
  if (!/[A-Z]/.test(password)) errores.push('al menos una mayúscula');
  if (!/[0-9]/.test(password)) errores.push('al menos un número');
  if (!ESPECIALES.test(password)) errores.push('al menos un carácter especial');
  return errores;
}

function validarEmail(email = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Valida los campos de un producto. Solo copia los campos permitidos
// (así nadie puede colar campos extra como "creadoPor" en DynamoDB).
// parcial = true -> solo valida los campos que vienen (para editar)
function validarProducto(datos = {}, parcial = false) {
  const errores = [];
  const campos = {};
  const viene = (c) => datos[c] !== undefined && datos[c] !== '';

  if (viene('nombre') || !parcial) {
    const nombre = String(datos.nombre || '').trim();
    if (nombre.length < 2 || nombre.length > 80) errores.push('el nombre debe tener entre 2 y 80 caracteres');
    else campos.nombre = nombre;
  }
  if (viene('categoria') || !parcial) {
    const categoria = String(datos.categoria || '').trim();
    if (categoria.length < 2 || categoria.length > 40) errores.push('la categoría debe tener entre 2 y 40 caracteres');
    else campos.categoria = categoria;
  }
  if (viene('precio') || !parcial) {
    const precio = Number(datos.precio);
    if (!Number.isFinite(precio) || precio < 0 || precio > 1000000) errores.push('el precio debe ser un número entre 0 y 1 000 000');
    else campos.precio = Math.round(precio * 100) / 100; // 2 decimales
  }
  if (viene('stock') || !parcial) {
    const stock = Number(datos.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) errores.push('el stock debe ser un número entero entre 0 y 1 000 000');
    else campos.stock = stock;
  }
  return { errores, campos };
}

module.exports = { validarPassword, validarEmail, validarProducto, ESPECIALES };
