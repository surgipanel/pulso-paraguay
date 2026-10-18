/* El Prócer — frontend estático. Lee los JSON de data/ generados por el proceso editorial. */
(() => {
  "use strict";

  const SITE = "El Prócer";
  const TZ = "America/Asuncion";
  const CATS = [
    { id: "pais", label: "País" },
    { id: "politica", label: "Política" },
    { id: "internacional", label: "Internacional" },
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
  // Sin foto propia del medio (o si no carga): imagen de El Prócer con el nombre de la sección.
  const brandImg = (cat) => `img/seccion-${CAT_LABEL[cat] ? cat : "pais"}.png`;
  function mediaHtml(ev, { credit = false } = {}) {
    const brand = brandImg(ev.category);
    if (!ev.image?.url) return `<div class="media is-brand"><img src="${brand}" alt="" loading="lazy"></div>`;
    return `<div class="media">
      <img src="${esc(ev.image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${brand}';this.parentNode.classList.add('is-brand')">
      ${credit ? `<span class="media__credit">Foto: ${esc(ev.image.credit)}</span>` : ""}
    </div>`;
  }
  const asuDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const isExpired = (ev) => Boolean(ev.expiresAt) && new Date(ev.expiresAt) < new Date();
  // Hora de la última nota; si no es de hoy, con el día ("Ayer · 17:30", "vie 16 oct · 09:00").
  const whenLabel = (ev) => {
    const iso = latestAt(ev);
    if (!iso) return "—";
    const today = asuDate(new Date().toISOString());
    const d = asuDate(iso);
    return d === today ? fmtTime(iso) : `${dayLabel(d)} · ${fmtTime(iso)}`;
  };
  function kickerHtml(ev, extra) {
    const updated = ev.updatedAt && ev.updatedAt !== ev.firstSeenAt;
    return `<p class="kicker">${esc(CAT_LABEL[ev.category] ?? ev.category)}<span class="sep">·</span>${esc(extra ?? whenLabel(ev))}${isExpired(ev) ? ` <span class="tag vencido" title="Aviso de servicio cuya vigencia ya terminó">finalizado</span>` : ""}${updated ? ` <span class="tag updated">actualizado</span>` : ""}${ev.summaryKind === "extractivo" ? ` <span class="tag extractivo" title="Resumen armado con extractos del medio, sin IA">sin IA</span>` : ""}</p>`;
  }
  function saveBtn(ev, editionDate) {
    const saved = Boolean(state.saved[ev.id]);
    return `<button class="save ${saved ? "is-saved" : ""}" data-save="${esc(ev.id)}" data-edition="${esc(editionDate)}" aria-pressed="${saved}">${saved ? "✓ Guardada" : "Guardar"}</button>`;
  }
  const link = (ev, editionDate) => `#/noticia/${esc(ev.id)}?e=${esc(editionDate)}`;

  const dayLabel = (ymd) => {
    const today = state.latest?.editionDate;
    if (today) {
      const [y, m, d] = today.split("-").map(Number);
      const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
      if (ymd === yesterday) return "Ayer";
    }
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, d)));
  };

  function cardHtml(ev, editionDate, variant = "", { dated = false } = {}) {
    return `
      <article class="card ${variant}">
        <a href="${link(ev, editionDate)}" tabindex="-1" aria-hidden="true">${mediaHtml(ev)}</a>
        ${kickerHtml(ev, dated ? `${dayLabel(editionDate)} · ${fmtTime(latestAt(ev))}` : undefined)}
        <h3 class="card__title"><a href="${link(ev, editionDate)}">${esc(ev.title)}</a></h3>
        <p class="card__summary">${esc(ev.summary)}</p>
        <div class="card__foot">
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
    const shown = new Set(events.map((e) => e.id));
    const shownTitles = new Set(events.map((e) => fold(e.title)));
    const older = archiveDate ? [] : await previousEvents(date);
    const sections = CATS.map((c) => {
      const items = rest.filter((e) => e.category === c.id).map((ev) => ({ ev, date, dated: false }));
      for (const o of older) {
        if (items.length >= SECTION_MIN) break;
        if (o.ev.category !== c.id || shown.has(o.ev.id) || shownTitles.has(fold(o.ev.title))) continue;
        items.push({ ...o, dated: true });
        shown.add(o.ev.id);
        shownTitles.add(fold(o.ev.title));
      }
      return { ...c, items };
    }).filter((s) => s.items.length);
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
          ${olderBlock(s.items)}
        </section>`).join("")}`;
    const byId = new Map([...older.map((o) => [o.ev.id, o.ev]), ...events.map((e) => [e.id, e])]);
    bindSaveButtons(main, (id) => byId.get(id));
  }

  async function viewCategory(category) {
    const date = state.latest?.editionDate;
    const edition = await loadEdition(date);
    renderCats(category, null);
    const label = CAT_LABEL[category] ?? category;
    setTitle(label);
    const today = (edition?.events ?? []).filter((e) => e.category === category);
    const items = today.map((ev) => ({ ev, date, dated: false }));
    const seen = new Set(today.map((e) => fold(e.title)));
    for (const o of await previousEvents(date)) {
      if (items.length >= CATEGORY_MIN) break;
      if (o.ev.category !== category || seen.has(fold(o.ev.title))) continue;
      items.push({ ...o, dated: true });
      seen.add(fold(o.ev.title));
    }
    main.innerHTML = `
      <div class="page-head"><h1>${esc(label)}</h1><span class="count">${esc(plural(today.length, "acontecimiento", "acontecimientos"))} hoy</span></div>
      ${items.length ? olderBlock(items) : `<p class="empty">Todavía no hay acontecimientos en ${esc(label)}.</p>`}`;
    const byId = new Map(items.map((it) => [it.ev.id, it.ev]));
    bindSaveButtons(main, (id) => byId.get(id));
  }

  // Tarjetas de hoy y, debajo y rotuladas aparte, las de días anteriores que completan la sección.
  function olderBlock(items) {
    const now = items.filter((it) => !it.dated);
    const old = items.filter((it) => it.dated);
    const grid = (list) => `<div class="grid">${list.map((it) => cardHtml(it.ev, it.date, "", { dated: it.dated })).join("")}</div>`;
    return (now.length ? grid(now) : "") +
      (old.length ? `<p class="older-label">De días anteriores</p>${grid(old)}` : "");
  }

  // Acontecimientos de los días anteriores (hasta tres ediciones), del más reciente al más viejo.
  // Sirven para que una sección no quede vacía cuando hoy todavía no hay novedades de ese tema.
  const SECTION_MIN = 3;
  const CATEGORY_MIN = 6;
  let olderCache = null;
  async function previousEvents(currentDate) {
    if (olderCache?.date === currentDate) return olderCache.list;
    if (!state.index) state.index = await getJson("data/editions/index.json").catch(() => []);
    const dates = state.index.map((e) => e.date).filter((d) => d < currentDate).sort().reverse().slice(0, 3);
    const list = [];
    for (const d of dates) {
      const ed = await loadEdition(d).catch(() => null);
      for (const ev of ed?.events ?? []) list.push({ ev, date: d });
    }
    olderCache = { date: currentDate, list };
    return list;
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
        ${isExpired(ev) ? `<p class="expired-note">Aviso de servicio: su vigencia terminó el ${esc(fmtDateTime(ev.expiresAt))}. Se mantiene como registro.</p>` : ""}
        <div class="article__bar">
          <span>Última nota ${esc(fmtDateTime(latestAt(ev)))}${updated ? ` · actualizado ${esc(fmtDateTime(ev.updatedAt))}` : ""}</span>
          ${saveBtn(ev, date)}
        </div>
        ${ev.image?.url ? `<figure>${mediaHtml(ev, { credit: true })}<figcaption>Foto: <a href="${esc(ev.image.articleUrl)}" target="_blank" rel="noopener">${esc(ev.image.credit)}</a>. Imagen referencial tomada de la nota original.</figcaption></figure>` : ""}
        <p class="article__lead">${esc(ev.summary)}</p>
        <h2>Puntos clave</h2>
        <ul class="keypoints">${ev.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
        <h2 class="sources-head">Fuentes: ${esc(plural(srcs.length, "nota", "notas"))} de ${esc(plural(distinctSources(ev).length, "medio", "medios"))}</h2>
        <ul class="sources">
          ${srcs.map((s) => `<li><span class="src-name">${esc(s.sourceName)}</span><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><span class="src-time">${esc(fmtDateTime(s.publishedAt))}</span></li>`).join("")}
        </ul>
      </article>`;
    bindSaveButtons(main, () => ev);
    showShare(ev);
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
    main.innerHTML = `
      <div class="page-head"><h1>Criterios editoriales</h1><span class="count">Libres para informar</span></div>
      <div class="prose">
        <p>El Prócer es un diario digital que informa sobre Paraguay y el mundo con claridad, contexto y fuentes identificables. No escribe noticias desde cero: lee lo que publican los medios, agrupa las notas que cubren un mismo hecho y lo cuenta con un texto propio, breve y atribuido. Estos son los compromisos que guían cada acontecimiento publicado.</p>

        <h2>Nuestro marco ético</h2>
        <h3>1. Veracidad ante todo</h3>
        <p>Publicamos solo hechos informados por medios identificables, con fecha verificable. No inventamos datos, cifras, nombres ni declaraciones. Si la información disponible es escasa, el texto es más breve, nunca rellenado.</p>
        <h3>2. Independencia</h3>
        <p>El Prócer no responde a ningún gobierno, partido político, empresa ni anunciante. Ninguna noticia se publica, se oculta ni se modifica a cambio de dinero o favores. El nombre remite a la independencia; la identidad evita símbolos oficiales y partidarios.</p>
        <h3>3. Pluralidad</h3>
        <p>Leemos medios con líneas editoriales distintas. Cuando un hecho tiene versiones encontradas, las contamos atribuidas a quien las sostiene, sin tomar partido.</p>
        <h3>4. Presunción de inocencia</h3>
        <p>Un detenido, imputado o acusado no es culpable hasta que lo diga una sentencia firme. Lo nombramos como tal y atribuimos siempre las acusaciones («según la Fiscalía», «denunció…»). Distinguimos con precisión una denuncia de una imputación, una imputación de una condena, un proyecto de una ley y un anuncio de un hecho cumplido.</p>
        <h3>5. Protección de menores y víctimas</h3>
        <p>Nunca publicamos nombres, fotos ni datos que permitan identificar a menores de edad involucrados en delitos o a víctimas de delitos sexuales.</p>
        <h3>6. Dignidad y no discriminación</h3>
        <p>No usamos detalles morbosos de violencia, accidentes o tragedias. No estigmatizamos a nadie por su origen, religión, género, orientación sexual, discapacidad o condición social.</p>
        <h3>7. Salud mental y suicidio</h3>
        <p>Cuando informamos sobre suicidios lo hacemos con cuidado: sin describir métodos ni presentarlo como solución a un problema.</p>
        <h3>8. Títulos con gancho, nunca engañosos</h3>
        <p>Queremos que cada título dé ganas de leer, empezando por el dato más fuerte. Pero el título siempre cuenta lo que dice la nota: sin sensacionalismo, sin exageraciones ni trampas para conseguir clics.</p>
        <h3>9. Información, no opinión</h3>
        <p>Nuestros resúmenes informan; no opinan ni juzgan. Cuando una nota recoge opiniones, las presentamos como tales y con su autor.</p>
        <h3>10. Corrección de errores</h3>
        <p>Si nos equivocamos, corregimos apenas lo detectamos y no ocultamos el error.</p>

        <h2>Cómo trabajamos</h2>
        <ul>
          <li><b>Un hecho, un acontecimiento.</b> Cuando varios medios cubren lo mismo, acá aparece una sola vez, con título, resumen, puntos clave y las notas originales de cada medio.</li>
          <li><b>Solo lo reciente.</b> Cada edición se arma con notas con fecha verificable publicadas en las últimas 24 horas. Un medio que publica notas antiguas no se usa ese día. Cuando una sección no tiene suficientes novedades del día, se completa con las más recientes de los días anteriores, siempre separadas bajo «De días anteriores» y con su fecha.</li>
          <li><b>Fecha y hora visibles.</b> Cada acontecimiento muestra la hora de su nota más reciente y, si no es de hoy, también el día. Los avisos de servicio (cortes de calle, cierres, horarios especiales) indican hasta cuándo valen y, una vez vencidos, se marcan «finalizado».</li>
          <li><b>Secciones.</b> País y Política reúnen solo hechos de Paraguay; Internacional, lo que pasa en el resto del mundo. Economía, Deportes, Cultura y Tecnología combinan noticias nacionales e internacionales.</li>
          <li><b>Ritmo.</b> Una edición completa a la mañana y cuatro actualizaciones durante el día, en hora de Asunción. Cada actualización suma las novedades y actualiza los hechos que cambiaron, sin duplicar.</li>
        </ul>

        <h2>Límites de este método</h2>
        <p>Trabajamos con los títulos y extractos que publican los medios, no con los artículos completos: pueden quedar afuera matices, condiciones, antecedentes o desmentidos posteriores. Por eso cada acontecimiento enlaza a las notas originales. Que varias notas cuenten lo mismo no equivale a que el hecho haya sido confirmado por fuentes independientes: indicamos cuántas notas y cuántos medios lo cubren, y cuando se trata de un reclamo o una acusación, aclaramos de quién es la versión y si la otra parte respondió.</p>

        <h2>Uso de inteligencia artificial</h2>
        <p>Los títulos, resúmenes y puntos clave se redactan con ayuda de inteligencia artificial, a partir únicamente de los títulos y extractos publicados por los medios, y bajo todas las reglas de esta página. Cuando un resumen se arma solo con extractos del medio, sin intervención de la IA, lo marcamos «sin IA». La redacción automática puede contener errores: ante cualquier duda, la nota original manda.</p>

        <h2>Fuentes, derechos y fotografías</h2>
        <p>El contenido original pertenece a cada medio. Usamos solo extractos breves como insumo, citamos siempre al medio y enlazamos a su nota original desde cada acontecimiento. Las fotografías se muestran desde el sitio de cada medio, con su crédito; El Prócer no crea ni altera imágenes.</p>
        <p>Las cotizaciones del día son la referencia publicada por el Banco Central del Paraguay y el clima proviene de Open-Meteo.</p>
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

  // ---------- compartir: botón flotante en cada noticia ----------
  // Se comparte la página propia de la noticia (/n/<id>/), que lleva su foto y resumen en la
  // vista previa de WhatsApp, Facebook y X.
  const SITE_URL = "https://elprocer.com.py";
  const ICON = {
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.8" fill="currentColor"/><circle cx="6" cy="12" r="2.8" fill="currentColor"/><circle cx="18" cy="19" r="2.8" fill="currentColor"/><path d="M8.5 13.4l7 4.2M15.5 6.4l-7 4.2" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.6 22v-8.1h2.7l.4-3.2h-3.1V8.7c0-.9.3-1.5 1.6-1.5h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.4 0-4.1 1.5-4.1 4.2v2.3H7.6v3.2h2.7V22h3.3z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.4L1.8 3h6.4l4.4 5.9L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.5l11.2 14.5z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 19.4l1.1-3.5a8 8 0 1 1 2.8 2.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path fill="currentColor" d="M9.3 8.3c.2-.4.5-.4.8-.4h.5c.2 0 .4.1.5.4l.6 1.4c.1.3 0 .5-.2.7l-.5.5c.6 1.2 1.6 2.2 2.8 2.8l.5-.5c.2-.2.4-.3.7-.2l1.4.6c.3.1.4.3.4.5v.5c0 .3 0 .6-.4.8-.6.4-1.5.6-2.4.3-2.3-.8-4.2-2.7-5-5-.3-.9-.1-1.8.3-2.4z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.8 7.2l8.2 5.9 8.2-5.9" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></g></svg>',
  };
  const shareEl = document.createElement("div");
  shareEl.className = "share";
  shareEl.hidden = true;
  shareEl.innerHTML = `
    <div class="share__list" hidden>
      <a class="share__btn share__btn--facebook" data-net="facebook" target="_blank" rel="noopener" aria-label="Compartir en Facebook">${ICON.facebook}</a>
      <a class="share__btn share__btn--x" data-net="x" target="_blank" rel="noopener" aria-label="Compartir en X">${ICON.x}</a>
      <a class="share__btn share__btn--whatsapp" data-net="whatsapp" target="_blank" rel="noopener" aria-label="Compartir por WhatsApp">${ICON.whatsapp}</a>
      <a class="share__btn share__btn--mail" data-net="mail" aria-label="Compartir por correo">${ICON.mail}</a>
      <button class="share__btn share__btn--link" type="button" data-net="link" aria-label="Copiar enlace">${ICON.link}</button>
    </div>
    <button class="share__toggle" type="button" aria-expanded="false" aria-label="Compartir">${ICON.share}</button>
    <span class="share__toast" role="status" hidden>Enlace copiado</span>`;
  document.body.append(shareEl);
  const shareList = shareEl.querySelector(".share__list");
  const shareToggle = shareEl.querySelector(".share__toggle");
  const shareToast = shareEl.querySelector(".share__toast");
  const setShareOpen = (open) => {
    shareList.hidden = !open;
    shareToggle.setAttribute("aria-expanded", String(open));
    shareToggle.setAttribute("aria-label", open ? "Cerrar" : "Compartir");
    shareToggle.innerHTML = open ? ICON.close : ICON.share;
    shareToggle.classList.toggle("is-open", open);
  };
  shareToggle.addEventListener("click", () => setShareOpen(shareList.hidden));
  shareEl.querySelector('[data-net="link"]').addEventListener("click", async () => {
    const url = shareEl.dataset.url;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copiá el enlace:", url); return; }
    shareToast.hidden = false;
    setTimeout(() => { shareToast.hidden = true; }, 1800);
  });
  function showShare(ev) {
    const url = `${SITE_URL}/n/${encodeURIComponent(ev.id)}/`;
    const t = ev.title;
    const enc = encodeURIComponent;
    shareEl.dataset.url = url;
    shareEl.querySelector('[data-net="facebook"]').href = `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`;
    shareEl.querySelector('[data-net="x"]').href = `https://twitter.com/intent/tweet?text=${enc(t)}&url=${enc(url)}`;
    shareEl.querySelector('[data-net="whatsapp"]').href = `https://wa.me/?text=${enc(t + " " + url)}`;
    shareEl.querySelector('[data-net="mail"]').href = `mailto:?subject=${enc(t)}&body=${enc((ev.summary || "") + "\n\n" + url)}`;
    setShareOpen(false);
    shareEl.hidden = false;
  }
  function hideShare() {
    setShareOpen(false);
    shareEl.hidden = true;
  }

  // ---------- router ----------
  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = hash.split("?");
    const params = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    window.scrollTo({ top: 0 });
    hideShare();
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

  // ---------- datos del día: cotizaciones (BCP, vía data/mercado.json) y clima (Open-Meteo, en vivo) ----------
  const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=-25.2637&longitude=-57.5759&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=America%2FAsuncion&forecast_days=4";
  const WEATHER_KEY = "procer.clima.v1";
  const WEATHER_TTL = 15 * 60 * 1000;
  const wmo = (code, day = 1) => {
    if (code === 0) return [day ? "☀️" : "🌙", "Despejado"];
    if (code <= 2) return [day ? "🌤️" : "☁️", "Parcialmente nublado"];
    if (code === 3) return ["☁️", "Nublado"];
    if (code <= 48) return ["🌫️", "Niebla"];
    if (code <= 57) return ["🌦️", "Llovizna"];
    if (code <= 67) return ["🌧️", "Lluvia"];
    if (code <= 77) return ["🌨️", "Nieve"];
    if (code <= 82) return ["🌦️", "Chaparrones"];
    return ["⛈️", "Tormenta"];
  };
  const gs = (n, code) => new Intl.NumberFormat("es-PY", { maximumFractionDigits: code === "ARS" ? 2 : 0 }).format(n);
  const gs2 = (n) => new Intl.NumberFormat("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const dayShort = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d))); };

  async function loadWeather() {
    try {
      const c = JSON.parse(localStorage.getItem(WEATHER_KEY) || "null");
      if (c && Date.now() - c.at < WEATHER_TTL) return c.data;
    } catch {}
    const res = await fetch(WEATHER_URL);
    if (!res.ok) throw new Error("clima");
    const data = await res.json();
    try { localStorage.setItem(WEATHER_KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
    return data;
  }

  async function renderTicker() {
    const [mercado, clima] = await Promise.all([
      getJson("data/mercado.json").catch(() => null),
      loadWeather().catch(() => null),
    ]);
    const btn = $("#ticker");
    if (!mercado && !clima) { btn.hidden = true; return; }
    const parts = [];
    if (mercado) {
      parts.push(`<span class="tk tk--label">Cotización BCP</span>`);
      mercado.rates.forEach((r, i) => parts.push(`<span class="tk ${i >= 2 ? "tk--sec" : ""}">${esc(r.code)} <b>${esc(gs(r.gs, r.code))}</b></span>`));
    }
    if (clima) {
      const [ico, desc] = wmo(clima.current.weather_code, clima.current.is_day);
      parts.push(`<span class="tk" title="${esc(desc)}">${ico} <b>${Math.round(clima.current.temperature_2m)}°</b> Asunción</span>`);
    }
    btn.innerHTML = parts.join("");
    btn.hidden = false;

    const body = $("#datos-body");
    body.innerHTML = `
      ${clima ? `
        <h3>Clima en Asunción</h3>
        <div class="clima">
          <span class="clima__now">${Math.round(clima.current.temperature_2m)}°</span>
          <span class="clima__desc">${esc(wmo(clima.current.weather_code, clima.current.is_day)[1])} ahora<br>Mín. ${Math.round(clima.daily.temperature_2m_min[0])}° · Máx. ${Math.round(clima.daily.temperature_2m_max[0])}°</span>
        </div>
        <div class="clima__days">
          ${clima.daily.time.map((d, i) => `<div>${i === 0 ? "Hoy" : esc(dayShort(d))}<span class="ico">${wmo(clima.daily.weather_code[i])[0]}</span><b>${Math.round(clima.daily.temperature_2m_min[i])}° / ${Math.round(clima.daily.temperature_2m_max[i])}°</b></div>`).join("")}
        </div>
        <p class="fine">Datos de Open-Meteo; se actualizan cada 15 minutos.</p>` : ""}
      ${mercado ? `
        <h3>Cotizaciones de referencia</h3>
        <table>
          <thead><tr><th>Moneda</th><th class="num">Guaraníes por unidad</th></tr></thead>
          <tbody>${mercado.rates.map((r) => `<tr><td>${esc(r.name)} (${esc(r.code)})</td><td class="num"><b>${esc(gs(r.gs, r.code))}</b></td></tr>`).join("")}</tbody>
        </table>
        ${mercado.usdInterbank ? `<p class="fine">Dólar interbancario (${esc(mercado.usdInterbank.label)}): compra <b>${esc(gs2(mercado.usdInterbank.compra))}</b> · venta <b>${esc(gs2(mercado.usdInterbank.venta))}</b>.</p>` : ""}
        <p class="fine">Cotización de referencia del <a href="${esc(mercado.source.url)}" target="_blank" rel="noopener">Banco Central del Paraguay</a> del ${esc(fmtDay(mercado.date))}. Las cotizaciones de ventanilla de bancos y casas de cambio difieren.</p>` : ""}`;
  }

  (() => {
    const dlg = $("#datos");
    $("#ticker").addEventListener("click", () => { if (!dlg.open) dlg.showModal(); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
  })();

  async function boot() {
    renderCats("", null);
    renderTicker();
    try { state.latest = await getJson("data/latest.json"); } catch { state.latest = null; }
    renderStatus();
    window.addEventListener("hashchange", route);
    await route();
  }
  boot();
})();
