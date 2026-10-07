// Contador de intentos fallidos por cuenta (correo).
// Se guarda en la memoria del servidor, no en el navegador: así el usuario
// no puede "reiniciar" el contador borrando cookies o abriendo otra pestaña.
// Nota: se reinicia si el servidor se reinicia (suficiente para el lab).

class ContadorIntentos {
  constructor(maximo, minutosBloqueo) {
    this.maximo = maximo;
    this.msBloqueo = minutosBloqueo * 60 * 1000;
    this.registros = new Map(); // correo -> { fallidos, bloqueadoHasta }
  }

  // Devuelve cómo va la cuenta: fallidos, restantes y si está bloqueada
  estado(clave) {
    const r = this.registros.get(clave);
    // Si el bloqueo ya venció, se borra el registro y la cuenta queda limpia
    if (r && r.bloqueadoHasta && Date.now() >= r.bloqueadoHasta) {
      this.registros.delete(clave);
      return this.estado(clave);
    }
    const fallidos = r ? r.fallidos : 0;
    const bloqueado = Boolean(r && r.bloqueadoHasta);
    return {
      fallidos,
      maximo: this.maximo,
      restantes: Math.max(this.maximo - fallidos, 0),
      bloqueado,
      segundosBloqueo: bloqueado ? Math.ceil((r.bloqueadoHasta - Date.now()) / 1000) : 0,
    };
  }

  // Suma un intento fallido; al llegar al máximo, bloquea la cuenta
  registrarFallo(clave) {
    const r = this.registros.get(clave) || { fallidos: 0, bloqueadoHasta: null };
    r.fallidos += 1;
    if (r.fallidos >= this.maximo) r.bloqueadoHasta = Date.now() + this.msBloqueo;
    this.registros.set(clave, r);
    return this.estado(clave);
  }

  // Login correcto: el contador vuelve a cero
  reiniciar(clave) {
    this.registros.delete(clave);
  }
}

module.exports = ContadorIntentos;
