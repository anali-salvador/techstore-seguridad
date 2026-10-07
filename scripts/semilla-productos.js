// Carga productos de ejemplo en DynamoDB (3 tiendas) para probar el inventario.
// Usa IDs fijos ("demo-..."): si se ejecuta dos veces, actualiza los mismos productos (no duplica).
// Uso: npm run semilla
const config = require('../src/config/env');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.aws.region }));

const PRODUCTOS = {
  'lima-centro': [
    ['Laptop Lenovo IdeaPad 3', 'Laptops', 2499.9, 12],
    ['Mouse inalámbrico Logitech M185', 'Accesorios', 59.9, 40],
    ['Monitor Samsung 24"', 'Monitores', 649, 3],
    ['Teclado mecánico Redragon', 'Accesorios', 179, 18],
  ],
  arequipa: [
    ['Laptop HP 15', 'Laptops', 2299, 7],
    ['Audífonos Sony WH-CH520', 'Audio', 229, 2],
    ['Disco SSD Kingston 1 TB', 'Almacenamiento', 289.5, 25],
  ],
  trujillo: [
    ['Impresora Epson EcoTank L3250', 'Impresoras', 799, 4],
    ['Router TP-Link Archer C6', 'Redes', 169, 15],
    ['Memoria USB SanDisk 64 GB', 'Almacenamiento', 35, 60],
  ],
};

(async () => {
  const ahora = new Date().toISOString();
  let total = 0;
  for (const [tienda, lista] of Object.entries(PRODUCTOS)) {
    for (const [i, [nombre, categoria, precio, stock]] of lista.entries()) {
      const item = {
        tienda,
        productoId: `demo-${tienda}-${String(i + 1).padStart(2, '0')}`,
        nombre,
        categoria,
        precio,
        stock,
        creadoPor: 'semilla',
        creadoEn: ahora,
        actualizadoPor: 'semilla',
        actualizadoEn: ahora,
      };
      await db.send(new PutCommand({ TableName: config.dynamoTable, Item: item }));
      total++;
    }
    console.log(`✅ ${tienda}: ${lista.length} productos`);
  }
  console.log(`Listo: ${total} productos en la tabla "${config.dynamoTable}".`);
})().catch((err) => {
  console.error('❌ No se pudo cargar la semilla:', err.name, err.message);
  process.exit(1);
});
