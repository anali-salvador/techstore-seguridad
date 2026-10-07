# TechStore · Gestión de inventario segura en AWS

Laboratorio calificado **GLAB-S08** del curso *Desarrollo de Soluciones en la Nube* (Tecsup).

TechStore es un sistema de gestión de inventario para una cadena de tiendas de tecnología. El foco del proyecto
es la **seguridad en la nube**: autenticación con **Amazon Cognito**, verificación en dos pasos (**MFA TOTP**),
login social con **Google** y **GitHub**, permisos por **rol** y por **tienda**, y productos guardados en **DynamoDB**.

---

## Contenido

1. [Arquitectura](#arquitectura)
2. [Tecnologías](#tecnologías)
3. [Estructura del proyecto](#estructura-del-proyecto)
4. [Configuración en AWS](#configuración-en-aws)
5. [Instalación y ejecución](#instalación-y-ejecución)
6. [Variables de entorno](#variables-de-entorno)
7. [Roles y matriz de permisos](#roles-y-matriz-de-permisos)
8. [Flujo de login con MFA](#flujo-de-login-con-mfa)
9. [Login social (Google y GitHub)](#login-social-google-y-github)
10. [Decisiones de seguridad](#decisiones-de-seguridad)
11. [API](#api)
12. [Capturas de pantalla para la evidencia](#capturas-de-pantalla-para-la-evidencia)
13. [Limitaciones conocidas](#limitaciones-conocidas)

---

## Arquitectura

```
                         ┌──────────────────────────── AWS (us-east-1) ───────────────────────────┐
 Navegador               │                                                                         │
 (HTML + JS)             │   Amazon Cognito (User Pool)              Amazon DynamoDB               │
     │                   │   - registro, login, JWT                  - tabla TechStoreProductos    │
     │  cookies httpOnly │   - MFA TOTP                                (tienda + productoId)       │
     ▼                   │   - grupos = roles, custom:tienda                                       │
 Servidor Node.js ───────┼─► - Hosted UI + proveedor federado Google                               │
 (Express)               │                                                                         │
  - valida JWT           └─────────────────────────────────────────────────────────────────────────┘
  - permisos por rol/tienda
  - Passport.js ───────────► GitHub OAuth
```

- El **navegador** nunca habla directamente con AWS: todo pasa por el servidor.
- El servidor usa un **usuario IAM con mínimo privilegio** (solo su User Pool y su tabla).
- Los **JWT** viajan en **cookies httpOnly**, así que el JavaScript de la página no puede leerlos.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Backend | Node.js 22, Express 5, express-session, cookie-parser |
| Autenticación | Amazon Cognito (`@aws-sdk/client-cognito-identity-provider`), `aws-jwt-verify` |
| MFA | TOTP de Cognito (login normal) y TOTP propio con `crypto` (login social), QR con `qrcode` |
| Login social | Google vía Cognito (OAuth 2.0 + PKCE), GitHub vía Passport.js (`passport-github2`) |
| Base de datos | Amazon DynamoDB (`@aws-sdk/lib-dynamodb`) |
| Frontend | HTML, CSS y JavaScript sin frameworks (estilo cristal / *glassmorphism*) |

## Estructura del proyecto

```
techstore-seguridad/
├── src/
│   ├── server.js                 # Arranque de Express, sesión, rutas
│   ├── config/
│   │   ├── env.js                # Lee el .env (avisa si falta algo, nunca muestra valores)
│   │   ├── permisos.js           # Matriz de permisos: única fuente de verdad
│   │   └── tiendas.js            # Lista de tiendas
│   ├── middleware/
│   │   └── autenticacion.js      # Valida el JWT, el permiso del rol y la tienda
│   ├── routes/
│   │   ├── auth.js               # Registro, confirmación, login, sesión, logout
│   │   ├── mfa.js                # MFA TOTP (Cognito y social), contador de 3 intentos
│   │   ├── social.js             # Login con Google (Cognito) y GitHub (Passport)
│   │   ├── productos.js          # CRUD de productos con permisos
│   │   ├── reportes.js           # Reportes de inventario
│   │   └── admin.js              # Panel del Administrador (roles y tiendas)
│   └── services/
│       ├── cognito.js            # Llamadas a Cognito
│       ├── productos.js          # Llamadas a DynamoDB
│       ├── jwt.js                # Verificación de JWT y cookies
│       ├── totp.js               # TOTP (RFC 6238) para el MFA social
│       ├── cifrado.js            # AES-256-GCM para guardar la clave TOTP social
│       ├── intentos.js           # Contador de intentos con bloqueo
│       ├── contadores.js         # Contadores de login (5) y MFA (3)
│       └── validaciones.js       # Validación de contraseña, correo y productos
├── public/                       # Páginas: index, registro, confirmar, login,
│   ├── css/styles.css            #   mfa-configurar, mfa-codigo, dashboard, admin
│   ├── js/                       # Lógica de cada página
│   └── img/                      # Logo e iconos SVG propios
├── scripts/
│   ├── verificar-aws.js          # npm run verificar -> prueba Cognito y DynamoDB
│   └── semilla-productos.js      # npm run semilla   -> carga productos de ejemplo
├── .env.example                  # Plantilla de variables (sin valores reales)
└── .gitignore                    # Excluye .env y node_modules
```

---

## Configuración en AWS

Todo se crea en la región **us-east-1 (N. Virginia)**.

### 1. Cognito User Pool

| Configuración | Valor |
|---|---|
| Tipo de aplicación | Single-page application (App Client **sin** client secret) |
| Inicio de sesión | Solo **correo** |
| Atributos obligatorios | `name` |
| Política de contraseña | Mínimo 8 caracteres, 1 mayúscula, 1 número, 1 carácter especial |
| MFA | **Obligatorio**, solo *Aplicaciones de autenticación* (TOTP) |
| Atributo `custom:tienda` | String, mutable. App Client: lectura ✅ escritura ❌ |
| Atributo `custom:mfa_social` | String, longitud máx. 512, mutable. App Client: lectura ❌ escritura ❌ |
| Grupos (precedencia) | `Administrador` (1), `GerenteTienda` (2), `EmpleadoVentas` (3), `Auditor` (4) |

**App Client (`techstore-web`):**
- Flujos: `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`.
- *Prevent user existence errors*: activado.
- Duración de la sesión del flujo de autenticación: **15 minutos** (tiempo para escanear el QR).
- Páginas de inicio de sesión:
  - Callback: `http://localhost:3000/auth/google/callback`
  - Sign-out: `http://localhost:3000/login.html`
  - Proveedores: **Grupo de usuarios de Cognito** y **Google**
  - OAuth: **Authorization code grant**; scopes `openid`, `email`, `profile`
- Dominio del Hosted UI: dominio de Cognito, versión **clásica**.

### 2. Proveedor federado Google (en Cognito)

1. En **Google Cloud Console → APIs y servicios → Credenciales**, crear un **ID de cliente de OAuth** (Aplicación web):
   - Orígenes autorizados: `https://<tu-dominio>.auth.us-east-1.amazoncognito.com`
   - URI de redirección autorizada: `https://<tu-dominio>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
2. En **Cognito → Autenticación → Proveedores sociales y externos → Agregar proveedor → Google**:
   - Client ID y Client Secret de Google (se escriben **solo aquí**, no en el `.env`).
   - Ámbitos autorizados: `profile email openid`
   - Mapeo de atributos: `email` → `email`, `email_verified` → `email_verified`, `name` → `name`.
3. En el App Client, marcar **Google** como proveedor de identidad.

### 3. Tabla DynamoDB

`TechStoreProductos` · clave de partición `tienda` (String) · clave de ordenación `productoId` (String) ·
capacidad aprovisionada 1/1 (dentro del plan gratuito).

### 4. Usuario IAM `techstore-app` (mínimo privilegio)

Política insertada `TechStoreAppPolicy` (reemplazar `ID_DE_CUENTA`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CognitoAdministracionUsuarios",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:AdminListGroupsForUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminEnableUser",
        "cognito-idp:AdminDisableUser",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:AdminLinkProviderForUser",
        "cognito-idp:ListUsers",
        "cognito-idp:ListUsersInGroup",
        "cognito-idp:ListGroups"
      ],
      "Resource": "arn:aws:cognito-idp:us-east-1:ID_DE_CUENTA:userpool/us-east-1_XXXXXXXXX"
    },
    {
      "Sid": "DynamoProductos",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:ID_DE_CUENTA:table/TechStoreProductos"
    }
  ]
}
```

`AdminCreateUser`, `AdminDeleteUser` y `AdminLinkProviderForUser` son para el login social (crear el registro de
los usuarios de GitHub y vincular Google a una cuenta existente). El código solo borra usuarios federados
`google_...` duplicados, después de comprobar que lo son.

### 5. GitHub OAuth App

En **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**:
- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/auth/github/callback`

---

## Instalación y ejecución

Requisitos: **Node.js 18 o superior** (probado con 22) y una cuenta de AWS con lo anterior configurado.

```bash
git clone https://github.com/anali-salvador/techstore-seguridad.git
cd techstore-seguridad
npm install
cp .env.example .env        # en Windows: copy .env.example .env
# completar el .env (ver la sección siguiente)

npm run verificar           # comprueba la conexión con Cognito y DynamoDB
npm run semilla             # (opcional) carga 10 productos de ejemplo en 3 tiendas
npm run dev                 # inicia el servidor con recarga automática
```

Abrir **http://localhost:3000**.

**Primer administrador:** como nadie puede elegir su rol al registrarse, el primer administrador se asigna a mano.
En Cognito → Usuarios → *(tu usuario)* → Membresías de grupo, quitar `EmpleadoVentas` y agregar `Administrador`.
Luego cerrar sesión y volver a entrar. Desde ahí, los roles se gestionan en **Panel → Usuarios**.

| Comando | Qué hace |
|---|---|
| `npm start` | Inicia el servidor |
| `npm run dev` | Inicia el servidor con nodemon (se reinicia al guardar) |
| `npm run verificar` | Revisa el `.env` (sin mostrar valores), grupos y usuarios por rol, atributos, permisos IAM, scopes, proveedor Google y DynamoDB. Marca con ✅ o ❌ cada paso |
| `npm run semilla` | Carga productos de ejemplo (IDs fijos: no duplica si se repite) |

## Variables de entorno

El archivo `.env` **no se sube a git**. Esta es la plantilla (`.env.example`), sin valores reales:

```ini
PORT=3000
SESSION_SECRET=

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
COGNITO_DOMAIN=
COGNITO_REDIRECT_URI=http://localhost:3000/auth/google/callback

DYNAMODB_TABLE=TechStoreProductos

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback

APP_JWT_SECRET=
MFA_SOCIAL_CLAVE=

MAX_LOGIN_ATTEMPTS=5
MAX_MFA_ATTEMPTS=3
LOGIN_BLOQUEO_MINUTOS=15
```

| Variable | Descripción |
|---|---|
| `SESSION_SECRET` | Firma la cookie de sesión. 64 caracteres hex aleatorios. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Access Key del usuario IAM `techstore-app`. |
| `COGNITO_*` | ID del User Pool, ID del App Client, dominio del Hosted UI y URL de retorno. |
| `GITHUB_*` | Credenciales de la OAuth App de GitHub. |
| `APP_JWT_SECRET` | Firma (HS256) del JWT propio de los usuarios de GitHub. 64 caracteres hex. |
| `MFA_SOCIAL_CLAVE` | Clave AES-256 (64 caracteres hex) que cifra la clave TOTP social guardada en Cognito. |

Para generar valores aleatorios: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Las credenciales de **Google** no van en el `.env`: se ingresan en la consola de Cognito, y la app nunca las usa.

---

## Roles y matriz de permisos

Cada rol es un **grupo de Cognito** y llega al servidor dentro del JWT (`cognito:groups`). La tienda llega en
`custom:tienda`. La matriz está en `src/config/permisos.js`.

| Rol | Descripción |
|---|---|
| **Administrador** | Gestiona usuarios y roles. Acceso total a todas las tiendas. |
| **Gerente de Tienda** | Gestiona los productos y ve los reportes **de su tienda**. No puede tocar otras tiendas. |
| **Empleado de Ventas** | Consulta productos y actualiza stock de su tienda. **No puede modificar precios.** |
| **Auditor** | Solo lectura de todas las tiendas y reportes. Sin permisos de modificación. |

| Acción | Administrador | Gerente | Empleado | Auditor |
|---|:---:|:---:|:---:|:---:|
| Ver productos | Todas | Su tienda | Su tienda | Todas |
| Crear productos | ✅ | ✅ su tienda | ❌ | ❌ |
| Editar productos | ✅ | ✅ su tienda | ❌ | ❌ |
| Modificar precios | ✅ | ✅ su tienda | ❌ | ❌ |
| Actualizar stock | ✅ | ✅ su tienda | ✅ su tienda | ❌ |
| Eliminar productos | ✅ | ✅ su tienda | ❌ | ❌ |
| Ver reportes | Todas | Su tienda | ❌ | Todas |
| Gestionar usuarios y roles | ✅ | ❌ | ❌ | ❌ |

Cada petición protegida pasa por:

```
autenticar (JWT válido)  ->  requierePermiso(acción del rol)  ->  negarSiOtraTienda  ->  validar datos  ->  DynamoDB
        401                            403                             403                    400
```

- Ocultar botones en la página es solo comodidad: **la seguridad está en el servidor**. La sección
  *Prueba de permisos* del panel llama a la API directamente para demostrar que responde **403**.
- Los usuarios nuevos reciben siempre el rol **EmpleadoVentas**; nadie puede elegir su rol ni su tienda.
- Cada acceso denegado queda registrado en la consola: `[403] correo (rol) MÉTODO ruta -> motivo`.

---

## Flujo de login con MFA

### Registro
1. Formulario: correo, contraseña (validada en el navegador **y** en el servidor), nombre completo y tienda.
2. `SignUp` crea el usuario. Luego el **servidor** (con IAM) asigna `custom:tienda` y el grupo `EmpleadoVentas`.
3. Cognito envía un código al correo y `ConfirmSignUp` verifica la cuenta.

### Login con correo y contraseña

```
login.html ── InitiateAuth (USER_PASSWORD_AUTH)
   ├─ contraseña incorrecta ─► contador +1 ("2 de 5") ─► al 5.º: bloqueo de 15 min (HTTP 423)
   └─ correcta ─► Cognito NO entrega el JWT: responde con un reto MFA
        ├─ MFA_SETUP (primer login) ─► mfa-configurar.html
        │     AssociateSoftwareToken ─► QR ─► VerifySoftwareToken ─► RespondToAuthChallenge
        └─ SOFTWARE_TOKEN_MFA (siguientes) ─► mfa-codigo.html
              RespondToAuthChallenge(código de 6 dígitos)
                 ├─ correcto ─► JWT en cookies httpOnly ─► dashboard.html
                 └─ incorrecto ─► contador "1 de 3"; al 3.º se cancela el login y se bloquea
```

- Hasta pasar el MFA, el servidor solo guarda la *Session* temporal de Cognito, y el navegador nunca la ve.
- El contador visible (5 de login y 3 de MFA) se suma al **bloqueo nativo de Cognito**.

---

## Login social (Google y GitHub)

### Google, a través de Cognito

```
/auth/google ─► Hosted UI de Cognito (identity_provider=Google, state + PKCE) ─► Google
   ─► /auth/google/callback?code&state
        1. Valida el state (anti-CSRF, un solo uso, máx. 10 min)
        2. Canjea el code en /oauth2/token con el code_verifier (PKCE)
        3. Verifica el ID token con aws-jwt-verify
        4. ¿Ya existe una cuenta con ese correo? -> vincula Google a esa cuenta (AdminLinkProviderForUser)
        5. ¿Usuario nuevo? -> rol EmpleadoVentas y tienda lima-centro
        6. MFA TOTP de la app ─► recién entonces se entregan las cookies con el JWT
```

### GitHub, con Passport.js

GitHub **no es un proveedor que Cognito acepte** (no es OpenID Connect). Por eso:

1. Passport (`passport-github2`, scope `user:email`, `state: true`) autentica con GitHub.
2. Se elige el **correo público si está verificado**; si no, el **correo principal verificado**. Un correo sin
   verificar nunca se usa.
3. Si el correo ya existe en Cognito, se usa **esa cuenta**. Si no existe, se crea su registro en Cognito
   (`AdminCreateUser`, sin contraseña utilizable, sin enviar correo) con `EmpleadoVentas` y `lima-centro`.
   Así el Administrador gestiona a todos los usuarios desde el mismo panel.
4. MFA TOTP de la app.
5. El servidor firma un **JWT propio** (HS256, `APP_JWT_SECRET`, 1 hora) con los grupos y la tienda leídos de
   Cognito. El middleware aplica exactamente los mismos permisos.

### MFA en el login social: limitación y decisión

> **Limitación:** Cognito **no aplica su MFA a usuarios federados**. Cuando alguien entra con Google, Cognito
> entrega los tokens sin pedir el código TOTP, porque considera que la autenticación es responsabilidad de
> Google. Además, el TOTP que Cognito guarda para el login normal no se puede comprobar fuera de su propio flujo
> de login. GitHub ni siquiera pasa por Cognito.

**Decisión: MFA TOTP implementado en la app para todos los logins sociales.**

- Cada usuario social tiene una **clave TOTP propia** (160 bits aleatorios), separada de la de Cognito. En Google
  Authenticator aparece como **"TechStore Social"**.
- La clave se guarda en Cognito, en `custom:mfa_social`, **cifrada con AES-256-GCM**. La clave de cifrado
  (`MFA_SOCIAL_CLAVE`) solo existe en el servidor, y el App Client no tiene permiso de lectura sobre ese
  atributo, así que tampoco aparece en el JWT.
- El TOTP sigue el RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s, tolerancia de ±1 paso). Se probó con los vectores
  oficiales del RFC. Además, **un código no se puede usar dos veces**.
- Mientras el código no se valide, los tokens quedan **solo en la sesión del servidor**: el navegador no recibe
  ninguna cookie de sesión.
- Aplica el mismo contador de **3 intentos**: al tercer código incorrecto se cancela el login y el MFA de esa
  cuenta queda bloqueado 15 minutos.

**Por qué no otra alternativa:**
- *Confiar en el MFA de Google o GitHub:* la app no puede comprobar que el usuario lo tenga activo.
- *Usar solo el proveedor y saltar el MFA:* incumple el requisito de MFA.

---

## Decisiones de seguridad

| Tema | Decisión |
|---|---|
| Secretos | Todo secreto va en `.env`, que está en `.gitignore`. El repositorio solo tiene `.env.example` vacío. Los logs nunca muestran tokens ni claves. |
| Contraseñas | Las maneja Cognito; la app nunca las guarda. La política se valida en el navegador y en el servidor. |
| Fuerza bruta | Contador de 5 intentos por cuenta, guardado en el servidor, más el bloqueo nativo de Cognito. MFA: 3 intentos. |
| Enumeración de usuarios | El mismo mensaje para "correo inexistente" y "contraseña incorrecta". *Prevent user existence errors* activado. |
| Tokens | En cookies **httpOnly** (no accesibles desde JavaScript, protege contra XSS), **SameSite=Lax** (contra CSRF) y `Secure` en producción. |
| Verificación de JWT | `aws-jwt-verify`: firma RS256 con las llaves JWKS de Cognito, expiración, User Pool y App Client. El JWT propio fija `HS256`, emisor y audiencia, y rechaza `alg: none`. |
| Fijación de sesión | La sesión se regenera al iniciar el login y al completar el MFA. |
| OAuth | `state` aleatorio de un solo uso (anti-CSRF), **PKCE** en el flujo de Google y comparación en tiempo constante. |
| Vinculación de cuentas | Solo si el correo está verificado en ambos lados. Nunca con una cuenta `UNCONFIRMED`, para evitar el pre-secuestro de cuentas. |
| Rol y tienda | Solo el servidor (con IAM) los asigna. El App Client no puede escribir `custom:tienda`. Nadie elige su rol. |
| Autorización | En el servidor, por rol **y** por tienda, desde una única matriz. La interfaz solo oculta botones. |
| Datos de entrada | Validación en el servidor, solo con los campos permitidos (no se pueden colar `creadoPor`, `productoId`, etc.). |
| XSS | Los datos se pintan con `textContent`, nunca con `innerHTML`. |
| IAM | Usuario con mínimo privilegio: solo su User Pool y su tabla, sin acceso a la consola. |
| Datos en reposo | DynamoDB cifra en reposo por defecto. La clave TOTP social además va cifrada por la app. |
| Cabeceras | `X-Powered-By` desactivado. |

---

## API

| Método | Ruta | Quién |
|---|---|---|
| POST | `/api/auth/registro`, `/api/auth/confirmar`, `/api/auth/reenviar-codigo` | Público |
| POST | `/api/auth/login` | Público (contador de 5 intentos) |
| GET/POST | `/api/mfa/estado`, `/api/mfa/configurar/iniciar`, `/api/mfa/configurar/verificar`, `/api/mfa/verificar`, `/api/mfa/cancelar` | Login pendiente de MFA |
| GET | `/auth/google`, `/auth/google/callback`, `/auth/github`, `/auth/github/callback` | Login social |
| GET | `/api/auth/sesion` · POST `/api/auth/logout` | Con sesión |
| GET | `/api/productos?tienda=` | `productos:ver` |
| POST | `/api/productos` | `productos:crear` |
| PUT | `/api/productos/:tienda/:id` | `productos:editar` (+ `productos:precio` si cambia el precio) |
| PATCH | `/api/productos/:tienda/:id/stock` | `productos:stock` |
| DELETE | `/api/productos/:tienda/:id` | `productos:eliminar` |
| GET | `/api/reportes` | `reportes:ver` |
| GET/PUT/PATCH | `/api/admin/usuarios[/:username[/estado]]` | `usuarios:gestionar` |

---

## Capturas de pantalla para la evidencia

**Consola de AWS**
- [ ] User Pool: información general (ID, región)
- [ ] Política de contraseña (8 caracteres, mayúscula, número, especial)
- [ ] MFA obligatorio con "Aplicaciones de autenticación"
- [ ] Atributos personalizados `custom:tienda` y `custom:mfa_social`, y sus permisos en el App Client
- [ ] Los 4 grupos con su precedencia
- [ ] App Client: flujos de autenticación y páginas de inicio de sesión (Google habilitado)
- [ ] Proveedor Google con su mapeo de atributos
- [ ] Usuarios: un usuario con su grupo y `custom:tienda`, y un usuario `google_...` o vinculado
- [ ] Tabla DynamoDB `TechStoreProductos` con sus ítems
- [ ] Usuario IAM `techstore-app` con su política de mínimo privilegio

**Aplicación**
- [ ] Registro: reglas de contraseña en rojo y verde, y registro exitoso
- [ ] Verificación de cuenta con el código del correo
- [ ] Login con error y contador ("2 de 5")
- [ ] **Bloqueo** a los 5 intentos con la cuenta regresiva
- [ ] **QR de MFA** (`mfa-configurar.html`) y Google Authenticator con la cuenta agregada
- [ ] Código MFA **incorrecto** ("1 de 3") y **correcto**
- [ ] Cancelación del login a los 3 códigos incorrectos
- [ ] Panel con los datos del **JWT** (grupos, tienda, expiración y firma verificada)
- [ ] **Permisos por rol**: el panel de cada rol (Administrador, Gerente, Empleado, Auditor)
- [ ] Gerente: crear y eliminar en su tienda; 403 al ver otra tienda
- [ ] Empleado: actualizar stock, candado en el precio y 403 al cambiar el precio
- [ ] Auditor: solo lectura y reportes de todas las tiendas
- [ ] *Prueba de permisos* con las respuestas **HTTP 403**
- [ ] Panel de **usuarios** del Administrador (cambio de rol y tienda)
- [ ] **Login social**: botones de Google y GitHub, pantalla de consentimiento, MFA social y panel con
      "Inicio de sesión: Google" o "GitHub"
- [ ] Consola del servidor con los registros `[403]` de accesos denegados

---

## Limitaciones conocidas

- **Contadores en memoria:** los contadores de intentos y bloqueos viven en la memoria del servidor, así que se
  reinician si el servidor se reinicia. En producción irían en un almacén compartido, como DynamoDB o Redis.
- **Cambios de rol:** un cambio de rol o tienda se aplica cuando el usuario vuelve a iniciar sesión. Su JWT
  actual conserva los datos anteriores hasta que expira (1 hora).
- **Usuarios deshabilitados:** no pueden volver a iniciar sesión, pero su token actual sigue valiendo hasta que
  expira.
- **Vinculación rechazada:** si se rechaza una vinculación con Google, el usuario `google_...` que Cognito creó
  queda **sin rol**, sin ningún permiso. Un administrador puede borrarlo desde la consola.
- **Dos entradas en Google Authenticator:** un usuario que entra con correo y contraseña **y** también con
  Google o GitHub tiene dos claves TOTP: "TechStore" (Cognito) y "TechStore Social" (app).
- **Grupo automático de Google:** al agregar Google como proveedor, Cognito crea solo el grupo
  `<pool>_Google` para los usuarios federados. No es un rol: la app lo ignora y el panel de usuarios nunca lo quita.
- **Sesiones:** se guardan en memoria (`MemoryStore`), lo que solo es adecuado para desarrollo.
- **HTTPS:** en local se usa HTTP; en producción hace falta HTTPS (las cookies ya se marcan `Secure` con
  `NODE_ENV=production`).

---

Desarrollado por **anali-salvador** · Tecsup · Desarrollo de Soluciones en la Nube · GLAB-S08
