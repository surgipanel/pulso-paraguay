# Pulso Paraguay

Diario digital que agrupa la cobertura de los medios paraguayos en **acontecimientos**: un título y un resumen propios por hecho, puntos clave y enlaces a todas las notas originales. Se actualiza solo dos veces por día (05:00 y 17:00, hora de Asunción) sin que nadie tenga nada abierto.

## Arquitectura (y por qué)

```
GitHub Actions (cron 05:07 y 17:07 America/Asuncion)
   └─ node scripts/update.mjs
        ├─ lee RSS / Atom / sitemap de noticias de cada medio
        ├─ descarta notas sin fecha o fuera de las últimas 24 h
        ├─ agrupa notas que cubren el mismo hecho
        ├─ redacta título + resumen (40–70 palabras) + puntos clave  ← Claude (API de Anthropic)
        ├─ fusiona con la edición del día (máx. 20 acontecimientos, sin duplicar)
        └─ escribe docs/data/*.json  →  commit al repositorio
GitHub Pages sirve docs/  (web estática: portada, categorías, buscador, detalle, guardadas, medios, archivo)
```

- **Sin servidor propio.** El "backend" es un script de Node que corre dentro de GitHub Actions. El almacenamiento persistente es el propio repositorio (`docs/data/`): cada edición es un archivo JSON versionado, y el archivo histórico sale gratis.
- **Programador real.** El cron de GitHub Actions corre aunque tu computadora esté apagada. GitHub admite `timezone: America/Asuncion` por entrada de cron, así que los horarios no dependen de la hora UTC.
- **Frontend estático** (HTML + CSS + JS sin frameworks ni build). Carga los JSON y los muestra. "Guardadas" se guarda en el navegador (localStorage).
- **IA opcional y declarada.** Con `ANTHROPIC_API_KEY`, Claude redacta título, resumen y puntos clave. Sin clave, el sistema publica igual con **resúmenes extractivos** (extractos del medio) marcados en la web como "sin IA". Nunca se presenta un extracto como texto generado por IA.

## Qué quedó funcionando (verificado el 11/10/2026)

| Pieza | Estado |
|---|---|
| Lectura de medios | ABC Color, La Nación, Última Hora, El Nacional, ADN Digital conectan y aportan notas del día. NPY, Telefuturo y Vanguardia conectan pero no habían publicado en las últimas 24 h (domingo). HOY devuelve notas de 2023 y Agencia IP de agosto: se detectan como "viejos" y no se usan. 5Días no expone RSS ni sitemap de noticias: no se raspa. |
| Verificación de fecha | Toda nota necesita fecha; se descarta lo que supera 24 h. Un feed cuya nota más nueva supera 48 h se marca "devuelve notas viejas". |
| Agrupación por hecho | TF-IDF + nombres propios/cifras + palabras raras compartidas + ventana de 36 h. En una corrida real: 256 notas → 210 grupos, 17 con más de un medio. |
| Edición del día | Máximo 20 acontecimientos por día en total; la corrida de la tarde actualiza los de la mañana (suma fuentes, reescribe) y agrega novedades sin duplicar. Si hay menos de 20 verificables, publica menos y lo dice. |
| Fallos | Si una corrida falla, `latest.json` conserva la última edición válida con su fecha real y el mensaje de error; la web lo muestra. Guardia contra corridas duplicadas (3 h por turno), reintentos limitados en descargas y en la IA, registro en `runs.json`. |
| Web | Portada con tarjetas, 6 categorías, buscador (edición actual y archivo), detalle con resumen/puntos clave/fuentes, guardadas, estado de última actualización, página de medios con estado real, archivo de ediciones. Claro/oscuro automático, pensada para celular. |
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
8. A partir de ahí el cron corre solo a las 05:07 y 17:07 (hora de Asunción). Se eligió :07 porque GitHub demora más los horarios "en punto". GitHub advierte que un cron puede atrasarse varios minutos (a veces más) en horas de mucha carga; no es un fallo del sistema.

### Probar la corrida con IA antes de confiar en el cron

Después del paso 7, revisá en la pestaña Actions el log de la corrida: la línea `Redacción: ia (modelo …)` y las líneas `IA lote: N eventos, …, tokens in=… out=…`. En la web, cada acontecimiento muestra "resumen con IA" y una nota al pie con el modelo. Si algún lote de la IA falla, ese grupo cae a extractivo y se marca "sin IA"; el estado general dice "mixto".

## Costos reales (verificados 11/10/2026)

| Servicio | Condición vigente | Puede costar |
|---|---|---|
| GitHub Actions | Repos públicos: minutos ilimitados. Privados: 2.000 min/mes gratis. | Nada en público. Un repo privado con corridas muy largas podría exceder los 2.000 min (acá ~180 min/mes). |
| GitHub Pages | Gratis en repos públicos. Límites blandos: 100 GB/mes de tráfico, 10 builds/hora, sitio ≤ 1 GB. | Nada para un diario personal; con tráfico masivo GitHub pide reducirlo. |
| Anthropic (Claude) | Sin plan gratuito; se paga por token. Opus 5.5: USD 4 / 20 por millón de tokens de entrada / salida. Haiku 4.5: USD 1 / 5. | Estimación con 6 llamadas por corrida (~30 k tokens entrada, ~12 k salida): **Opus 5.5 ≈ USD 0,36 por corrida ≈ USD 22/mes**; **Haiku 4.5 ≈ USD 0,09 por corrida ≈ USD 5,5/mes**. El modelo se cambia con la variable `PULSO_MODEL`; el log de cada corrida imprime los tokens usados. |
| Medios | Solo feeds públicos, con identificación del agente y respetando `Crawl-delay` (Última Hora: 10 s entre notas). No se copian artículos completos: se usan extractos ≤ 700 caracteres como insumo y se enlaza siempre a la fuente. | Nada. |

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
```

## Reglas editoriales que aplica el sistema

- No inventa: el modelo solo recibe título, extracto y fecha de cada nota y tiene prohibido agregar datos. El JSON de respuesta se valida (ids de notas, categoría, largo del resumen) y se reintenta una vez con las observaciones concretas.
- Atribuye denuncias y acusaciones; distingue proyecto de ley de ley, media sanción de sanción, imputación de condena.
- Un hecho = un acontecimiento: la IA puede dividir un grupo que mezcle hechos distintos. En modo extractivo la agrupación es más conservadora porque nadie la revisa después.
- Cada acontecimiento enlaza a todas las notas usadas, con medio y hora.
