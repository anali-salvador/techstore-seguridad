// Cifrado AES-256-GCM para guardar la clave TOTP de los usuarios sociales.
// La clave TOTP se guarda en Cognito (atributo custom:mfa_social) CIFRADA:
// aunque alguien leyera los datos de Cognito, sin MFA_SOCIAL_CLAVE (que solo
// está en el .env del servidor) no podría generar códigos.
// GCM además detecta si el texto cifrado fue modificado (autenticación).
const crypto = require('crypto');
const config = require('../config/env');

function obtenerClave() {
  const clave = Buffer.from(config.mfaSocialClave || '', 'hex');
  if (clave.length !== 32) throw new Error('MFA_SOCIAL_CLAVE debe tener 64 caracteres hexadecimales (32 bytes).');
  return clave;
}

// Texto -> "iv.etiqueta.cifrado" (todo en base64url)
function cifrar(texto) {
  const iv = crypto.randomBytes(12); // vector inicial distinto en cada cifrado
  const cifrador = crypto.createCipheriv('aes-256-gcm', obtenerClave(), iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  const etiqueta = cifrador.getAuthTag();
  return [iv, etiqueta, cifrado].map((b) => b.toString('base64url')).join('.');
}

// "iv.etiqueta.cifrado" -> texto. Lanza error si fue alterado o la clave no coincide.
function descifrar(paquete) {
  const [iv, etiqueta, cifrado] = String(paquete).split('.').map((p) => Buffer.from(p, 'base64url'));
  const descifrador = crypto.createDecipheriv('aes-256-gcm', obtenerClave(), iv);
  descifrador.setAuthTag(etiqueta);
  return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
}

module.exports = { cifrar, descifrar };
