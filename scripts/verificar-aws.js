// Verifica que la configuración de AWS (Fase 2) funcione con las credenciales del .env.
// No imprime ninguna clave: solo muestra si cada recurso responde o no.
const config = require('../src/config/env');
const { CognitoIdentityProviderClient, ListGroupsCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const GRUPOS_ESPERADOS = ['Administrador', 'GerenteTienda', 'EmpleadoVentas', 'Auditor'];

async function verificarGrupos() {
  const cognito = new CognitoIdentityProviderClient({ region: config.aws.region });
  const res = await cognito.send(new ListGroupsCommand({ UserPoolId: config.cognito.userPoolId }));
  const nombres = (res.Groups || []).map((g) => g.GroupName);
  const faltan = GRUPOS_ESPERADOS.filter((g) => !nombres.includes(g));
  if (faltan.length) throw new Error(`faltan grupos: ${faltan.join(', ')}`);
  return `grupos encontrados: ${nombres.join(', ')}`;
}

async function verificarTabla() {
  const dynamo = new DynamoDBClient({ region: config.aws.region });
  const res = await dynamo.send(new ScanCommand({ TableName: config.dynamoTable, Limit: 1 }));
  return `tabla "${config.dynamoTable}" accesible (${res.Count} producto(s) leído(s) de prueba)`;
}

(async () => {
  for (const [nombre, prueba] of [['Cognito', verificarGrupos], ['DynamoDB', verificarTabla]]) {
    try {
      console.log(`✅ ${nombre}: ${await prueba()}`);
    } catch (err) {
      console.log(`❌ ${nombre}: ${err.name} - ${err.message}`);
    }
  }
})();
