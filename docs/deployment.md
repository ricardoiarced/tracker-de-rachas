# Despliegue

GitHub Actions valida cada cambio con una instalación reproducible (`npm ci`), escaneo de secretos,
formato, lint, tipos, pruebas y `npm audit` de severidad alta. El job también aplica las migraciones
en una D1 local vacía y comprueba los triggers de seguridad. Los despliegues nunca se ejecutan antes
de esos gates.

Las solicitudes de cambio del repositorio despliegan `registro-de-habitos-preview` contra la D1
`registro-de-habitos-preview`. Solo un push validado a `main` puede desplegar
`registro-de-habitos` contra la D1 de producción. Las solicitudes desde forks no reciben secretos
ni despliegan un preview.

## Preparación única

1. Cree un token de API de Cloudflare limitado a esta cuenta con permiso de edición para Workers y
   D1.
2. Guárdelo como el secreto de Actions `CLOUDFLARE_API_TOKEN` del repositorio.
3. Cree el entorno `production` en GitHub y active las revisiones requeridas antes del despliegue.
   El workflow ya lo selecciona, por lo que la protección se aplicará al siguiente push a `main`.

El token es el único secreto requerido por el workflow. El ID de cuenta y los IDs de D1 son
identificadores de recursos, no credenciales, y viven en `wrangler.jsonc` para que las migraciones
sean reproducibles. Los triggers de capacidad se aplican después de cada migración mediante
`wrangler d1 execute --file`: Wrangler no puede registrar de forma fiable una migración remota que
contiene triggers. El archivo primero sustituye todos los triggers y el script confirma su conjunto
completo; por tanto la operación es idempotente, se detiene ante el primer error y se puede repetir.

## Controles operativos

El Worker exige `Origin` del mismo origen y `Content-Type: application/json` para toda mutación. Las
respuestas de API no se almacenan en caché y envían CSP, `nosniff`, política de referencias y permisos
restrictivos. No se habilita CORS ni se registran cookies, credenciales, Nombre, Etiqueta o cuerpos.

`REQUEST_RATE_LIMIT` limita cada IP a 300 solicitudes por minuto y `SESSION_RATE_LIMIT` limita cada
Sesión demo a 120 por minuto. Como los contadores del binding son locales a cada ubicación de
Cloudflare, D1 complementa esa defensa con cinco creaciones de Sesión demo por IP y hora y rechaza
escrituras que superen 100 sesiones activas, 250.000 Cumplidos totales o 50.000 filas escritas al día.
Los límites devuelven `429`; si un límite de capacidad o su infraestructura no está disponible, el
Worker no muta datos y responde cerrado. Las lecturas solo renuevan una Sesión demo durante la última
hora de su vigencia por inactividad, para que las lecturas reiteradas no consuman la cuota de D1.

El cron horario elimina Sesiones demo expiradas, contadores de creación vencidos y capacidad diaria
antigua. Workers Observability queda habilitado para métricas agregadas y respuestas `429`/`503`; los
logs deben permanecer sin contenido de Sesiones demo. Producción y preview usan namespaces de rate
limit distintos para que el preview no consuma la capacidad pública.

## Verificación posterior

El job de producción comprueba que `GET /api/session` devuelve `401` sin una Sesión demo. El preview
crea una Sesión demo y un Hábito para comprobar la ruta Worker-D1 y los triggers desplegados. Además
ejecuta un baseline anónimo de OWASP ZAP como base de DAST; sus hallazgos no bloquean todavía el
preview mientras los controles de seguridad se completan en sus tickets correspondientes.
