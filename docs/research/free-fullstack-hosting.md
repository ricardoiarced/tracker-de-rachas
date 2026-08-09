# Hosting full-stack gratuito sin tarjeta

> Corte de investigación: **2026-08-09**. Los planes gratuitos cambian con frecuencia; las cifras y conclusiones siguientes deben revalidarse antes de desplegar.

## Resultado ejecutivo

La opción con menos condiciones pendientes es **Cloudflare Workers + assets estáticos + D1**. No se elige aquí la arquitectura: este stack y tres alternativas condicionadas pasan como insumos al ticket **Elegir la arquitectura y la plataforma de la demo**.

| Candidato | Frontend / backend / datos | Sin tarjeta | Estado para la decisión posterior | Motivo principal |
|---|---|---:|---|---|
| Cloudflare | Workers Static Assets o Pages / Worker o Pages Functions / D1 | **Sí, documentado** | **Pasa** | Una cuenta se crea solo con correo y contraseña; el plan Free es el predeterminado, tiene límites duros y D1 no cobra cómputo inactivo. |
| Netlify | CDN / Functions / Netlify Database (Postgres) | **No afirmado expresamente** | **Pasa condicionado** | Integración completa y límite duro sin recarga, pero hay que validar el alta, solo ofrece 300 créditos compartidos y la tarifa de almacenamiento posterior al 2026-07-01 no está publicada con claridad. |
| Vercel + Neon | Vercel CDN / Vercel Functions / Neon Postgres | **Neon sí; Vercel, probable** | **Pasa condicionado** | El alta de Vercel muestra OAuth/email sin pago y Hobby es Free, pero no hay una promesa expresa contra verificaciones futuras; Neon sí dice “no credit card required”. |
| Railway | Un servicio web / backend en el mismo servicio / SQLite en volumen | **Sí, documentado** | **Pasa solo a prototipo de costo** | El Free permanente aporta apenas USD 1 de uso mensual; puede funcionar con Serverless, pero un Postgres separado probablemente consumiría el presupuesto. |

No hay cargos por excedente sin una migración voluntaria a un plan pago en Cloudflare Free, Neon Free o Netlify Free: al alcanzar sus límites, las operaciones fallan o el proyecto se suspende. Esto protege el requisito de USD 0, pero convierte el agotamiento por abuso en una caída de servicio.

## Comparación operativa

| Stack | Cuotas relevantes | Inactividad, persistencia y regiones | Despliegue y secretos | Seguridad y abuso disponibles | Riesgo de agotamiento |
|---|---|---|---|---|---|
| **Cloudflare Workers + D1** | 100.000 solicitudes dinámicas/día, 10 ms CPU por invocación y 128 MB; assets estáticos sin cargo. D1: 5 M filas leídas/día, 100.000 escritas/día, 5 GB por cuenta, 10 bases y 500 MB por base. | D1 escala a cero sin cobrar capacidad. No se documenta pausa ni caducidad por inactividad. Ubicación automática o hints en Norteamérica, Europa, APAC y Oceanía; no hay hint para Sudamérica. | GitHub/GitLab despliegan automáticamente. URL pública `*.workers.dev`; secretos cifrados por Worker y bindings directos a D1. | Turnstile Free admite desafíos ilimitados; Rate Limiting API permite límites por ruta/clave, pero sus contadores son locales y eventualmente consistentes. D1 cifra en reposo y tránsito. | Al superar Workers se obtiene error 1027; al superar D1 las consultas fallan hasta el reinicio diario. Una consulta sin índice cuenta todas las filas escaneadas. |
| **Netlify integrado** | 300 créditos/mes compartidos: 15 por deploy de producción, 10 por GB-h de Functions o Database, 20/GB de ancho de banda y 2/10.000 requests. Database Free: hasta 5 GB, 48 unidades de cómputo por base y 5 GB de salida, aunque el saldo común se agota antes. | La base duerme a los 5 min; el despertar suele añadir menos de 1 s, sin garantía. Datos persistentes; backups diarios por 3 días. Functions Free queda en Ohio: elegir región es Pro. | Despliegue desde Git, subdominio `*.netlify.app`, Functions versionadas junto al sitio y variables fuera del repositorio. | Dos reglas de rate limit por código en Free, por ruta y dominio+IP; DDoS básico previo al rate limit. | El límite Free es duro: al consumir 300 créditos se pausan **todos** los proyectos hasta el siguiente ciclo. Cada despertar mantiene la base activa al menos 5 min. |
| **Vercel Hobby + Neon Free** | Vercel: 1 M invocaciones, 4 CPU-h, 360 GB-h de memoria, 100 GB de transferencia y 1 M edge requests/mes. Neon por proyecto: 100 CU-h, 0,5 GB, 5 GB de salida, 10 branches. | Neon duerme a los 5 min y conserva datos; el despertar añade cientos de ms. Región fija al crear el proyecto, incluida São Paulo. Vercel Hobby ejecuta Functions en una sola región configurable. | GitHub despliega a `*.vercel.app`; la integración de Postgres inyecta credenciales; variables de Vercel cifradas en reposo. | Vercel Hobby incluye DDoS, protección básica de bots, hasta 3 reglas WAF y 1 regla de rate limit (1 M solicitudes admitidas/mes). Neon Free no ofrece allowlist IP ni red privada: la credencial debe existir solo en Functions. | Hobby suspende por topes y no vende excedentes. Neon suspende compute al agotar CU-h/egress; al llegar a 0,5 GB rechaza escrituras, sin borrar datos. Hobby solo permite uso personal no comercial. |
| **Railway Free + volumen** | USD 1 de crédito/mes; máximo 1 vCPU, 0,5 GB RAM, un volumen de 0,5 GB. RAM cuesta USD 10/GB-mes, CPU USD 20/vCPU-mes y volumen USD 0,15/GB-mes según uso. | Serverless duerme tras 10 min sin tráfico saliente; el primer request puede responder 502. El volumen persiste mientras el plan siga activo; Railway conserva datos 30 días tras expirar Free/Trial. Cuatro regiones, sin Sudamérica. | Autodeploy desde GitHub, `*.railway.app`, TLS y variables sellables. | Mitigación L4, límites generales altos y modo manual “Under Attack”; hace falta rate limiting en la aplicación para operación normal. | USD 1 es muy estrecho. Conexiones o telemetría impiden dormir; dos servicios (API + Postgres) multiplican consumo. Debe probarse un solo servicio con SQLite y límites de réplica. |

Fuentes primarias de la tabla:

- Cloudflare: [alta de cuenta](https://developers.cloudflare.com/fundamentals/account/create-account/), [precio y límites de Workers](https://developers.cloudflare.com/workers/platform/pricing/), [límites de plataforma](https://developers.cloudflare.com/workers/platform/limits/), [precio de D1](https://developers.cloudflare.com/d1/platform/pricing/), [límites de D1](https://developers.cloudflare.com/d1/platform/limits/), [ubicación de D1](https://developers.cloudflare.com/d1/configuration/data-location/), [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [`workers.dev`](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [secretos](https://developers.cloudflare.com/workers/configuration/secrets/), [Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Turnstile Free](https://developers.cloudflare.com/turnstile/plans/) y [seguridad de D1](https://developers.cloudflare.com/d1/reference/data-security/).
- Netlify: [planes por créditos](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [consumo y suspensión](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), [Functions](https://docs.netlify.com/build/functions/overview/), [configuración y regiones](https://docs.netlify.com/build/functions/configuration/), [Database: cobro y límites](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/), [sleep](https://docs.netlify.com/build/data-and-storage/netlify-database/configure-sleep-on-inactivity/), [backups](https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/) y [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).
- Vercel/Neon: [alta de Vercel](https://vercel.com/signup), [Vercel Hobby y cuotas](https://vercel.com/pricing), [límites de Vercel](https://vercel.com/docs/limits), [fair use](https://vercel.com/docs/limits/fair-use-guidelines), [Git](https://vercel.com/docs/git), [URLs generadas](https://vercel.com/docs/deployments/generated-urls), [variables](https://vercel.com/docs/environment-variables), [región de Functions](https://vercel.com/docs/functions/configuring-functions/region), [WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Postgres vía Marketplace](https://vercel.com/docs/postgres), [Neon Free sin tarjeta y cuotas](https://neon.com/pricing) y [regiones de Neon](https://neon.com/docs/introduction/regions).
- Railway: [planes y precios](https://docs.railway.com/pricing/plans), [trial que revierte a Free](https://docs.railway.com/pricing/free-trial), [FAQ sin tarjeta](https://docs.railway.com/pricing/faqs), [Serverless](https://docs.railway.com/deployments/serverless), [volúmenes](https://docs.railway.com/volumes/reference), [dominio público](https://docs.railway.com/networking/public-networking), [GitHub autodeploy](https://docs.railway.com/deployments/github-autodeploys), [regiones](https://docs.railway.com/deployments/regions) y [WAF](https://docs.railway.com/networking/waf).

## Variantes combinadas

| Variante | Viabilidad | Tradeoff frente al shortlist |
|---|---|---|
| GitHub Pages + Cloudflare Worker/D1 | Viable y sin tarjeta. GitHub Pages solo entrega HTML/CSS/JS, por lo que API y datos siguen en Cloudflare. | Dos orígenes, CORS y dos pipelines sin ganar cuota respecto de servir assets con el mismo Worker. [GitHub confirma que Pages es solo hosting estático](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). |
| Vercel o Netlify + Supabase Free | Técnicamente viable: Postgres de 500 MB, 5 GB egress, 500.000 Edge Function invocations y secretos. | Supabase puede pausar tras 7 días de baja actividad; hay que restaurar desde dashboard. Su documentación pública de plan Free no promete explícitamente que nunca pida verificación de pago. [Precios](https://supabase.com/pricing), [billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [checklist de producción y pausa](https://supabase.com/docs/guides/platform/going-into-prod), [límites de Functions](https://supabase.com/docs/guides/functions/limits) y [regiones](https://supabase.com/docs/guides/platform/regions). |
| Render web Free + Neon/Supabase | Posible si la base es externa y el alta no exige verificación adicional. | El backend duerme tras 15 min y tarda cerca de un minuto en volver; la combinación añade CORS/secretos externos sin ventaja clara frente a Vercel/Netlify. |

## Descartes duros

| Opción | Descalificador para este destino | Evidencia oficial |
|---|---|---|
| Fly.io | Exige tarjeta para toda organización normal y ya no ofrece free allowances a cuentas nuevas. | [Pricing](https://fly.io/docs/about/pricing/) |
| Render integrado | El Postgres Free expira a los 30 días y se elimina 14 días después; Key Value Free pierde datos al reiniciar. | [Free instances](https://render.com/docs/free) |
| PythonAnywhere Free | Desde 2026, la web app expira cada mes y las cuentas nuevas no incluyen MySQL; 512 MiB y salida restringida. | [Free Accounts Features](https://help.pythonanywhere.com/pages/FreeAccountsFeatures/) y [pricing](https://www.pythonanywhere.com/pricing/) |
| Firebase full-stack | Spark no pide método de pago y sí ofrece Hosting/Firestore, pero no permite desplegar Cloud Functions; App Hosting requiere Blaze/billing. SQL Connect Free es una prueba de 3 meses y luego archiva/elimina la base. | [planes Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) y [pricing por producto](https://firebase.google.com/pricing) |
| Heroku | No existe cómputo ni Postgres a USD 0: Eco y Essential-0 parten de USD 5/mes. | [pricing](https://www.heroku.com/pricing) y [Eco](https://devcenter.heroku.com/articles/eco-dyno-hours) |
| GitHub Pages solo | Es hosting estático; no satisface backend + base de datos. | [What is GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) |

## Evaluación del artículo de GeeksforGeeks

El artículo [“Top 5 Ways to Host Your Full-Stack App for Free”](https://www.geeksforgeeks.org/blogs/ways-to-host-your-full-stack-app-for-free/) (actualizado el 2025-08-05) sirve **solo como lista de nombres**, no como comparación para este requisito. No comprueba tarjeta, persistencia de base, suspensión, cuotas completas ni costo de excedentes.

| Recomendación del artículo | Utilidad vigente al 2026-08-09 |
|---|---|
| Vercel | **Útil como pista** para frontend/functions, pero necesita una base externa actual (por ejemplo Neon) y Hobby está limitado a uso personal no comercial. |
| Railway | **Útil con corrección importante**: hoy sí existe Free permanente de USD 1/mes después del trial, pero no basta asumir que una API y Postgres separados cabrán. |
| Render | **Útil solo como frontend/backend combinado con DB externa**; su Postgres Free de 30 días incumple persistencia. |
| Fly.io | **Obsoleto para este caso**: tarjeta obligatoria y sin free allowance para altas nuevas. |
| PythonAnywhere | **Obsoleto para este caso**: app mensual y sin base incluida para cuentas nuevas. |

El artículo omite las opciones integradas que mejor encajan hoy: Cloudflare Workers/D1 y Netlify Database.

## Hechos que necesita la decisión de arquitectura

1. **Una sesión demo no puede equivaler a una base o branch.** Los topes son 10 D1 databases, 10 Neon branches y 20 Netlify branches por base. El aislamiento debe ser lógico, con filas asociadas a un identificador de sesión.
2. **El servidor debe crear la sesión.** Debe emitir un token opaco aleatorio, guardarlo en cookie `HttpOnly`, `Secure` y `SameSite`, almacenar solo su hash y derivar de él el alcance de todas las consultas; nunca aceptar un `session_id` arbitrario como autoridad desde el cliente.
3. **La expiración es responsabilidad de la aplicación.** Ningún candidato elimina automáticamente las filas de una sesión demo. Hace falta `expires_at`, rechazo server-side al vencer y limpieza perezosa y/o programada. Esto también limita almacenamiento y abuso.
4. **No hacen falta cuentas de usuario ni Auth gestionado.** Turnstile/CAPTCHA en la creación de sesión no convierte la sesión en cuenta; su token debe validarse en backend y es de uso único. [Cloudflare exige validación server-side de Turnstile](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
5. **El presupuesto de abuso debe ser explícito.** Limitar creación de sesiones, requests por sesión/ruta, tamaño de payload, número de hábitos/eventos y vida máxima; validar esquema y métodos; aplicar CSP y cabeceras; no exponer credenciales de DB al navegador.
6. **Mismo origen reduce superficie.** Servir frontend y API bajo el subdominio del mismo proveedor evita CORS. Una combinación con DB externa sigue siendo segura si la conexión existe solo en el backend y la región de Functions coincide con la DB.
7. **Diseñar para fallo cerrado del free tier.** Cloudflare y Neon devuelven errores al agotar cuota; Netlify pausa el sitio completo; Railway detiene workloads. La UI necesita mensaje de indisponibilidad/reintento, y la operación necesita métricas/alertas y limpieza de sesiones.
8. **Indexar por sesión y expiración.** En D1 cuentan filas escaneadas, no solo devueltas; consultas sin índices pueden agotar 5 M lecturas/día. El esquema debe permitir borrar por expiración en lotes pequeños.
9. **Los límites de CPU condicionan la criptografía y limpieza.** Workers Free permite 10 ms CPU por request; el handler debe ser liviano, evitar barridos globales y medir cualquier hash/KDF elegido.
10. **El subdominio gratuito es suficiente, no un SLA.** `workers.dev`, `netlify.app`, `vercel.app` y `railway.app` cumplen publicación pública, pero los propios proveedores clasifican estos planes como hobby/prototipo y pueden suspender por abuso.

## Incertidumbres y verificaciones pendientes

- **Netlify Database:** su documentación aún dice que el almacenamiento sería cobrado “no antes del 2026-07-01”, fecha ya pasada, pero no publica la tasa vigente. Confirmar en dashboard cuánto crédito consume almacenamiento antes de elegirlo.
- **Netlify sin tarjeta:** Free afirma “You'll never be charged” y no permite recarga, pero la documentación pública no promete que el alta nunca pida tarjeta como verificación. Probar el alta antes de considerarlo conforme.
- **Vercel:** la página de alta ofrece OAuth/email sin pago y Hobby es “Free forever”, con límites duros y sin compra de excedentes, pero no encontré una promesa primaria explícita de “no credit card required”. Probar el alta antes de considerarlo conforme.
- **Cloudflare Rate Limiting API:** la API está documentada para Workers, pero la página no publica una cuota/precio separado ni garantiza con precisión global; confirmar que el binding esté habilitado en Workers Free y complementarlo con límites de aplicación. Turnstile Free sí está documentado.
- **Railway:** el Free de USD 1 es reciente y la factibilidad depende del consumo real. Medir al menos una semana, confirmar que SQLite con volumen puede dormir y aceptar que el primer request puede dar 502.
- **Persistencia por inactividad en Cloudflare:** no se encontró una política de pausa o expiración de D1 equivalente a Supabase/Render; esto significa “no documentada”, no una garantía contractual de permanencia.
- **Todos los planes:** revalidar pricing, términos de uso, disponibilidad regional y flujo sin tarjeta el día del despliegue. Ningún plan Free ofrece SLA ni resistencia absoluta a DDoS.
