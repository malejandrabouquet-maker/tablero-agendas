# Tablero de agendas (Netlify)

Página web con contraseña que, cada vez que se abre, lee las agendas del canal
#comercial-agenda en Slack y busca la etapa de cada una en el pipeline "Agendas"
de GoHighLevel. Todo es de solo lectura: no modifica nada en Slack ni en GHL.

## Qué hay en esta carpeta

- `public/index.html`: la página del tablero.
- `netlify/functions/agendas.mjs`: la función que consulta Slack y GHL.
- `netlify.toml`: la configuración de Netlify.

## Paso 1. Token de Slack

1. Entrá a https://api.slack.com/apps y tocá **Create New App**, luego **From scratch**.
2. Ponele de nombre "Tablero de agendas" y elegí el workspace de Founders.
3. En el menú izquierdo, entrá a **OAuth & Permissions**.
4. En **Bot Token Scopes**, agregá el permiso `groups:history` (sirve para leer canales privados).
5. Arriba de esa misma página, tocá **Install to Workspace** y aceptá.
6. Copiá el **Bot User OAuth Token**. Empieza con `xoxb-`.
7. En Slack, entrá a #comercial-agenda y escribí `/invite @Tablero de agendas`.

## Paso 2. Token de GoHighLevel

1. En la subcuenta de Founders, entrá a **Configuración** y después a **Integraciones privadas**.
2. Creá una integración nueva llamada "Tablero de agendas".
3. Marcá solo estos permisos: **ver oportunidades** (`opportunities.readonly`) y **ver contactos** (`contacts.readonly`).
4. Copiá el token que te muestra. Se ve una sola vez, así que guardalo en un lugar seguro.

## Paso 3. Subir el código a GitHub

1. Entrá a https://github.com/new y creá un repositorio **privado** llamado `tablero-agendas`.
2. Tocá **uploading an existing file** y arrastrá todo el contenido de esta carpeta
   (las carpetas `public` y `netlify`, y el archivo `netlify.toml`). Confirmá con **Commit changes**.

## Paso 4. Publicar en Netlify

1. En https://app.netlify.com tocá **Add new site**, luego **Import an existing project** y elegí GitHub.
2. Elegí el repositorio `tablero-agendas`. Dejá la configuración como viene y tocá **Deploy**.
3. Cuando termine, entrá a **Site configuration**, luego **Environment variables**, y agregá:

| Variable | Valor |
|---|---|
| `SLACK_TOKEN` | el token `xoxb-...` del paso 1 |
| `GHL_TOKEN` | el token del paso 2 |
| `DASHBOARD_PASSWORD` | la contraseña que van a usar para entrar al tablero |

4. Entrá a **Deploys** y tocá **Trigger deploy**, luego **Deploy site**, para que tome las variables.
5. Abrí el link del sitio (algo como `https://tablero-agendas.netlify.app`), ingresá la contraseña y listo.

Opcionales, ya vienen con los valores de Founders: `SLACK_CHANNEL`, `GHL_LOCATION`, `GHL_PIPELINE`.

## Si algo falla

El tablero muestra qué falló. Los casos más comunes:

- "La app de Slack no está en #comercial-agenda": falta el paso 1.7.
- "Al token de Slack le falta el permiso groups:history": revisá el paso 1.4 y volvé a instalar la app.
- "El token de GoHighLevel es inválido o venció": generá uno nuevo (paso 2) y reemplazalo en Netlify.
- "Contraseña incorrecta": revisá `DASHBOARD_PASSWORD` en Netlify.

## Cómo cambiar la contraseña

Cambiá `DASHBOARD_PASSWORD` en Netlify y volvé a hacer el deploy (paso 4.4).
Quien tenga la contraseña vieja va a tener que ingresar la nueva.
