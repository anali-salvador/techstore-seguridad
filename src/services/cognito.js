// Funciones para hablar con Amazon Cognito usando el SDK de AWS v3.
const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const config = require('../config/env');

// El cliente toma las credenciales IAM del .env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
const cognito = new CognitoIdentityProviderClient({ region: config.aws.region });
const { userPoolId, clientId } = config.cognito;

// Rol que recibe todo usuario nuevo (el de menos privilegios de modificación)
const GRUPO_POR_DEFECTO = 'EmpleadoVentas';

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
  traducirError,
  GRUPO_POR_DEFECTO,
};
