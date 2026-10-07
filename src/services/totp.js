// TOTP (RFC 6238) implementado con el módulo crypto de Node, sin librerías extra.
// Se usa para el MFA de los logins sociales (Google y GitHub), porque Cognito
// no aplica su propio MFA a usuarios que entran con un proveedor externo.
// Es el mismo algoritmo que usa Google Authenticator: HMAC-SHA1, 6 dígitos, 30 segundos.
const crypto = require('crypto');

const PERIODO = 30; // segundos que dura cada código
const DIGITOS = 6;
const VENTANA = 1; // acepta el código anterior y el siguiente (por desfase de reloj)
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // Base32 (formato de las claves TOTP)

// Bytes -> texto Base32 (así se muestra la clave en el QR)
function aBase32(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let texto = '';
  for (let i = 0; i < bits.length; i += 5) texto += ALFABETO[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return texto;
}

// Texto Base32 -> bytes
function desdeBase32(texto) {
  let bits = '';
  for (const c of texto.replace(/=+$/, '').toUpperCase()) {
    const valor = ALFABETO.indexOf(c);
    if (valor < 0) throw new Error('Clave Base32 no válida');
    bits += valor.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// Nueva clave secreta aleatoria de 160 bits (20 bytes), como recomienda el RFC
function generarSecreto() {
  return aBase32(crypto.randomBytes(20));
}

// Código de 6 dígitos para un "paso" de tiempo (paso = segundos / 30)
function codigoEnPaso(secreto, paso) {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(paso));
  const hmac = crypto.createHmac('sha1', desdeBase32(secreto)).update(mensaje).digest();
  // "Truncamiento dinámico" del RFC 4226: se toman 4 bytes según el último nibble
  const inicio = hmac[hmac.length - 1] & 0x0f;
  const numero = hmac.readUInt32BE(inicio) & 0x7fffffff;
  return String(numero % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

// Compara dos textos en tiempo constante (evita ataques que miden cuánto tarda la comparación)
function igualSeguro(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Pasos ya usados por cada usuario: un mismo código no se puede usar dos veces (anti-repetición)
const ultimoPasoUsado = new Map();

// Verifica un código. Devuelve true solo si es válido y no fue usado antes.
function verificarCodigo(secreto, codigo, idUsuario, ahora = Date.now()) {
  if (!/^\d{6}$/.test(codigo)) return false;
  const pasoActual = Math.floor(ahora / 1000 / PERIODO);
  for (let desfase = -VENTANA; desfase <= VENTANA; desfase++) {
    const paso = pasoActual + desfase;
    if (igualSeguro(codigoEnPaso(secreto, paso), codigo)) {
      if (paso <= (ultimoPasoUsado.get(idUsuario) || 0)) return false; // código repetido
      ultimoPasoUsado.set(idUsuario, paso);
      return true;
    }
  }
  return false;
}

// URI "otpauth://" que se convierte en QR para Google Authenticator
function uriOtpauth(secreto, cuenta, emisor) {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  return `otpauth://totp/${etiqueta}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PERIODO}`;
}

module.exports = { generarSecreto, verificarCodigo, uriOtpauth, codigoEnPaso, aBase32 };
