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

module.exports = { validarPassword, validarEmail, ESPECIALES };
