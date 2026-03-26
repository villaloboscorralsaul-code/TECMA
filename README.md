# TECMA Politica Social (QR + Admin + Reconocimientos)

Implementacion completa del flujo TECMA en Netlify + Supabase con:

1. Flujo de usuario desde QR general (`/`) con seleccion de nombre desde padron.
2. Registro de estado por usuario: `PENDIENTE`, `EN_PROCESO`, `COMPLETADO`, `NO_APROBADO`.
3. Quiz de 7 preguntas y criterio de aprobacion `4/7`.
4. Generacion de reconocimiento PDF con folio y URL de verificacion.
5. Panel admin (`/admin?key=...`) con KPIs, carga manual, descarga individual y ZIP masivo.

## Estructura

- `index.html`, `styles.css`, `app.js`: flujo usuario (movil-first).
- `admin.html`, `admin.css`, `admin.js`: panel de seguimiento admin.
- `netlify/functions/*`: API serverless.
- `supabase/schema.sql`: esquema SQL.
- `netlify.toml`: redirects de API y rutas app/admin.

## Configuracion Rapida

### 1) Supabase

Ejecuta `supabase/schema.sql` en el SQL Editor del proyecto Supabase.

Tablas incluidas:

- `usuarios`
- `progreso_test`
- `intentos_quiz`
- `reconocimientos`
- `eventos_auditoria`

### 2) Variables de entorno (Netlify o local)

Copia `.env.example` y define:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_ACCESS_KEY`
- `RECOGNITIONS_BUCKET` (opcional, default: `recognitions`)
- `PUBLIC_SITE_URL` (ej. `https://tu-sitio.netlify.app`)

### 3) Dependencias

```bash
npm install
```

### 4) Verificacion de sintaxis

```bash
npm run check:functions
node --check app.js
node --check admin.js
```

## Rutas

### Frontend

- Usuario: `/`
- Admin: `/admin?key=TU_LLAVE_ADMIN`

### API (publicas de la app)

- `GET /api/roster`
- `POST /api/users` (admin key requerida)
- `GET /api/admin/overview` (admin key requerida)
- `GET /api/admin/users?status=ALL|PENDIENTE|EN_PROCESO|COMPLETADO|NO_APROBADO` (admin key requerida)
- `DELETE /api/admin/users?user_id=UUID` (admin key requerida)
- `POST /api/session/start`
- `POST /api/policy/accept`
- `POST /api/quiz/submit`
- `POST /api/recognitions/generate`
- `GET /api/recognitions/:id/download` (admin key requerida)
- `POST /api/recognitions/export-zip` (admin key requerida)
- `GET /api/recognitions/verify?token=...` o `?folio=...`

## Flujo Funcional

1. Admin entra a `/admin?key=...` y da de alta usuarios.
2. Cada usuario nace en `PENDIENTE`.
3. Usuario entra por QR general (`/`), selecciona nombre del padron y captura foto.
4. App llama `POST /api/session/start` y pasa a `EN_PROCESO`.
5. Tras lectura y aceptacion, app llama `POST /api/policy/accept`.
6. Al terminar quiz, app llama `POST /api/quiz/submit`:
   - `>=4`: mantiene `EN_PROCESO` hasta generar reconocimiento.
   - `<4`: cambia a `NO_APROBADO`.
7. Si aprueba, app llama `POST /api/recognitions/generate`:
   - crea/reutiliza PDF
   - asigna folio y verify token
   - cambia a `COMPLETADO`.
8. Admin monitorea KPIs y descarga evidencia individual o ZIP.

## Notas de Seguridad

- El panel admin esta protegido por `ADMIN_ACCESS_KEY` en query/header.
- No existe login tradicional en esta version (decision de negocio del proyecto).
- No usar anon key de Supabase en funciones serverless; usar `SERVICE_ROLE_KEY`.

## Diagnostico de imagenes en Netlify

Si logos/imagenes no cargan en produccion:

1. Verifica que existan en `assets/` con el nombre exacto (respeta mayusculas).
2. Usa rutas absolutas tipo `/assets/tecma-logo.png`.
3. Confirma que Netlify publique la raiz del proyecto (`publish = "."`).
4. Revisa que no haya redirects que capturen assets antes del archivo estatico.

## Criterios de Aceptacion Implementados

1. El total admin sale del conteo real de `usuarios`.
2. Estados visibles y filtrables por dashboard.
3. Cambio de estado en el ciclo real de usuario.
4. Generacion y descarga individual de reconocimiento.
5. Exportacion ZIP para aprobados/completados.
6. Endpoint de verificacion por folio/token.
