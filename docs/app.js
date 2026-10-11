/* Pulso Paraguay — frontend estático. Lee los JSON de data/ generados por el proceso editorial. */
(() => {
  "use strict";

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
  const SAVED_KEY = "pulso.saved.v1";

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

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "{}"); } catch { return {}; }
  }
  function persistSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved)); } catch {}
    const n = Object.keys(state.saved).length;
    const b = $("#saved-count");
    b.textContent = n;
    b.hidden = n === 0;
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

  // ---------- estado de actualización ----------
  function renderStatus() {
    const l = state.latest;
    if (!l) {
      statusEl.innerHTML = `<span class="dot bad"></span> Todavía no hay ninguna edición publicada.`;
      return;
    }
    const mode = l.aiMode === "ia" ? `redacción con IA` : l.aiMode === "mixto" ? `redacción con IA y extractos` : `resúmenes extractivos, sin IA`;
    statusEl.innerHTML = `
      <span class="dot ${l.ok ? "" : "bad"}"></span>
      <span>Actualizado <b>${esc(fmtDateTime(l.generatedAt))}</b> · hora de Asunción · ${esc(relTime(l.generatedAt))}</span>
      <span>·</span><span>${l.eventsCount} de hasta ${l.maxEvents ?? 20} acontecimientos</span>
      <span>·</span><span>${mode}</span>`;
    if (!l.ok) {
      statusEl.insertAdjacentHTML("beforeend", `<div class="alert" style="flex-basis:100%">⚠️ ${esc(l.message || "La última actualización falló.")} Se muestra la última edición válida${l.lastSuccessAt ? `, generada el ${esc(fmtDateTime(l.lastSuccessAt))}` : ""}.</div>`);
    }
    $("#foot-meta").textContent = `${l.editions ?? 1} ${l.editions === 1 ? "edición" : "ediciones"} en el archivo · Zona horaria ${TZ}. Las fotos se muestran desde el sitio de cada medio y les pertenecen.`;
  }

  function renderCats(active) {
    const items = [{ id: "", label: "Portada" }, ...CATS];
    catsEl.innerHTML = items
      .map((c) => `<a href="#/${c.id ? "categoria/" + c.id : ""}" class="${(active ?? "") === c.id ? "is-active" : ""}">${esc(c.label)}</a>`)
      .join("");
  }
  function setActiveNav(name) {
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("is-active", a.dataset.nav === name));
  }

  // ---------- tarjetas ----------
  function mediaHtml(ev, { credit = false } = {}) {
    const initial = (CAT_LABEL[ev.category] ?? "P")[0];
    if (!ev.image?.url) return `<div class="media is-empty" data-initial="${esc(initial)}"></div>`;
    return `<div class="media" data-initial="${esc(initial)}">
      <img src="${esc(ev.image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('is-empty')">
      ${credit ? `<span class="media__credit">Foto: ${esc(ev.image.credit)}</span>` : ""}
    </div>`;
  }

  function cardHtml(ev, editionDate, variant = "") {
    const srcs = distinctSources(ev);
    const saved = Boolean(state.saved[ev.id]);
    const updated = ev.updatedAt && ev.updatedAt !== ev.firstSeenAt;
    return `
      <article class="card ${variant}">
        ${mediaHtml(ev)}
        <div class="card__body">
          <div class="card__meta">
            <span class="cat">${esc(CAT_LABEL[ev.category] ?? ev.category)}</span>
            <span>${esc(fmtTime(latestAt(ev)))}</span>
            ${updated ? `<span class="tag updated">actualizado</span>` : ""}
            ${ev.summaryKind === "extractivo" ? `<span class="tag extractivo" title="Resumen armado con extractos del medio, sin IA">sin IA</span>` : ""}
          </div>
          <h3 class="card__title"><a href="#/noticia/${esc(ev.id)}?e=${esc(editionDate)}">${esc(ev.title)}</a></h3>
          <p class="card__summary">${esc(ev.summary)}</p>
          <div class="card__foot">
            <div class="sources-mini" title="${esc(srcs.join(", "))}">${srcs.slice(0, 3).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}${srcs.length > 3 ? `<span class="chip">+${srcs.length - 3}</span>` : ""}</div>
            <button class="save ${saved ? "is-saved" : ""}" data-save="${esc(ev.id)}" data-edition="${esc(editionDate)}" aria-pressed="${saved}">${saved ? "✓ Guardada" : "☆ Guardar"}</button>
          </div>
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
        btn.textContent = saved ? "✓ Guardada" : "☆ Guardar";
      });
    });
  }

  function gridView({ title, events, editionDate, count, emptyText }) {
    main.innerHTML = `
      <div class="section-title"><h1>${esc(title)}</h1><span class="count">${esc(count ?? "")}</span></div>
      ${events.length ? `<div class="grid">${events.map((ev) => cardHtml(ev, editionDate)).join("")}</div>` : `<p class="empty">${esc(emptyText || "No hay acontecimientos en esta sección.")}</p>`}`;
    const byId = new Map(events.map((e) => [e.id, e]));
    bindSaveButtons(main, (id) => byId.get(id));
  }

  // ---------- vistas ----------
  async function viewHome(archiveDate) {
    const date = archiveDate || state.latest?.editionDate;
    const edition = await loadEdition(date);
    renderCats("");
    setActiveNav(archiveDate ? "archivo" : "");
    if (!edition || !edition.events.length) {
      main.innerHTML = `<p class="empty">Todavía no hay una edición publicada.</p>`;
      return;
    }
    const events = edition.events; // ya vienen ordenados por cobertura y recencia
    const hero = events.slice(0, 3);
    const rest = events.slice(3);
    const sections = CATS.map((c) => ({ ...c, events: rest.filter((e) => e.category === c.id) })).filter((s) => s.events.length);
    main.innerHTML = `
      <div class="section-title"><h1>${archiveDate ? "Edición del " : ""}${esc(fmtDay(date))}</h1><span class="count">${events.length} acontecimientos · ${edition.aiMode === "extractivo" ? "sin IA" : "con IA"}</span></div>
      <div class="hero">
        ${cardHtml(hero[0], date, "card--lead")}
        ${hero.slice(1).map((ev) => cardHtml(ev, date, "card--row")).join("")}
      </div>
      ${sections.map((s) => `
        <section class="section">
          <div class="section-title"><h2>${esc(s.label)}</h2><a class="more" href="#/categoria/${s.id}">Ver todo ${esc(s.label)} →</a></div>
          <div class="grid grid--4">${s.events.map((ev) => cardHtml(ev, date)).join("")}</div>
        </section>`).join("")}`;
    const byId = new Map(events.map((e) => [e.id, e]));
    bindSaveButtons(main, (id) => byId.get(id));
  }

  async function viewCategory(category) {
    const date = state.latest?.editionDate;
    const edition = await loadEdition(date);
    renderCats(category);
    setActiveNav("");
    const events = (edition?.events ?? []).filter((e) => e.category === category);
    gridView({ title: CAT_LABEL[category] ?? category, events, editionDate: date, count: `${events.length} hoy`, emptyText: `Hoy no hay acontecimientos verificados en ${CAT_LABEL[category] ?? category}.` });
  }

  async function viewDetail(id, editionDate) {
    renderCats(null);
    setActiveNav("");
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
      main.innerHTML = `<p class="empty">No encontramos ese acontecimiento. <a href="#/">Volver a la portada</a></p>`;
      return;
    }
    const saved = Boolean(state.saved[ev.id]);
    const srcs = [...ev.sources].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const updated = ev.updatedAt && ev.updatedAt !== ev.firstSeenAt;
    main.innerHTML = `
      <article class="detail">
        <a class="back" href="#/">← Portada</a>
        <div class="card__meta">
          <span class="cat">${esc(CAT_LABEL[ev.category] ?? ev.category)}</span>
          <span>Edición del ${esc(date)}</span>
          ${updated ? `<span class="tag updated">actualizado ${esc(fmtDateTime(ev.updatedAt))}</span>` : ""}
          ${ev.summaryKind === "extractivo" ? `<span class="tag extractivo">resumen sin IA</span>` : `<span class="tag">resumen con IA</span>`}
        </div>
        <h1>${esc(ev.title)}</h1>
        ${ev.image?.url ? `${mediaHtml(ev, { credit: true })}<p class="photo-credit">Foto: <a href="${esc(ev.image.articleUrl)}" target="_blank" rel="noopener">${esc(ev.image.credit)}</a>. Imagen referencial tomada de la nota original.</p>` : ""}
        <p class="lead">${esc(ev.summary)}</p>
        <button class="save ${saved ? "is-saved" : ""}" data-save="${esc(ev.id)}" data-edition="${esc(date)}" aria-pressed="${saved}">${saved ? "✓ Guardada" : "☆ Guardar"}</button>
        <h2>Puntos clave</h2>
        <ul class="keypoints">${ev.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
        <h2>Fuentes (${srcs.length})</h2>
        <ul class="sources">
          ${srcs.map((s) => `<li><span class="src-name">${esc(s.sourceName)}</span><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><span class="src-time">${esc(fmtDateTime(s.publishedAt))}</span></li>`).join("")}
        </ul>
        <p class="note">${ev.summaryKind === "extractivo" ? "Este resumen se armó automáticamente con extractos publicados por el medio, sin inteligencia artificial." : `Título, resumen y puntos clave redactados con IA (${esc(ev.model || "")}) a partir de los extractos de las notas enlazadas. Puede contener errores: verificá siempre en la fuente original.`}</p>
      </article>`;
    bindSaveButtons(main, () => ev);
  }

  function viewSaved() {
    renderCats(null);
    setActiveNav("guardadas");
    const items = Object.values(state.saved).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    main.innerHTML = `
      <div class="section-title"><h1>Noticias guardadas</h1><span class="count">${items.length}</span></div>
      ${items.length ? `<div class="grid">${items.map((it) => cardHtml(it.event, it.editionDate)).join("")}</div>` : `<p class="empty">Todavía no guardaste nada. Tocá “Guardar” en cualquier acontecimiento; queda en este dispositivo.</p>`}`;
    bindSaveButtons(main, (id) => state.saved[id]?.event);
    main.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => setTimeout(viewSaved, 150)));
  }

  async function viewSources() {
    renderCats(null);
    setActiveNav("medios");
    if (!state.sources) {
      try { state.sources = await getJson("data/sources.json"); } catch { state.sources = { sources: [] }; }
    }
    const S = { ok: ["ok", "Conectado"], quiet: ["warn", "Sin notas recientes"], stale: ["warn", "Devuelve notas viejas"], error: ["bad", "Error"], unavailable: ["bad", "Sin feed público"] };
    const rows = (state.sources.sources ?? []).map((s) => {
      const [cls, label] = S[s.status] ?? ["bad", s.status];
      const kind = { rss: "RSS", atom: "Atom", "news-sitemap": "Sitemap de noticias", none: "—" }[s.kind] ?? s.kind;
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
      <div class="section-title"><h1>Medios</h1><span class="count">verificado ${esc(fmtDateTime(state.sources.checkedAt))}</span></div>
      <p style="color:var(--muted);font-size:14px;margin-top:0">Estado real de cada conexión en la última corrida. Solo se usan notas con fecha verificable dentro de las últimas 24 horas; un feed que devuelve notas antiguas se marca y no se usa.</p>
      <table class="table"><thead><tr><th>Medio</th><th>Estado</th><th>Conexión</th><th>Notas</th><th>Última nota</th><th>Detalle</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="6" class="empty">Sin datos todavía.</td></tr>`}</tbody></table>`;
  }

  async function viewArchive() {
    renderCats(null);
    setActiveNav("archivo");
    if (!state.index) {
      try { state.index = await getJson("data/editions/index.json"); } catch { state.index = []; }
    }
    main.innerHTML = `
      <div class="section-title"><h1>Archivo de ediciones</h1><span class="count">${state.index.length}</span></div>
      ${state.index.length ? `<ul class="editions">${state.index
        .map((e) => `<li><div><div class="ed-date"><a href="#/archivo/${esc(e.date)}">${esc(fmtDay(e.date))}</a></div><div class="ed-head">${esc(e.headline || "")}</div></div><span style="color:var(--muted);font-size:13px;white-space:nowrap">${e.events} acont.</span></li>`)
        .join("")}</ul>` : `<p class="empty">Todavía no hay ediciones archivadas.</p>`}`;
  }

  async function viewSearch(q, all) {
    renderCats(null);
    setActiveNav("");
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
      <div class="section-title"><h1>Resultados para “${esc(q)}”</h1><span class="count">${results.length} en ${esc(scope)}</span></div>
      ${!all ? `<p style="font-size:14px;color:var(--muted);margin-top:0"><a href="#/buscar?q=${encodeURIComponent(q)}&todo=1">Buscar también en el archivo</a></p>` : ""}
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
    persistSaved();
    try { state.latest = await getJson("data/latest.json"); } catch { state.latest = null; }
    renderStatus();
    window.addEventListener("hashchange", route);
    await route();
  }
  boot();
})();
