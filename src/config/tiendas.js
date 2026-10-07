// Lista fija de tiendas de TechStore.
// "id" es el valor que se guarda en custom:tienda; "nombre" es el que ve el usuario.
const TIENDAS = [
  { id: 'lima-centro', nombre: 'Tienda Lima Centro' },
  { id: 'arequipa', nombre: 'Tienda Arequipa' },
  { id: 'trujillo', nombre: 'Tienda Trujillo' },
];

const esTiendaValida = (id) => TIENDAS.some((t) => t.id === id);

module.exports = { TIENDAS, esTiendaValida };
