/* El Prócer — frontend estático. Lee los JSON de data/ generados por el proceso editorial. */
(() => {
  "use strict";

  const SITE = "El Prócer";
  const TZ = "America/Asuncion";
  const CATS = [
    { id: "pais", label: "País" },
    { id: "politica", label: "Política" },
    { id: "economia", label: "Economía" },
    { id: "deportes", label: "Deportes" },
    { id: "cultura", label: "Cultura" },
    { id: "tecnologia", label: "Tecnología" },
  ];
  const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c.id, c.label]));
  const SAVED_KEY = "procer.saved.v1";
  const LEGACY_SAVED_KEY = "pulso.saved.v1";

  const $ = (sel, el = document) => el.querySelector(sel);
  const main = $("#main");
  const statusEl = $("#status");
  const catsEl = $("#cats");
  const searchInput = $("#search-input");

  const state = { latest: null, editions: {}, index: null, sources: null, saved: loadSaved() };

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtDateTime = (iso) => (iso ? new Intl.DateTimeFormat("es-PY", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—");
  const fmtTime = (iso) => (iso ? new Intl.DateTimeFormat("es-PY", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—");
  const fmtDay = (ymd) => {
    if (!ymd) return "—";
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const distinctSources = (ev) => [...new Map(ev.sources.map((s) => [s.sourceId, s.sourceName])).values()];
  const latestAt = (ev) => ev.sources.map((s) => s.publishedAt).sort().at(-1);
  const relTime = (iso) => {
    if (!iso) return "";
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "recién";
    if (mins < 60) return `hace ${mins} min`;
    const h = Math.round(mins / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const srcLine = (ev, max = 2) => {
    const names = distinctSources(ev);
    const shown = names.slice(0, max).join(" · ");
    return names.length > max ? `${shown} · +${names.length - max}` : shown;
  };
  const srcSentence = (ev) => {
    const names = distinctSources(ev);
    if (names.length <= 3) return names.join(", ").replace(/, ([^,]*)$/, " y $1");
    return `${names.slice(0, 3).join(", ")} y ${plural(names.length - 3, "medio más", "medios más")}`;
  };
  const setTitle = (t) => { document.title = t ? `${t} | ${SITE}` : `${SITE} | Libres para informar`; };

  function loadSaved() {
    try {
      const cur = localStorage.getItem(SAVED_KEY);
      if (cur) return JSON.parse(cur);
      const legacy = localStorage.getItem(LEGACY_SAVED_KEY);
      if (legacy) { localStorage.setItem(SAVED_KEY, legacy); return JSON.parse(legacy); }
    } catch {}
    return {};
  }
  function persistSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved)); } catch {}
    const n = Object.keys(state.saved).length;
    const b = $("#saved-count");
    if (b) { b.textContent = n; b.hidden = n === 0; }
  }
  function toggleSave(ev, editionDate) {
    if (state.saved[ev.id]) delete state.saved[ev.id];
    else state.saved[ev.id] = { event: ev, editionDate, savedAt: new Date().toISOString() };
    persistSaved();
  }

  async function getJson(path) {
    const res = await fetch(`${path}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }
  async function loadEdition(date) {
    if (!date) return null;
    if (!state.editions[date]) state.editions[date] = await getJson(`data/editions/${date}.json`);
    return state.editions[date];
  }

  // ---------- cabecera: estado, fecha, navegación ----------
  function renderStatus() {
    const l = state.latest;
    const dateEl = $("#edition-date");
    if (!l) {
      statusEl.innerHTML = `<span class="dot bad"></span> Todavía no hay ninguna edición publicada.`;
      dateEl.textContent = "Edición digital";
      return;
    }
    dateEl.textContent = `Edición digital · ${fmtDay(l.editionDate)}`;
    const mode = l.aiMode === "ia" ? "redacción con IA" : l.aiMode === "mixto" ? "redacción con IA y extractos" : "resúmenes extractivos, sin IA";
    statusEl.innerHTML = `
      <span class="dot ${l.ok ? "" : "bad"}"></span>
      <span>Actualizado <b>${esc(fmtDateTime(l.generatedAt))}</b> (${esc(relTime(l.generatedAt))})</span>
      <span>·</span><span>${l.eventsCount} de hasta ${l.maxEvents ?? 20} acontecimientos</span>
      <span>·</span><span>${mode}</span>`;
    if (!l.ok) {
      statusEl.insertAdjacentHTML("beforeend", `<div class="alert">${esc(l.message || "La última actualización falló.")} Se muestra la última edición válida${l.lastSuccessAt ? `, generada el ${esc(fmtDateTime(l.lastSuccessAt))}` : ""}.</div>`);
    }
    $("#foot-meta").textContent = `${plural(l.editions ?? 1, "edición", "ediciones")} en el archivo · Horarios de Asunción · Las fotos se muestran desde el sitio de cada medio y les pertenecen.`;
  }

  function renderCats(active, tool) {
    const items = [{ id: "", label: "Portada" }, ...CATS];
    const savedN = Object.keys(state.saved).length;
    catsEl.innerHTML = items
      .map((c) => `<a href="#/${c.id ? "categoria/" + c.id : ""}" class="${active === c.id ? "is-active" : ""}">${esc(c.label)}</a>`)
      .join("") +
      `<span class="nav__gap" aria-hidden="true"></span>` +
      [
        ["guardadas", `Guardadas<span class="badge" id="saved-count" ${savedN ? "" : "hidden"}>${savedN}</span>`],
        ["archivo", "Archivo"],
        ["criterios", "Criterios"],
      ].map(([id, html]) => `<a href="#/${id}" class="nav__tool ${tool === id ? "is-active" : ""}" data-nav="${id}">${html}</a>`).join("");
  }

  // ---------- piezas ----------
  function mediaHtml(ev, { credit = false } = {}) {
    const initial = (CAT_LABEL[ev.category] ?? "P")[0];
    if (!ev.image?.url) return `<div class="media is-empty" data-initial="${esc(initial)}"></div>`;
    return `<div class="media" data-initial="${esc(initial)}">
      <img src="${esc(ev.image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('is-empty')">
      ${credit ? `<span class="media__credit">Foto: ${esc(ev.image.credit)}</span>` : ""}
    </div>`;
  }
  function kickerHtml(ev, extra) {
    const updated = ev.updatedAt && ev.updatedAt !== ev.firstSeenAt;
    return `<p class="kicker">${esc(CAT_LABEL[ev.category] ?? ev.category)}<span class="sep">·</span>${esc(extra ?? fmtTime(latestAt(ev)))}${updated ? ` <span class="tag updated">actualizado</span>` : ""}${ev.summaryKind === "extractivo" ? ` <span class="tag extractivo" title="Resumen armado con extractos del medio, sin IA">sin IA</span>` : ""}</p>`;
  }
  function saveBtn(ev, editionDate) {
    const saved = Boolean(state.saved[ev.id]);
    return `<button class="save ${saved ? "is-saved" : ""}" data-save="${esc(ev.id)}" data-edition="${esc(editionDate)}" aria-pressed="${saved}">${saved ? "✓ Guardada" : "Guardar"}</button>`;
  }
  const link = (ev, editionDate) => `#/noticia/${esc(ev.id)}?e=${esc(editionDate)}`;

  function cardHtml(ev, editionDate, variant = "") {
    return `
      <article class="card ${variant}">
        <a href="${link(ev, editionDate)}" tabindex="-1" aria-hidden="true">${mediaHtml(ev)}</a>
        ${kickerHtml(ev)}
        <h3 class="card__title"><a href="${link(ev, editionDate)}">${esc(ev.title)}</a></h3>
        <p class="card__summary">${esc(ev.summary)}</p>
        <div class="card__foot">
          <span class="srcs" title="${esc(distinctSources(ev).join(", "))}">${esc(srcLine(ev))}</span>
          ${saveBtn(ev, editionDate)}
        </div>
      </article>`;
  }

  function leadHtml(ev, editionDate) {
    return `
      <article class="lead">
        <a href="${link(ev, editionDate)}" tabindex="-1" aria-hidden="true">${mediaHtml(ev)}</a>
        ${kickerHtml(ev)}
        <h2 class="lead__title"><a href="${link(ev, editionDate)}">${esc(ev.title)}</a></h2>
        <p class="lead__deck">${esc(ev.summary)}</p>
        <p class="lead__meta">Cobertura: ${esc(srcSentence(ev))}.</p>
        <div class="lead__actions">
          <a class="readmore" href="${link(ev, editionDate)}">Leer el acontecimiento →</a>
          ${saveBtn(ev, editionDate)}
        </div>
      </article>`;
  }

  function bindSaveButtons(root, lookup) {
    root.querySelectorAll("[data-save]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const ev = lookup(btn.dataset.save);
        if (!ev) return;
        toggleSave(ev, btn.dataset.edition);
        const saved = Boolean(state.saved[ev.id]);
        btn.classList.toggle("is-saved", saved);
        btn.setAttribute("aria-pressed", String(saved));
        btn.textContent = saved ? "✓ Guardada" : "Guardar";
      });
    });
  }

  function gridView({ title, events, editionDate, count, emptyText, lede }) {
    main.innerHTML = `
      <div class="page-head"><h1>${esc(title)}</h1><span class="count">${esc(count ?? "")}</span></div>
      ${lede ? `<p class="lede">${lede}</p>` : ""}
      ${events.length ? `<div class="grid">${events.map((ev) => cardHtml(ev, editionDate)).join("")}</div>` : `<p class="empty">${esc(emptyText || "No hay acontecimientos en esta sección.")}</p>`}`;
    const byId = new Map(events.map((e) => [e.id, e]));
    bindSaveButtons(main, (id) => byId.get(id));
  }

  // ---------- vistas ----------
  async function viewHome(archiveDate) {
    const date = archiveDate || state.latest?.editionDate;
    const edition = await loadEdition(date);
    renderCats("", archiveDate ? "archivo" : null);
    setTitle(archiveDate ? `Edición del ${fmtDay(date)}` : "");
    if (!edition || !edition.events.length) {
      main.innerHTML = `<p class="empty">Todavía no hay una edición publicada.</p>`;
      return;
    }
    const events = edition.events; // ya vienen ordenados por cobertura y recencia
    const lead = events[0];
    const second = events.slice(1, 3);
    const rest = events.slice(3);
    const mostCovered = [...events]
      .filter((e) => e !== lead)
      .sort((a, b) => distinctSources(b).length - distinctSources(a).length || (latestAt(b) < latestAt(a) ? -1 : 1))
      .slice(0, 5);
    const sections = CATS.map((c) => ({ ...c, events: rest.filter((e) => e.category === c.id) })).filter((s) => s.events.length);
    main.innerHTML = `
      ${archiveDate ? `<div class="page-head"><h1>Edición del ${esc(fmtDay(date))}</h1><span class="count">${events.length} acontecimientos · ${edition.aiMode === "extractivo" ? "sin IA" : "con IA"}</span></div>` : ""}
      <div class="front">
        <div class="front__lead">${leadHtml(lead, date)}</div>
        <div class="front__second second">${second.map((ev) => cardHtml(ev, date, "card--second")).join("")}</div>
        <aside class="front__aside">
          <section class="panel" aria-labelledby="top-title">
            <p class="kicker" id="top-title">Lo más cubierto</p>
            <ol class="toplist">
              ${mostCovered.map((ev) => `<li><a href="${link(ev, date)}">${esc(ev.title)}</a><small>${esc(CAT_LABEL[ev.category] ?? ev.category)} · ${esc(fmtTime(latestAt(ev)))}</small></li>`).join("")}
            </ol>
          </section>
        </aside>
      </div>
      ${sections.map((s) => `
        <section class="section">
          <div class="section__head"><h2>${esc(s.label)}</h2><a href="#/categoria/${s.id}">Ver todo ${esc(s.label)} →</a></div>
          <div class="grid">${s.events.map((ev) => cardHtml(ev, date)).join("")}</div>
        </section>`).join("")}`;
    const byId = new Map(events.map((e) => [e.id, e]));
    bindSaveButtons(main, (id) => byId.get(id));
  }

  async function viewCategory(category) {
    const date = state.latest?.editionDate;
    const edition = await loadEdition(date);
    renderCats(category, null);
    const label = CAT_LABEL[category] ?? category;
    setTitle(label);
    const events = (edition?.events ?? []).filter((e) => e.category === category);
    gridView({ title: label, events, editionDate: date, count: `${plural(events.length, "acontecimiento", "acontecimientos")} hoy`, emptyText: `Hoy no hay acontecimientos verificados en ${label}.` });
  }

  async function viewDetail(id, editionDate) {
    renderCats(null, null);
    let ev = null;
    let date = editionDate || state.latest?.editionDate;
    try {
      const ed = await loadEdition(date);
      ev = ed?.events.find((e) => e.id === id) ?? null;
    } catch {}
    if (!ev && state.saved[id]) {
      ev = state.saved[id].event;
      date = state.saved[id].editionDate;
    }
    if (!ev) {
      setTitle("No encontrado");
      main.innerHTML = `<p class="empty">No encontramos ese acontecimiento. <a href="#/">Volver a la portada</a></p>`;
      return;
    }
    setTitle(ev.title);
    const srcs = [...ev.sources].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const updated = ev.updatedAt && ev.updatedAt !== ev.firstSeenAt;
    main.innerHTML = `
      <article class="article">
        <a class="back" href="#/">← Portada</a>
        ${kickerHtml(ev, `Edición del ${fmtDay(date)}`)}
        <h1>${esc(ev.title)}</h1>
        <div class="article__bar">
          <span>Última nota ${esc(fmtDateTime(latestAt(ev)))}${updated ? ` · actualizado ${esc(fmtDateTime(ev.updatedAt))}` : ""}</span>
          ${saveBtn(ev, date)}
        </div>
        ${ev.image?.url ? `<figure>${mediaHtml(ev, { credit: true })}<figcaption>Foto: <a href="${esc(ev.image.articleUrl)}" target="_blank" rel="noopener">${esc(ev.image.credit)}</a>. Imagen referencial tomada de la nota original.</figcaption></figure>` : ""}
        <p class="article__lead">${esc(ev.summary)}</p>
        <h2>Puntos clave</h2>
        <ul class="keypoints">${ev.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
        <h2>Fuentes (${srcs.length})</h2>
        <ul class="sources">
          ${srcs.map((s) => `<li><span class="src-name">${esc(s.sourceName)}</span><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><span class="src-time">${esc(fmtDateTime(s.publishedAt))}</span></li>`).join("")}
        </ul>
      </article>`;
    bindSaveButtons(main, () => ev);
  }

  function viewSaved() {
    renderCats(null, "guardadas");
    setTitle("Guardadas");
    const items = Object.values(state.saved).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    main.innerHTML = `
      <div class="page-head"><h1>Guardadas</h1><span class="count">${items.length}</span></div>
      ${items.length ? `<div class="grid">${items.map((it) => cardHtml(it.event, it.editionDate)).join("")}</div>` : `<p class="empty">Todavía no guardaste nada. Tocá «Guardar» en cualquier acontecimiento; queda en este dispositivo.</p>`}`;
    bindSaveButtons(main, (id) => state.saved[id]?.event);
    main.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => setTimeout(viewSaved, 150)));
  }

  async function viewSources() {
    renderCats(null, "medios");
    setTitle("Medios");
    if (!state.sources) {
      try { state.sources = await getJson("data/sources.json"); } catch { state.sources = { sources: [] }; }
    }
    const S = { ok: ["ok", "Conectado"], quiet: ["warn", "Sin notas recientes"], stale: ["warn", "Devuelve notas viejas"], error: ["bad", "Error"], unavailable: ["bad", "Sin feed público"] };
    const rows = (state.sources.sources ?? []).map((s) => {
      const [cls, label] = S[s.status] ?? ["bad", s.status];
      const kind = { rss: "RSS", atom: "Atom", "news-sitemap": "Sitemap de noticias", portada: "Portada del medio", none: "—" }[s.kind] ?? s.kind;
      return `<tr>
        <td data-label="Medio"><b>${esc(s.name)}</b><br><a href="${esc(s.homepage)}" target="_blank" rel="noopener" style="font-size:12px">${esc(s.homepage.replace(/^https?:\/\//, ""))}</a></td>
        <td data-label="Estado"><span class="st"><span class="dot ${cls === "ok" ? "" : cls}"></span>${esc(label)}</span></td>
        <td data-label="Conexión">${esc(kind)}${s.httpStatus ? ` · HTTP ${s.httpStatus}` : ""}</td>
        <td data-label="Notas">${s.items} leídas · ${s.freshItems} del día</td>
        <td data-label="Última nota">${esc(s.newestAt ? fmtDateTime(s.newestAt) : "—")}</td>
        <td class="note-cell">${esc(s.error || s.note || "")}</td>
      </tr>`;
    });
    main.innerHTML = `
      <div class="page-head"><h1>Medios</h1><span class="count">verificado ${esc(fmtDateTime(state.sources.checkedAt))}</span></div>
      <p class="lede">Estado real de cada conexión en la última corrida. Solo se usan notas con fecha verificable dentro de las últimas 24 horas; un feed que devuelve notas antiguas se marca y no se usa.</p>
      <table class="table"><thead><tr><th>Medio</th><th>Estado</th><th>Conexión</th><th>Notas</th><th>Última nota</th><th>Detalle</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="6" class="empty">Sin datos todavía.</td></tr>`}</tbody></table>`;
  }

  async function viewArchive() {
    renderCats(null, "archivo");
    setTitle("Archivo");
    if (!state.index) {
      try { state.index = await getJson("data/editions/index.json"); } catch { state.index = []; }
    }
    main.innerHTML = `
      <div class="page-head"><h1>Archivo de ediciones</h1><span class="count">${plural(state.index.length, "edición", "ediciones")}</span></div>
      ${state.index.length ? `<ul class="editions">${state.index
        .map((e) => `<li><div><div class="ed-date"><a href="#/archivo/${esc(e.date)}">${esc(fmtDay(e.date))}</a></div><div class="ed-head">${esc(e.headline || "")}</div></div><span class="ed-count">${e.events} acont.</span></li>`)
        .join("")}</ul>` : `<p class="empty">Todavía no hay ediciones archivadas.</p>`}`;
  }

  function viewCriteria() {
    renderCats(null, "criterios");
    setTitle("Criterios editoriales");
    const l = state.latest;
    main.innerHTML = `
      <div class="page-head"><h1>Criterios editoriales</h1><span class="count">Libres para informar</span></div>
      <div class="prose">
        <p>El Prócer es un diario digital que informa sobre Paraguay con claridad, contexto y fuentes identificables. No escribe noticias desde cero: lee lo que publican los medios paraguayos, agrupa las notas que cubren un mismo hecho y lo explica en un texto propio, breve y atribuido.</p>
        <h2>Qué es un acontecimiento</h2>
        <p>Un hecho, no una nota. Cuando varios medios cubren lo mismo, acá aparece una sola vez, con un título y un resumen de entre 40 y 70 palabras, los puntos clave y el enlace a cada una de las notas originales, con el nombre del medio y la hora de publicación.</p>
        <h2>De dónde sale la información</h2>
        <ul>
          <li>Solo se usan notas con fecha verificable publicadas en las últimas 24 horas. Un medio que devuelve notas viejas se marca y no se usa.</li>
          <li>El sistema recibe únicamente el título, un extracto y la fecha de cada nota. Tiene prohibido agregar datos que no estén en ese material.</li>
        </ul>
        <h2>Uso de inteligencia artificial</h2>
        <p>Los títulos, resúmenes y puntos clave se redactan con inteligencia artificial${l?.model ? ` (${esc(l.model)})` : ""} a partir de los extractos de las notas. Se declara en esta página y en el pie del sitio. Cuando la IA no interviene, el resumen se arma con extractos del medio y se marca «sin IA». Nunca se presenta un extracto como texto generado ni un texto generado como una cita.</p>
        <p>La redacción automática puede contener errores. Las denuncias y acusaciones se atribuyen; se distingue proyecto de ley de ley, media sanción de sanción, imputación de condena. Ante cualquier duda, la fuente original manda.</p>
        <h2>Fotografías</h2>
        <p>Las imágenes se muestran desde el sitio de cada medio y les pertenecen; en cada acontecimiento figura el crédito y el enlace a la nota de origen. El Prócer no crea ni altera imágenes.</p>
        <h2>Ritmo</h2>
        <p>Dos ediciones por día, a la mañana y a la tarde (hora de Asunción). La edición de la tarde actualiza los acontecimientos de la mañana y agrega novedades sin duplicar. Si en un día hay menos de ${l?.maxEvents ?? 20} acontecimientos verificables, se publican menos y se dice.</p>
        <h2>Independencia</h2>
        <p>El Prócer no representa a ningún organismo del Estado ni a ningún partido. El nombre remite a la idea de independencia; la identidad evita símbolos oficiales y referencias partidarias.</p>
      </div>`;
  }

  async function viewSearch(q, all) {
    renderCats(null, null);
    setTitle(`Buscar: ${q}`);
    const needle = fold(q).trim();
    searchInput.value = q;
    if (!needle) return viewHome();
    const matches = (ev) => [ev.title, ev.summary, ...(ev.keyPoints || []), ...ev.sources.map((s) => `${s.sourceName} ${s.title}`)].some((t) => fold(t).includes(needle));
    const current = state.latest?.editionDate;
    let results = [];
    let scope = "la edición de hoy";
    if (all) {
      if (!state.index) state.index = await getJson("data/editions/index.json").catch(() => []);
      for (const e of state.index) {
        const x = await loadEdition(e.date).catch(() => null);
        for (const ev of x?.events ?? []) if (matches(ev)) results.push({ ev, date: e.date });
      }
      scope = `todas las ediciones (${state.index.length})`;
    } else {
      const ed = await loadEdition(current);
      results = (ed?.events ?? []).filter(matches).map((e) => ({ ev: e, date: current }));
    }
    main.innerHTML = `
      <div class="page-head"><h1>Resultados para «${esc(q)}»</h1><span class="count">${results.length} en ${esc(scope)}</span></div>
      ${!all ? `<p class="lede"><a href="#/buscar?q=${encodeURIComponent(q)}&todo=1"><b>Buscar también en el archivo →</b></a></p>` : ""}
      ${results.length ? `<div class="grid">${results.map((r) => cardHtml(r.ev, r.date)).join("")}</div>` : `<p class="empty">Nada coincide con esa búsqueda.</p>`}`;
    const byId = new Map(results.map((r) => [r.ev.id, r.ev]));
    bindSaveButtons(main, (id) => byId.get(id));
  }

  // ---------- router ----------
  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = hash.split("?");
    const params = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    window.scrollTo({ top: 0 });
    try {
      if (parts.length === 0) return await viewHome();
      if (parts[0] === "categoria") return await viewCategory(parts[1]);
      if (parts[0] === "noticia") return await viewDetail(parts[1], params.get("e"));
      if (parts[0] === "guardadas") return viewSaved();
      if (parts[0] === "medios") return await viewSources();
      if (parts[0] === "criterios") return viewCriteria();
      if (parts[0] === "archivo" && parts[1]) return await viewHome(parts[1]);
      if (parts[0] === "archivo") return await viewArchive();
      if (parts[0] === "buscar") return await viewSearch(params.get("q") || "", params.get("todo") === "1");
      return await viewHome();
    } catch (err) {
      main.innerHTML = `<p class="empty">No se pudo cargar esta sección (${esc(err.message)}).</p>`;
    }
  }

  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    location.hash = q ? `#/buscar?q=${encodeURIComponent(q)}` : "#/";
  });

  async function boot() {
    renderCats("", null);
    try { state.latest = await getJson("data/latest.json"); } catch { state.latest = null; }
    renderStatus();
    window.addEventListener("hashchange", route);
    await route();
  }
  boot();
})();
