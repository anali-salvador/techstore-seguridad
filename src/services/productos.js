// Acceso a la tabla de productos en DynamoDB.
// Clave de la tabla: tienda (partición) + productoId (ordenación).
const { randomUUID } = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const config = require('../config/env');

// DocumentClient convierte automáticamente entre objetos JS y el formato de DynamoDB
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.aws.region }));
const TABLA = config.dynamoTable;

// Productos de UNA tienda (Query por clave de partición: rápido y no lee otras tiendas)
async function listarPorTienda(tienda) {
  const items = [];
  let inicio;
  do {
    const r = await db.send(
      new QueryCommand({
        TableName: TABLA,
        KeyConditionExpression: 'tienda = :t',
        ExpressionAttributeValues: { ':t': tienda },
        ExclusiveStartKey: inicio,
      })
    );
    items.push(...r.Items);
    inicio = r.LastEvaluatedKey; // DynamoDB devuelve los resultados por páginas
  } while (inicio);
  return items;
}

// Productos de TODAS las tiendas (Scan: solo para Administrador y Auditor)
async function listarTodos() {
  const items = [];
  let inicio;
  do {
    const r = await db.send(new ScanCommand({ TableName: TABLA, ExclusiveStartKey: inicio }));
    items.push(...r.Items);
    inicio = r.LastEvaluatedKey;
  } while (inicio);
  return items;
}

// Crea un producto nuevo con un ID único
async function crear(datos, usuarioEmail) {
  const ahora = new Date().toISOString();
  const item = {
    ...datos,
    productoId: randomUUID(),
    creadoPor: usuarioEmail,
    creadoEn: ahora,
    actualizadoPor: usuarioEmail,
    actualizadoEn: ahora,
  };
  await db.send(
    new PutCommand({
      TableName: TABLA,
      Item: item,
      ConditionExpression: 'attribute_not_exists(productoId)', // nunca sobrescribe uno existente
    })
  );
  return item;
}

// Actualiza solo los campos enviados. Falla si el producto no existe.
async function actualizar(tienda, productoId, campos, usuarioEmail) {
  const cambios = { ...campos, actualizadoPor: usuarioEmail, actualizadoEn: new Date().toISOString() };
  const nombres = {};
  const valores = {};
  const sets = Object.entries(cambios).map(([campo, valor], i) => {
    nombres[`#c${i}`] = campo;
    valores[`:v${i}`] = valor;
    return `#c${i} = :v${i}`;
  });

  const r = await db.send(
    new UpdateCommand({
      TableName: TABLA,
      Key: { tienda, productoId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: nombres,
      ExpressionAttributeValues: valores,
      ConditionExpression: 'attribute_exists(productoId)',
      ReturnValues: 'ALL_NEW',
    })
  );
  return r.Attributes;
}

async function eliminar(tienda, productoId) {
  await db.send(
    new DeleteCommand({
      TableName: TABLA,
      Key: { tienda, productoId },
      ConditionExpression: 'attribute_exists(productoId)',
    })
  );
}

module.exports = { listarPorTienda, listarTodos, crear, actualizar, eliminar };
