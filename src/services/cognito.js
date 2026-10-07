// Funciones para hablar con Amazon Cognito usando el SDK de AWS v3.
const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  InitiateAuthCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  RespondToAuthChallengeCommand,
  GlobalSignOutCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminLinkProviderForUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const config = require('../config/env');

// El cliente toma las credenciales IAM del .env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
const cognito = new CognitoIdentityProviderClient({ region: config.aws.region });
const { userPoolId, clientId } = config.cognito;

// Rol que recibe todo usuario nuevo (el de menos privilegios de modificación)
const GRUPO_POR_DEFECTO = config.rolPorDefecto; // EmpleadoVentas

// 1) Registro público: correo, contraseña y nombre (usa los permisos del App Client)
async function registrarUsuario({ email, password, nombre }) {
  return cognito.send(
    new SignUpCommand({
      ClientId: clientId,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'name', Value: nombre },
      ],
    })
  );
}

// 2) Solo el servidor (con IAM) puede asignar la tienda y el rol.
//    El App Client no tiene permiso de escritura sobre custom:tienda.
async function asignarTiendaYRol(email, tienda) {
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: email,
      UserAttributes: [{ Name: 'custom:tienda', Value: tienda }],
    })
  );
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: GRUPO_POR_DEFECTO,
    })
  );
}

// 3) Confirma la cuenta con el código de 6 dígitos que llegó al correo
async function confirmarRegistro(email, codigo) {
  return cognito.send(
    new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: codigo })
  );
}

// Reenvía el código de verificación al correo
async function reenviarCodigo(email) {
  return cognito.send(new ResendConfirmationCodeCommand({ ClientId: clientId, Username: email }));
}

// 4) Login con correo y contraseña (flujo USER_PASSWORD_AUTH).
//    Como el MFA es obligatorio, Cognito NO devuelve el JWT aquí: devuelve un
//    "reto" (ChallengeName) y una Session temporal para continuar con el MFA.
async function iniciarSesion(email, password) {
  return cognito.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    })
  );
}

// ----- MFA TOTP -----

// 5a) Primer login (reto MFA_SETUP): Cognito genera la clave secreta TOTP del usuario.
//     Devuelve SecretCode (va dentro del QR) y una Session nueva.
async function asociarTotp(session) {
  return cognito.send(new AssociateSoftwareTokenCommand({ Session: session }));
}

// 5b) Comprueba el primer código de Google Authenticator y activa el MFA TOTP.
async function verificarTotp(session, codigo) {
  return cognito.send(
    new VerifySoftwareTokenCommand({
      Session: session,
      UserCode: codigo,
      FriendlyDeviceName: 'Google Authenticator',
    })
  );
}

// 5c) Termina el reto MFA_SETUP y obtiene los JWT
async function completarConfiguracionMfa(session, email) {
  return cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'MFA_SETUP',
      Session: session,
      ChallengeResponses: { USERNAME: email },
    })
  );
}

// 6) Logins siguientes (reto SOFTWARE_TOKEN_MFA): envía el código de 6 dígitos
async function responderCodigoMfa(session, email, codigo) {
  return cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: session,
      ChallengeResponses: { USERNAME: email, SOFTWARE_TOKEN_MFA_CODE: codigo },
    })
  );
}

// 7) Cierre de sesión global: Cognito invalida los tokens de ese usuario
async function cerrarSesionGlobal(accessToken) {
  return cognito.send(new GlobalSignOutCommand({ AccessToken: accessToken }));
}

// ----- Administración de usuarios (solo con credenciales IAM del servidor) -----

// Lee un atributo de la lista que devuelve Cognito: [{ Name, Value }, ...]
const atributo = (lista = [], nombre) => (lista.find((a) => a.Name === nombre) || {}).Value;

// Lista todos los usuarios del User Pool con su rol (grupo) y tienda
async function listarUsuarios(grupos) {
  // 1) Qué usuarios hay en cada grupo (una llamada por grupo)
  const rolDe = {};
  for (const grupo of grupos) {
    let token;
    do {
      const r = await cognito.send(
        new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: grupo, NextToken: token })
      );
      for (const u of r.Users) if (!rolDe[u.Username]) rolDe[u.Username] = grupo; // grupos en orden de prioridad
      token = r.NextToken;
    } while (token);
  }

  // 2) Todos los usuarios con sus atributos
  const usuarios = [];
  let pagina;
  do {
    const r = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId, PaginationToken: pagina }));
    for (const u of r.Users) {
      usuarios.push({
        username: u.Username,
        email: atributo(u.Attributes, 'email'),
        nombre: atributo(u.Attributes, 'name'),
        tienda: atributo(u.Attributes, 'custom:tienda') || null,
        rol: rolDe[u.Username] || null,
        estado: u.UserStatus, // CONFIRMED, UNCONFIRMED, EXTERNAL_PROVIDER...
        habilitado: u.Enabled,
        creado: u.UserCreateDate,
      });
    }
    pagina = r.PaginationToken;
  } while (pagina);
  return usuarios;
}

// Deja al usuario en UN solo grupo: lo saca de los demás y lo agrega al nuevo
async function cambiarRol(username, nuevoRol) {
  const actuales = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username })
  );
  for (const g of actuales.Groups) {
    if (g.GroupName !== nuevoRol) {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: g.GroupName })
      );
    }
  }
  await cognito.send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: nuevoRol })
  );
}

// Cambia la tienda (custom:tienda) de un usuario
async function cambiarTienda(username, tienda) {
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: username,
      UserAttributes: [{ Name: 'custom:tienda', Value: tienda }],
    })
  );
}

// Habilita o deshabilita la cuenta (un usuario deshabilitado no puede iniciar sesión)
async function cambiarEstado(username, habilitado) {
  const Comando = habilitado ? AdminEnableUserCommand : AdminDisableUserCommand;
  await cognito.send(new Comando({ UserPoolId: userPoolId, Username: username }));
}

// ----- Login social (Google y GitHub) -----

// Datos completos de un usuario: atributos, grupos y si está habilitado
async function obtenerUsuario(username) {
  const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
  const g = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }));
  return {
    username: u.Username,
    email: atributo(u.UserAttributes, 'email'),
    emailVerificado: atributo(u.UserAttributes, 'email_verified') === 'true',
    nombre: atributo(u.UserAttributes, 'name'),
    tienda: atributo(u.UserAttributes, 'custom:tienda') || null,
    secretoMfaSocial: atributo(u.UserAttributes, 'custom:mfa_social') || null, // cifrado
    grupos: g.Groups.map((x) => x.GroupName),
    estado: u.UserStatus,
    habilitado: u.Enabled,
  };
}

// Busca usuarios por correo (puede haber más de uno: el nativo y el federado de Google)
async function buscarPorEmail(email) {
  // El correo ya viene validado; se rechazan comillas para no romper el filtro de Cognito
  if (!/^[^"\\\s]+@[^"\\\s]+$/.test(email)) return [];
  const r = await cognito.send(
    new ListUsersCommand({ UserPoolId: userPoolId, Filter: `email = "${email}"`, Limit: 10 })
  );
  return r.Users.map((u) => ({
    username: u.Username,
    estado: u.UserStatus,
    emailVerificado: atributo(u.Attributes, 'email_verified') === 'true',
  }));
}

// Si el usuario no tiene rol o tienda, le asigna los valores por defecto
// (igual que el registro normal: EmpleadoVentas y lima-centro)
async function asignarValoresPorDefecto(usuario, rol, tienda) {
  if (!usuario.tienda) await cambiarTienda(usuario.username, tienda);
  if (!usuario.grupos.length) {
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: usuario.username, GroupName: rol })
    );
  }
  return !usuario.tienda || !usuario.grupos.length; // true = hubo cambios
}

// Crea en Cognito el registro de un usuario de GitHub (para que el Administrador
// pueda gestionar su rol y tienda igual que los demás). No se le envía ningún correo
// y no tiene una contraseña que conozca: solo puede entrar con GitHub.
async function crearUsuarioGithub({ email, nombre, tienda }) {
  const r = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' }, // GitHub ya verificó este correo
        { Name: 'name', Value: nombre },
        { Name: 'custom:tienda', Value: tienda },
      ],
    })
  );
  return r.User.Username;
}

// Vincula la identidad de Google a un usuario nativo que ya existe con el mismo correo.
// Cognito crea automáticamente un usuario "google_<id>" en el primer login con Google;
// para vincular hay que borrar ese usuario duplicado y luego enlazar la identidad.
async function vincularGoogle(usernameFederado, googleUserId, usernameNativo) {
  // Seguridad: solo se borra un usuario si de verdad es el duplicado creado por Google
  const federado = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: usernameFederado }));
  if (federado.UserStatus !== 'EXTERNAL_PROVIDER' || !usernameFederado.startsWith('google_')) {
    throw new Error('El usuario a reemplazar no es un usuario federado de Google');
  }
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: usernameFederado }));
  await cognito.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: userPoolId,
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: usernameNativo },
      SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: googleUserId },
    })
  );
}

// Pide tokens nuevos con el refresh token (para que el ID token incluya el grupo y la tienda recién asignados)
async function refrescarTokens(refreshToken) {
  const r = await cognito.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    })
  );
  return r.AuthenticationResult;
}

// Guarda la clave TOTP social (ya cifrada) en el atributo custom:mfa_social
async function guardarSecretoMfaSocial(username, secretoCifrado) {
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: username,
      UserAttributes: [{ Name: 'custom:mfa_social', Value: secretoCifrado }],
    })
  );
}

// Traduce los errores de Cognito a mensajes en español para el usuario
function traducirError(err) {
  const mensajes = {
    UsernameExistsException: 'Ese correo ya está registrado.',
    InvalidPasswordException: 'La contraseña no cumple la política de seguridad.',
    InvalidParameterException: 'Algún dato enviado no es válido.',
    CodeMismatchException: 'El código ingresado es incorrecto.',
    ExpiredCodeException: 'El código expiró. Solicita uno nuevo.',
    LimitExceededException: 'Demasiados intentos. Espera unos minutos.',
    TooManyRequestsException: 'Demasiadas solicitudes. Espera unos segundos.',
    TooManyFailedAttemptsException: 'Demasiados intentos fallidos. Espera unos minutos.',
    NotAuthorizedException: 'Operación no permitida.',
    UserNotFoundException: 'No se encontró el usuario.',
  };
  return mensajes[err.name] || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

module.exports = {
  registrarUsuario,
  asignarTiendaYRol,
  confirmarRegistro,
  reenviarCodigo,
  iniciarSesion,
  asociarTotp,
  verificarTotp,
  completarConfiguracionMfa,
  responderCodigoMfa,
  cerrarSesionGlobal,
  listarUsuarios,
  cambiarRol,
  cambiarTienda,
  cambiarEstado,
  obtenerUsuario,
  buscarPorEmail,
  asignarValoresPorDefecto,
  crearUsuarioGithub,
  vincularGoogle,
  refrescarTokens,
  guardarSecretoMfaSocial,
  traducirError,
  GRUPO_POR_DEFECTO,
};
