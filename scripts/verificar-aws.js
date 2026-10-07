// Verifica la configuración de AWS y del .env con las credenciales de la app.
// No imprime ninguna clave y no crea, borra ni modifica nada: las pruebas de permisos
// usan peticiones inválidas a propósito, que AWS rechaza ANTES de hacer cualquier cambio.
// Uso: npm run verificar
const config = require('../src/config/env');
const C = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { PRIORIDAD } = require('../src/config/permisos');

const cognito = new C.CognitoIdentityProviderClient({ region: config.aws.region });
const POOL = config.cognito.userPoolId;
let fallos = 0;

function resultado(ok, titulo, detalle, ayuda) {
  if (!ok) fallos++;
  console.log(`${ok ? '✅' : '❌'} ${titulo}${detalle ? ': ' + detalle : ''}`);
  if (!ok && ayuda) console.log(`   → ${ayuda}`);
}

// Ejecuta una prueba y devuelve el nombre del error de AWS (o 'OK')
async function errorDe(promesa) {
  try {
    await promesa;
    return 'OK';
  } catch (err) {
    return err.name;
  }
}

// --- 1. Variables del .env (solo se revisa que existan y su largo, nunca se muestran) ---
function verificarEnv() {
  console.log('\n— Variables del .env —');
  const hex64 = (v) => /^[0-9a-f]{64}$/i.test(process.env[v] || '');
  for (const v of ['SESSION_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID', 'COGNITO_DOMAIN', 'COGNITO_REDIRECT_URI']) {
    resultado(Boolean(process.env[v]), v, process.env[v] ? 'presente' : 'vacía', 'Complétala en el .env');
  }
  for (const v of ['APP_JWT_SECRET', 'MFA_SOCIAL_CLAVE']) {
    resultado(hex64(v), v, hex64(v) ? '64 caracteres hex' : 'vacía o con formato incorrecto', 'Genera una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  for (const v of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
    resultado(Boolean(process.env[v]), v, process.env[v] ? 'presente' : 'vacía', 'Cópiala de tu OAuth App en GitHub → Settings → Developer settings');
  }
}

// --- 2. Cognito: grupos, usuarios por rol y atributos ---
async function verificarCognito() {
  console.log('\n— Cognito —');
  const grupos = (await cognito.send(new C.ListGroupsCommand({ UserPoolId: POOL }))).Groups.map((g) => g.GroupName);
  const faltan = PRIORIDAD.filter((g) => !grupos.includes(g));
  resultado(!faltan.length, 'Grupos (roles)', faltan.length ? `faltan ${faltan.join(', ')}` : grupos.join(', '));

  for (const rol of PRIORIDAD) {
    const r = await cognito.send(new C.ListUsersInGroupCommand({ UserPoolId: POOL, GroupName: rol }));
    resultado(r.Users.length > 0, `Usuarios con rol ${rol}`, String(r.Users.length), `Registra un usuario y asígnale ${rol} desde Panel → Usuarios`);
  }

  // Si el atributo existe, Cognito responde "usuario no existe"; si no existe, "no está en el esquema"
  const prueba = (atributo) =>
    errorDe(cognito.send(new C.AdminUpdateUserAttributesCommand({
      UserPoolId: POOL,
      Username: 'verificacion-usuario-inexistente',
      UserAttributes: [{ Name: atributo, Value: 'x' }],
    })));
  for (const atributo of ['custom:tienda', 'custom:mfa_social']) {
    const e = await prueba(atributo);
    resultado(e === 'UserNotFoundException', `Atributo ${atributo}`, e === 'UserNotFoundException' ? 'existe' : 'no existe',
      'Cognito → Autenticación → Registro → Atributos personalizados → Agregar (String, mutable, máx. 512)');
  }
}

// --- 3. Permisos IAM para el login social (peticiones inválidas: no cambian nada) ---
async function verificarIam() {
  console.log('\n— Permisos IAM del usuario techstore-app —');
  const pruebas = {
    AdminCreateUser: new C.AdminCreateUserCommand({ UserPoolId: POOL, Username: '' }),
    AdminDeleteUser: new C.AdminDeleteUserCommand({ UserPoolId: POOL, Username: '' }),
    AdminLinkProviderForUser: new C.AdminLinkProviderForUserCommand({
      UserPoolId: POOL,
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: '' },
      SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: '' },
    }),
  };
  for (const [accion, comando] of Object.entries(pruebas)) {
    const e = await errorDe(cognito.send(comando));
    resultado(e !== 'AccessDeniedException', `cognito-idp:${accion}`, e === 'AccessDeniedException' ? 'sin permiso' : 'permitido',
      'IAM → Usuarios → techstore-app → TechStoreAppPolicy → agrega la acción (ver README)');
  }
}

// --- 4. Hosted UI: scopes y proveedor Google ---
async function verificarHostedUi() {
  console.log('\n— Hosted UI y Google —');
  const autorizar = async (extra) => {
    const url = new URL('/oauth2/authorize', config.cognito.domain);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.cognito.clientId,
      redirect_uri: config.cognito.redirectUri,
      state: 'verificacion',
      ...extra,
    }).toString();
    const r = await fetch(url, { redirect: 'manual' });
    return r.headers.get('location') || '';
  };
  const scopes = await autorizar({ scope: 'openid email profile' });
  resultado(!scopes.includes('error='), 'Scopes openid email profile', scopes.includes('error=') ? 'Cognito los rechaza (invalid_scope)' : 'aceptados',
    'App client → Páginas de inicio de sesión → Editar → marca el scope "profile" (además de openid y email)');
  const google = await autorizar({ scope: 'openid email', identity_provider: 'Google' });
  const ok = google.startsWith('https://accounts.google.com');
  resultado(ok, 'Proveedor Google habilitado', ok ? 'redirige a Google' : 'no redirige a Google',
    'Agrega Google en Cognito → Proveedores sociales y externos, y márcalo en el App client');
}

// --- 5. DynamoDB ---
async function verificarDynamo() {
  console.log('\n— DynamoDB —');
  const dynamo = new DynamoDBClient({ region: config.aws.region });
  const r = await dynamo.send(new ScanCommand({ TableName: config.dynamoTable, Select: 'COUNT' }));
  resultado(r.Count > 0, `Tabla ${config.dynamoTable}`, `${r.Count} producto(s)`, 'Carga productos de ejemplo con: npm run semilla');
}

(async () => {
  verificarEnv();
  for (const paso of [verificarCognito, verificarIam, verificarHostedUi, verificarDynamo]) {
    try {
      await paso();
    } catch (err) {
      resultado(false, paso.name, `${err.name}`);
    }
  }
  console.log(fallos ? `\n${fallos} punto(s) por resolver.` : '\nTodo listo ✅');
})();
