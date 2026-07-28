<!-- markdownlint-disable MD033 -->

# Sésamo

**Control de acceso con QR para eventos chicos. Tu planilla de Google es la única base de datos.**
_QR access control for small events. Your Google spreadsheet is the only database._

Una planilla por evento, en tu Drive, legible por cualquiera que la abra. Emitís entradas con
un QR firmado, las imprimís, y en la puerta escaneás sin internet. Cada lectura queda anotada.

> One spreadsheet per event, in your Drive, readable by anyone who opens it. Issue tickets with
> a signed QR, print them, and scan at the door with no connection. Every read is written down.

---

## Cómo funciona · How it works

1. **Entrás con Google.** Sésamo pide un solo permiso: `drive.file`. Puede tocar las planillas
   que crea y las que vos le entregás con el selector de archivos. El resto de tu Drive le es
   invisible, y eso lo hace cumplir Google, no nosotros.
2. **Creás un evento.** Se arma una planilla nueva con cuatro solapas y una clave de firma propia.
3. **Emitís entradas.** Cada una lleva un código `A7QK-0042` y un QR `SES1:A7QK:0042:K3F9QX`,
   donde el último tramo es un HMAC-SHA256 truncado del evento y el número de serie.
4. **Imprimís.** Cuatro modelos listos o tu propio arte, exportado a PDF vectorial (el QR también
   es vectorial: nítido a cualquier tamaño, y una hoja de 12 entradas pesa 21 kB).
5. **Escaneás en la puerta.** El teléfono trabaja contra su copia local en IndexedDB: responde en
   un milisegundo y funciona sin señal. Cuando vuelve la conexión, sube todo solo.

### Qué decide la puerta · What the door decides

| Veredicto | Cuándo | ¿Se puede dejar pasar igual? |
| --- | --- | --- |
| **Adelante** | Firma válida, entrada en la lista, sin ingresos previos | — |
| **Repetida** | Ya se usó. Muestra **todos** los horarios de ingreso | Sí, queda registrado |
| **Inválida** | La firma no cierra: ese QR no lo emitió esta planilla | No |
| **Otro evento** | Es una entrada de otro evento | Sí, queda registrado |
| **Anulada** | La entrada fue dada de baja | Sí, queda registrado |
| **No está en la lista** | La firma cierra pero falta en la copia bajada | Sí, queda registrado |

La firma se verifica **antes** de mirar la lista. Por eso un QR falsificado se distingue de una
lista desactualizada, aun estando el teléfono sin señal.

Toda lectura —entre o no entre— agrega una fila en la solapa **Escaneos**. Las excepciones quedan
marcadas como tales.

---

## La planilla · The spreadsheet

Una planilla por evento, con cuatro solapas. Está pensada para que la lea una persona.

**Resumen** — la tapa: nombre, fecha, lugar, tipos de entrada, y contadores en vivo por fórmula.

**Entradas** — la lista de invitados. Podés corregir nombres a mano; lo único que no hay que tocar
es la columna `Código`.

| Código | N° | Nombre | Tipo | Estado | Primer ingreso | Ingresos | Todos los ingresos | Emitida |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A7QK-0042 | 42 | Ana Pérez | VIP | Ingresada | 2026-08-15 22:14 | 2 | 2026-08-15 22:14 · 22:25 | 2026-07-20 18:00 |

**Escaneos** — la auditoría: fecha y hora, código, resultado, nombre, tipo, detalle, dispositivo, origen.

**Config** — la única solapa que no hay que editar: ahí vive `signing_key`, la clave que valida
cada QR. Si cambia, todas las entradas impresas dejan de servir.

Las solapas se crean en el idioma que elijas al armar el evento y Sésamo las reconoce en los dos.
El código impreso más la clave regeneran la firma, así que la planilla nunca necesita guardarla.

---

## Puesta en marcha · Setup

### 1. Google Cloud

Proyecto: **`sesamo-503823`** (número `861806562872`), en la organización `maxi-a-nielsen-org`.

**Ya hecho por CLI:**

```bash
gcloud services enable sheets.googleapis.com picker.googleapis.com --project=sesamo-503823

gcloud services api-keys create --project=sesamo-503823 \
  --display-name="Sesamo web (Picker)" \
  --api-target=service=picker.googleapis.com \
  --allowed-referrers="https://sesamo.fernet.cc/*,http://localhost:5173/*"
```

La clave y el número de proyecto ya están en `.env.local`.

**Falta hacer a mano.** Google no expone la creación de clientes OAuth de consumidor por API
—ni por `gcloud`— así que estos dos pasos son de consola. Son cinco minutos y una sola vez:

1. **Pantalla de consentimiento** →
   <https://console.cloud.google.com/auth/branding?project=sesamo-503823>
   Elegí **External**: el dueño del proyecto es una cuenta `@gmail.com`, y *Internal* solo
   admite cuentas del dominio de la organización. Poné nombre (`Sésamo`) y correo de soporte.

   Después, **Audience** → <https://console.cloud.google.com/auth/audience?project=sesamo-503823>.
   Si la dejás en *Testing*, el login falla con **Error 403: access_denied** («la app se está
   probando y solo los verificadores aprobados pueden acceder») para cualquier cuenta que no
   figure en *Test users* — incluida la tuya. Dos salidas:
   - **Publish app** (recomendado): los permisos que pide —`drive.file` y `email`— no son
     sensibles, así que Google **no** exige verificación y no hay tope de 100 cuentas.
   - o **Add users** y ponés ahí tu propio correo.

2. **Cliente OAuth** →
   <https://console.cloud.google.com/auth/clients?project=sesamo-503823>
   *Create client* → **Web application**, nombre `Sésamo web`.
   - **Authorized JavaScript origins**: `https://sesamo.fernet.cc` y `http://localhost:5173`
   - **Redirect URIs**: ninguno. El flujo es de token, en el navegador.

   Copiá el Client ID a `VITE_GOOGLE_CLIENT_ID` en `.env.local`.

Los tres valores son públicos por diseño: identifican a la app, no autorizan nada por sí solos.

### 2. Local

```bash
pnpm install
pnpm dev                       # http://localhost:5173
```

### 3. Cloudflare → `sesamo.fernet.cc`

El proyecto está conectado como **Worker de assets estáticos** (no Pages): no hay código de
servidor, solo el `dist/` que sirve Cloudflare.

```
Build command:      pnpm build
Deploy command:     npx wrangler deploy
Output directory:   dist
```

La configuración vive en `wrangler.jsonc` y está versionada a propósito. `not_found_handling:
"single-page-application"` es lo que hace que `/e/<id>/tickets` sirva `index.html` en vez de un
404 — verificado con `wrangler dev`, junto con que los `/assets/*.js` sigan saliendo como
JavaScript y no reescritos a HTML.

Tres cosas que hacen fallar el build o el deploy si faltan:

- **`.node-version` (22.17.0)** — Vite 8 exige Node `^20.19 || >=22.12` y el default de
  Cloudflare es más viejo.
- **Vite 6 o superior** — Cloudflare autodetecta el proyecto y aborta con _«The version of Vite
  used in the project cannot be automatically configured»_ si es menor.
- **`wrangler.jsonc` en el repo** — sin él, `wrangler deploy` entra en su asistente
  interactivo, que en CI se autorresponde que sí, corre `pnpm add wrangler` y muere con
  cualquier cosa que pnpm reporte. Así falló el primer deploy: pnpm cortó con
  `ERR_PNPM_IGNORED_BUILDS: workerd`. Por eso `workerd` también está en `allowBuilds`.

Variables de entorno (producción **y** preview): `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`,
`VITE_GOOGLE_PROJECT_NUMBER`. Vite las incrusta en el bundle en tiempo de build, así que tienen
que existir **antes** de compilar, y cambiarlas exige un redeploy.

En **Custom domains**, agregá `sesamo.fernet.cc`.

Si más adelante usás dominios de preview (`*.workers.dev`, `*.pages.dev`), acordate de sumarlos
a los orígenes autorizados del cliente de OAuth **y** a los referrers de la clave de API, o el
login falla ahí. Producción en el dominio propio ya está cubierta.

---

## En la puerta · At the door

- **Instalá la app** (Añadir a pantalla de inicio). Es una PWA: arranca sin conexión.
- **Bajá las entradas antes de abrir**, con señal. El escáner trabaja contra esa copia.
- **Modo noche automático**: la pantalla de la puerta se invierte sola.
- **Sin cámara o QR arruinado**: *Cargar a mano* acepta el código impreso, `A7QK-0042`.
- El contador de arriba dice cuántas lecturas quedan sin subir. Se van solas al volver la señal.

---

## Detalles que conviene saber · Worth knowing

- **Sin usuarios concurrentes.** Un dispositivo escanea a la vez. Dos teléfonos escaneando en
  paralelo no se ven entre sí hasta que sincronizan, y la misma entrada podría pasar dos veces.
- **La sesión de Google dura una hora.** Sin servidor no hay refresh token. La app renueva sola
  mientras haya señal; sin señal no importa, porque el escáner no necesita a Google.
- **Si borrás la planilla de Drive, borrás el evento.** No hay copia nuestra: no hay servidor.
- **Si cambiás `signing_key`**, todas las entradas ya impresas dejan de validar.

---

## Estructura · Layout

```
src/
  lib/
    codes.ts          firma HMAC, códigos, parseo de lo que lee la cámara
    verdict.ts        la regla de la puerta, en una sola función pura
    event-sheet.ts    el esquema de la planilla: crear, leer, escribir, formatear
    db.ts             copia local en IndexedDB
    sync.ts           bajar entradas / subir auditoría
    ticket-render.ts  un ticket descrito una vez, dibujado en SVG y en PDF
    export.ts         PDF vectorial y ZIP de QR sueltos
    google/           auth (GIS), Sheets REST, Picker
  state/              contexto de sesión y de evento
  views/              landing, alta de evento, entradas, diseño, puerta, registro
  styles/             tokens, base, componentes, vistas, puerta
scripts/make-icons.mjs  rasteriza la marca a PNG sin dependencias
```

## Comandos

```bash
pnpm dev          # servidor de desarrollo
pnpm build        # typecheck + build de producción
pnpm preview      # servir dist/ localmente
pnpm typecheck    # solo tipos
node scripts/make-icons.mjs   # regenerar los íconos desde la marca
```
