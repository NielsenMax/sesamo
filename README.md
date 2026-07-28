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

Una vez, y sirve para siempre. En <https://console.cloud.google.com>:

1. **Creá un proyecto** (o usá uno existente). Anotá el **número de proyecto** —
   _Project number_, no el ID — que aparece en el panel de inicio.
2. **APIs y servicios → Biblioteca**: habilitá **Google Sheets API** y **Google Picker API**.
3. **Pantalla de consentimiento de OAuth**: tipo *External*, completá nombre y correo de soporte.
   Podés dejarla en modo *Testing* y agregarte como usuario de prueba: alcanza para vos y hasta
   100 cuentas más. No hace falta verificación porque `drive.file` no es un permiso restringido.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth**, tipo *Aplicación web*:
   - **Orígenes de JavaScript autorizados**:
     `https://sesamo.fernet.cc` y `http://localhost:5173`
   - No hace falta URI de redireccionamiento: el flujo es de token, en el navegador.
5. **Credenciales → Crear credenciales → Clave de API**. Restringila a la **Google Picker API**
   y, en restricción de aplicación, a los referentes `https://sesamo.fernet.cc/*` y
   `http://localhost:5173/*`.

Los tres valores son públicos por diseño: identifican a la app, no autorizan nada por sí solos.

### 2. Local

```bash
npm install
cp .env.example .env.local     # pegá los tres valores
npm run dev                    # http://localhost:5173
```

### 3. Cloudflare Pages → `sesamo.fernet.cc`

```
Build command:      npm run build
Build output:       dist
Node version:       20 o superior
```

Variables de entorno (producción **y** preview): `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`,
`VITE_GOOGLE_PROJECT_NUMBER`.

En **Custom domains**, agregá `sesamo.fernet.cc`. El `public/_redirects` ya manda todas las rutas
a `index.html`, que es lo que necesita el router.

Si más adelante usás dominios de preview (`*.pages.dev`), acordate de sumarlos a los orígenes
autorizados del cliente de OAuth o el login va a fallar ahí.

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
npm run dev        # servidor de desarrollo
npm run build      # typecheck + build de producción
npm run preview    # servir dist/ localmente
npm run typecheck  # solo tipos
node scripts/make-icons.mjs   # regenerar los íconos desde la marca
```
