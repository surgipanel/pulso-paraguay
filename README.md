# El Prócer

**Libres para informar.** Diario digital de Paraguay que agrupa la cobertura de los medios paraguayos en **acontecimientos**: un título y un resumen propios por hecho, puntos clave y enlaces a todas las notas originales. Se actualiza solo dos veces por día (05:00 y 17:00, hora de Asunción) sin que nadie tenga nada abierto.

## Arquitectura (y por qué)

```
GitHub Actions (cron 05:07, 09:37, 13:07, 16:37 y 20:07 America/Asuncion)
   └─ node scripts/update.mjs
        ├─ lee RSS / Atom / sitemap de noticias de cada medio
        ├─ descarta notas sin fecha o fuera de las últimas 24 h
        ├─ agrupa notas que cubren el mismo hecho
        ├─ redacta título + resumen (40–70 palabras) + puntos clave  ← Claude (API de Anthropic)
        ├─ fusiona con la edición del día (máx. 50 acontecimientos, mínimo por sección, sin duplicar)
        └─ escribe docs/data/*.json  →  commit al repositorio
GitHub Pages sirve docs/  (web estática: portada, categorías, buscador, detalle, guardadas, medios, archivo, criterios)
   └─ dominio propio: elprocer.com.py (DNS en Bluehost apuntando a GitHub Pages)
```

- **Sin servidor propio.** El "backend" es un script de Node que corre dentro de GitHub Actions. El almacenamiento persistente es el propio repositorio (`docs/data/`): cada edición es un archivo JSON versionado, y el archivo histórico sale gratis.
- **Programador real.** El cron de GitHub Actions corre aunque tu computadora esté apagada. GitHub admite `timezone: America/Asuncion` por entrada de cron, así que los horarios no dependen de la hora UTC.
- **Frontend estático** (HTML + CSS + JS sin frameworks ni build). Carga los JSON y los muestra. "Guardadas" se guarda en el navegador (localStorage).
- **IA opcional y declarada.** Con `ANTHROPIC_API_KEY`, Claude redacta título, resumen y puntos clave. Sin clave, el sistema publica igual con **resúmenes extractivos** (extractos del medio) marcados en la web como "sin IA". Nunca se presenta un extracto como texto generado por IA.

## Identidad visual (desde el 17/10/2026)

La web aplica el **Manual de Marca El Prócer v1.0**: azul noche `#071C39` (color dominante), blanco, rojo editorial `#E52531` solo para alertas, la franja del logotipo y el destacado activo, y azul digital `#1455A4` para enlaces. Titulares en serif (Liberation Serif; en la web se carga **Tinos**, la misma letra publicada en Google Fonts) y texto e interfaz en **Lato**. Cabecera centrada con lema, navegación sobria con regla gruesa, tarjetas sin cajas separadas por filetes, modo oscuro automático. El favicon es el monograma EP provisorio del manual.

Las variables de entorno y del repositorio conservan el prefijo `PULSO_` (`PULSO_MODEL`, `PULSO_AI_MODE`, `PULSO_MAX_EVENTS`) para no romper la configuración ya cargada en GitHub.

## Qué quedó funcionando (verificado el 11/10/2026)

| Pieza | Estado |
|---|---|
| Lectura de medios | ABC Color, La Nación, Última Hora, El Nacional, ADN Digital y HOY conectan y aportan notas del día. HOY congeló su RSS en diciembre de 2023: desde el 17/10/2026 se leen los enlaces con fecha de su portada y la cabecera pública de cada nota (tipo `portada`). 5Días no publica RSS pero sí un sitemap de noticias (`sitemap-latest.xml`), en uso desde el 17/10/2026. Agencia IP se mudó a mediosdelestado.gov.py (feed al día, pocas notas por semana). NPY, Telefuturo, Vanguardia y 5Días conectan bien pero publican poco o nada los fines de semana: esos días figuran como "sin notas recientes". |
| Verificación de fecha | Toda nota necesita fecha; se descarta lo que supera 24 h. Un feed cuya nota más nueva supera 48 h se marca "devuelve notas viejas". |
| Agrupación por hecho | TF-IDF + nombres propios/cifras + palabras raras compartidas + ventana de 36 h. En una corrida real: 256 notas → 210 grupos, 17 con más de un medio. |
| Edición del día | Hasta 50 acontecimientos por día (máximo 12 por sección). Antes de ordenar por relevancia se reserva un mínimo de 4 por sección y, al elegir qué grupos se redactan, un mínimo de 5: así Cultura y Tecnología no quedan vacías. Una edición completa a la mañana y cuatro actualizaciones que suman novedades y reescriben lo que cambió. En la web, una sección con pocas novedades se completa con lo más reciente de los tres días anteriores, marcado con su fecha. |
| Fallos | Si una corrida falla, `latest.json` conserva la última edición válida con su fecha real y el mensaje de error; la web lo muestra. Guardia contra corridas duplicadas (3 h por turno), reintentos limitados en descargas y en la IA, registro en `runs.json`. |
| Web | Portada con tarjetas, 7 secciones (País y Política solo Paraguay; Internacional; Economía, Deportes, Cultura y Tecnología mixtas), buscador (edición actual y archivo), detalle con resumen/puntos clave/fuentes (enlaces discretos a cada nota original), guardadas, estado de última actualización, archivo de ediciones. La página de medios con el estado real de cada conexión existe pero no aparece en ningún menú: uso interno, solo por URL directa `elprocer.com.py/#/medios` (no es privada: cualquiera con el enlace la ve). Desde el 18/10/2026 no se declara la IA en cada noticia, solo en Criterios y en el pie. Claro/oscuro automático, pensada para celular. |
| Corrida real local | Ejecutada en modo extractivo (sin clave): 20 acontecimientos publicados en `docs/data/editions/2026-10-11.json`. |

## Qué necesita una credencial o configuración tuya

1. **Clave de Anthropic** (para resúmenes con IA). Sin ella, el modo es extractivo. No está probado en vivo el camino con IA porque en esta máquina no había clave: la primera corrida con clave hay que mirarla (ver "Probar" abajo).
2. **Repositorio en GitHub** + activar Pages + cargar el secreto. Hasta que no hagas esto y veas una corrida verde en la pestaña Actions, **la automatización no está activa**.

## Despliegue paso a paso

Requisitos: cuenta de GitHub, `git` instalado.

1. Creá un repositorio **público** en GitHub (por ejemplo `pulso-paraguay`). Público = minutos de Actions ilimitados y Pages gratis. (En un repo privado los Actions tienen 2.000 min/mes gratis, que también alcanzan: cada corrida dura ~3 min, ~180 min/mes; pero Pages en privado requiere plan pago.)
2. Subí este proyecto:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/pulso-paraguay.git
   git push -u origin main
   ```
3. **Pages**: Settings → Pages → Source "Deploy from a branch" → Branch `main`, carpeta `/docs` → Save. En unos minutos la web queda en `https://TU_USUARIO.github.io/pulso-paraguay/`.
4. **Secreto de la IA**: Settings → Secrets and variables → Actions → New repository secret → nombre `ANTHROPIC_API_KEY`, valor: tu clave de https://console.anthropic.com. La clave nunca va al HTML, al navegador ni al repositorio; solo vive en el entorno de la corrida.
5. (Opcional) Variables en Settings → Secrets and variables → Actions → **Variables**: `PULSO_MODEL` (por defecto `claude-opus-5-5`; alternativa barata `claude-haiku-4-5`), `PULSO_AI_MODE` (`auto` u `off`), `PULSO_MAX_EVENTS` (20).
6. **Permisos del bot**: Settings → Actions → General → Workflow permissions → "Read and write permissions" → Save (el workflow necesita hacer commit de `docs/data`).
7. **Primera corrida manual**: pestaña Actions → "Actualizar edición" → Run workflow. Esperá que termine en verde y abrí la web: el estado arriba debe decir "Resúmenes con IA (claude-…)".
8. A partir de ahí el cron corre solo a las 05:07, 09:37, 13:07, 16:37 y 20:07 (hora de Asunción). Se eligió :07 porque GitHub demora más los horarios "en punto". GitHub advierte que un cron puede atrasarse varios minutos (a veces más) en horas de mucha carga; no es un fallo del sistema.

### Probar la corrida con IA antes de confiar en el cron

Después del paso 7, revisá en la pestaña Actions el log de la corrida: la línea `Redacción: ia (modelo …)` y las líneas `IA lote: N eventos, …, tokens in=… out=…`. En la web, cada acontecimiento muestra "resumen con IA" y una nota al pie con el modelo. Si algún lote de la IA falla, ese grupo cae a extractivo y se marca "sin IA"; el estado general dice "mixto".

## Dominio propio: elprocer.com.py (Bluehost → GitHub Pages)

El dominio está registrado en Bluehost. No hace falta alojar archivos ahí: basta con que su DNS apunte a GitHub Pages, que sirve la web y emite el certificado HTTPS gratis. El cron y los commits del bot no cambian.

**Orden importante: primero el DNS en Bluehost, después el dominio en GitHub.** Si se configura primero en GitHub, la URL `surgipanel.github.io/pulso-paraguay` empieza a redirigir al dominio antes de que este responda.

1. **Bluehost** → Domains → elprocer.com.py → DNS (zona avanzada):
   - Borrar el registro **A** de `@` que apunta al servidor de Bluehost (hoy 74.220.219.243).
   - Crear cuatro registros **A** para `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
   - Crear un registro **CNAME** para `www` → `surgipanel.github.io`.
   - Guardar. La propagación suele tardar de minutos a un par de horas.
2. Comprobar desde una terminal: `nslookup elprocer.com.py` debe devolver alguna de las IP 185.199.x.153.
3. **GitHub** → repositorio `surgipanel/pulso-paraguay` → Settings → Pages → **Custom domain**: `elprocer.com.py` → Save. GitHub crea el archivo `docs/CNAME` con un commit (conviene hacer `git pull` después).
4. Esperar a que la verificación DNS quede en verde y marcar **Enforce HTTPS** (el certificado puede tardar hasta una hora).
5. Opcional pero recomendable: Settings de la cuenta/organización → Pages → **Verified domains** → verificar `elprocer.com.py` con el registro TXT que indica GitHub. Evita que otro repositorio pueda reclamar el dominio.

Resultado: `https://elprocer.com.py` y `https://www.elprocer.com.py` sirven la web; `surgipanel.github.io/pulso-paraguay` redirige al dominio.

## Costos reales (verificados 11/10/2026)

| Servicio | Condición vigente | Puede costar |
|---|---|---|
| GitHub Actions | Repos públicos: minutos ilimitados. Privados: 2.000 min/mes gratis. | Nada en público. Un repo privado con corridas muy largas podría exceder los 2.000 min (acá ~180 min/mes). |
| GitHub Pages | Gratis en repos públicos. Límites blandos: 100 GB/mes de tráfico, 10 builds/hora, sitio ≤ 1 GB. | Nada para un diario personal; con tráfico masivo GitHub pide reducirlo. |
| Anthropic (Claude) | Sin plan gratuito; se paga por token. Opus 5.5: USD 4 / 20 por millón de tokens de entrada / salida. Haiku 4.5: USD 1 / 5. | Estimación con 6 llamadas por corrida (~30 k tokens entrada, ~12 k salida): **Opus 5.5 ≈ USD 0,36 por corrida ≈ USD 22/mes**; **Haiku 4.5 ≈ USD 0,09 por corrida ≈ USD 5,5/mes**. El modelo se cambia con la variable `PULSO_MODEL`; el log de cada corrida imprime los tokens usados. |
| Medios | Solo feeds públicos (o la portada, en el caso de HOY), con identificación del agente y respetando `Crawl-delay` (Última Hora, NPY y Telefuturo: 10 s entre notas). No se copian artículos completos: se usan extractos ≤ 700 caracteres como insumo y se enlaza siempre a la fuente. | Nada. |

Advertencias de GitHub a tener en cuenta:
- En repos públicos, **los cron se desactivan solos si el repositorio no tiene actividad en 60 días**. Los commits del bot suelen contar como actividad, pero conviene entrar a la pestaña Actions cada tanto; si aparece "This scheduled workflow is disabled", se reactiva con un clic.
- Los horarios programados pueden demorarse en momentos de carga.

## Correr en tu computadora

```bash
npm install
cp .env.example .env         # cargá ANTHROPIC_API_KEY si querés IA (opcional)
npm run check-sources        # solo verifica los medios, no escribe nada
npm run update               # corrida completa → docs/data
npm run serve                # http://localhost:4173
```

En Windows, en vez de `.env` podés definir la variable en PowerShell: `$env:ANTHROPIC_API_KEY = "..."` antes de `npm run update`.

## Estructura

```
.github/workflows/update.yml   programador (cron) + commit de datos
scripts/update.mjs             corrida editorial completa (CLI)
scripts/serve.mjs              servidor local para ver docs/
scripts/mercado.mjs            baja la cotización de referencia del BCP (sin IA) → docs/data/mercado.json
src/config.mjs                 parámetros (zona horaria, máximos, modelo, ventana)
src/sources.mjs                registro de medios (qué URL, qué tipo, notas de verificación)
src/fetch.mjs                  descarga con reintentos, parseo RSS/Atom/sitemap, verificación de fechas
src/cluster.mjs                agrupación por acontecimiento
src/heuristics.mjs             categoría y alcance sin IA
src/summarize.mjs              redacción con Claude (JSON validado) y modo extractivo
src/edition.mjs                fusión con la edición del día, máximo diario, sin duplicados
src/store.mjs                  lectura/escritura de docs/data
docs/                          la web (index.html, app.js, styles.css) + data/
docs/data/latest.json          puntero a la edición vigente + estado de la última corrida
docs/data/editions/AAAA-MM-DD.json   una edición por día
docs/data/editions/index.json  archivo
docs/data/sources.json         estado real de cada medio
docs/data/runs.json            registro de corridas (ok/error, conteos, tokens)
docs/data/mercado.json         cotizaciones de referencia del BCP (scripts/mercado.mjs, workflow mercado.yml)
```

## Datos del día (cotizaciones y clima)

Debajo de la fecha de edición hay una franja fina con la cotización de referencia del Banco Central del Paraguay (USD, BRL, ARS, EUR) y la temperatura actual en Asunción; al tocarla se abre una ventana con la tabla completa, el dólar interbancario (compra/venta) y el pronóstico de cuatro días.

- **Cotizaciones**: `scripts/mercado.mjs` lee las páginas públicas del BCP (su robots.txt no restringe) y escribe `docs/data/mercado.json`. El workflow `mercado.yml` lo corre cada dos horas en días hábiles (08:23 a 18:23, hora de Asunción), sin IA ni claves, y solo commitea si cambió algo. Se descartó la API de una casa de cambios porque su robots.txt la prohíbe. Las cotizaciones de ventanilla (bancos, casas de cambio) difieren de la referencia del BCP; mostrar la de un banco requiere un acuerdo con ese banco.
- **Clima**: el navegador consulta Open-Meteo (gratis, sin clave) y guarda la respuesta 15 minutos.

## Fotos

Cada foto se verifica antes de publicarse pidiéndola como lo hace un navegador (`probeImage` en `src/fetch.mjs`). Se guarda la dirección final tras las redirecciones: algunas direcciones viejas de ABC y La Nación (`www.medio/resizer/...=/cloudfront...`) redirigen a su CDN y a veces cortan la conexión a los navegadores. En los CDN de Arc se pide un ancho de 1200 px. Si la foto de una nota no carga, se prueba la de otra nota del mismo hecho.

Las fotos genéricas de sección (ABC pone «Internacionales», «Ciencia» o fútbol internacional a las notas de agencia sin foto propia; La Nación, «Mundo») no se usan nunca. `src/images.mjs` las detecta solo: una foto repetida en notas de hechos distintos cuyos títulos no comparten ningún nombre propio ni cifra. Las detectadas se guardan en `docs/data/generic-images.json`. Si ningún medio tiene foto propia del hecho, la web muestra una imagen de El Prócer con el nombre de la sección (`docs/img/seccion-*.png`), que también reemplaza a cualquier foto que no cargue.

## Compartir e ícono

`docs/og-image.png` (1200×630) es la vista previa al compartir en WhatsApp y redes; `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` y `site.webmanifest` dan el ícono EP al agregar el sitio a la pantalla de inicio. Como la web es una sola página, la vista previa es la misma para cualquier enlace.

## Reglas editoriales que aplica el sistema

- No inventa: el modelo solo recibe título, extracto y fecha de cada nota y tiene prohibido agregar datos. El JSON de respuesta se valida (ids de notas, categoría, largo del resumen) y se reintenta una vez con las observaciones concretas.
- Atribuye denuncias y acusaciones; distingue proyecto de ley de ley, media sanción de sanción, imputación de condena.
- Un hecho = un acontecimiento: la IA puede dividir un grupo que mezcle hechos distintos. En modo extractivo la agrupación es más conservadora porque nadie la revisa después.
- Cada acontecimiento enlaza a todas las notas usadas, con medio y hora.
