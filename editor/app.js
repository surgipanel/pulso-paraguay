/* Panel de editor de El Prócer: buscar, elegir, revisar y publicar. Nada de lo que viene de internet
   se inserta como HTML: todo pasa por textContent. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const CATEGORIES = [
    ["pais", "País"], ["politica", "Política"], ["internacional", "Internacional"], ["economia", "Economía"],
    ["deportes", "Deportes"], ["cultura", "Cultura"], ["tecnologia", "Tecnología"],
  ];
  const PUBLISH_WAIT_MS = 5 * 60 * 1000;
  const state = { user: null, results: new Map(), selected: new Set(), draft: null };

  async function api(path, body) {
    const res = await fetch(`api/${path}`, body === undefined ? {} : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.user) location.reload();
      throw new Error(data.error || `Error ${res.status}`);
    }
    return data;
  }
  const show = (el, on = true) => { el.hidden = !on; };
  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };
  const fmt = (iso) => new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const status = (text) => { $("search-status").textContent = text || ""; show($("search-status"), Boolean(text)); };

  // ---------- acceso ----------
  function startGoogle(clientId) {
    if (!clientId) {
      $("login-error").textContent = "El acceso con Google todavía no está configurado.";
      show($("login-error"));
      return;
    }
    const ready = () => {
      google.accounts.id.initialize({ client_id: clientId, callback: onCredential });
      google.accounts.id.renderButton($("google-button"), { theme: "filled_blue", size: "large", text: "signin_with", locale: "es" });
    };
    if (window.google?.accounts?.id) ready();
    else {
      const timer = setInterval(() => {
        if (window.google?.accounts?.id) { clearInterval(timer); ready(); }
      }, 200);
    }
  }
  async function onCredential(response) {
    show($("login-error"), false);
    try {
      const { user } = await api("login", { credential: response.credential });
      enter(user);
    } catch (err) {
      $("login-error").textContent = err.message;
      show($("login-error"));
    }
  }
  function enter(user) {
    state.user = user;
    $("who-name").textContent = user.name;
    show($("who"));
    show($("login"), false);
    show($("app"));
    loadRecent();
  }
  $("logout").addEventListener("click", async () => {
    await api("logout", {}).catch(() => {});
    location.reload();
  });

  // ---------- búsqueda y selección ----------
  function addResult(r, { select = false } = {}) {
    if (state.results.has(r.url)) {
      if (select) state.selected.add(r.url);
      return;
    }
    state.results.set(r.url, r);
    if (select) state.selected.add(r.url);
  }
  function renderResults() {
    const list = $("results");
    list.replaceChildren();
    for (const r of state.results.values()) {
      const box = el("input", { type: "checkbox", checked: state.selected.has(r.url) });
      box.addEventListener("change", () => {
        if (box.checked) state.selected.add(r.url);
        else state.selected.delete(r.url);
        renderBar();
      });
      const detail = [r.host, r.age].filter(Boolean).join(" · ");
      list.append(el("li", {}, el("label", {}, box, el("span", {}, el("b", { textContent: r.title }), el("small", { textContent: detail })))));
    }
    renderBar();
  }
  function renderBar() {
    const n = state.selected.size;
    show($("draft-bar"), n > 0);
    $("selected-count").textContent = n === 1 ? "1 nota elegida" : `${n} notas elegidas`;
  }
  $("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("q").value.trim();
    if (q.length < 3) return;
    $("search-btn").disabled = true;
    status("Buscando en internet…");
    try {
      const { results } = await api("search", { q });
      // Las notas ya elegidas se conservan; el resto se reemplaza con la búsqueda nueva.
      const kept = [...state.selected].map((u) => state.results.get(u)).filter(Boolean);
      state.results = new Map();
      kept.forEach((r) => addResult(r));
      results.forEach((r) => addResult(r));
      renderResults();
      status(results.length ? `${results.length} resultados. Marcá las notas que cuentan el mismo hecho.` : "No se encontraron notas. Probá con otras palabras.");
    } catch (err) {
      status(err.message);
    } finally {
      $("search-btn").disabled = false;
    }
  });
  $("url-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("url").value.trim();
    let host;
    try { host = new URL(raw).hostname.replace(/^www\./, ""); } catch { status("Ese enlace no es válido."); return; }
    addResult({ url: raw, title: raw, host, age: "enlace pegado" }, { select: true });
    $("url").value = "";
    status("");
    renderResults();
  });

  // ---------- borrador ----------
  $("draft-btn").addEventListener("click", async () => {
    $("draft-btn").disabled = true;
    status("Leyendo las notas y redactando el borrador. Puede tardar hasta un minuto…");
    try {
      const data = await api("draft", { urls: [...state.selected] });
      state.draft = data.event;
      fillDraft(data);
      status("");
      show($("draft"));
      show($("progress"), false);
      $("draft").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      status(err.message);
    } finally {
      $("draft-btn").disabled = false;
    }
  });
  const countWords = () => {
    const n = $("d-summary").value.trim().split(/\s+/).filter(Boolean).length;
    $("d-words").textContent = `(${n} palabras)`;
  };
  $("d-summary").addEventListener("input", countWords);

  function fillDraft({ event, warnings }) {
    $("warnings").replaceChildren(...(warnings ?? []).map((w) => el("li", { textContent: w })));
    $("d-title").value = event.title;
    $("d-summary").value = event.summary;
    $("d-points").value = (event.keyPoints ?? []).join("\n");
    $("d-category").replaceChildren(...CATEGORIES.map(([v, label]) => el("option", { value: v, textContent: label, selected: v === event.category })));
    countWords();
    show($("d-image-box"), Boolean(event.image));
    if (event.image) {
      $("d-image").src = event.image.url;
      $("d-use-image").checked = true;
      $("d-image-credit").textContent = `Foto: ${event.image.credit}`;
    }
    $("d-sources").replaceChildren(...event.sources.map((s) => {
      const ageH = (Date.now() - new Date(s.publishedAt).getTime()) / 36e5;
      const when = s.dateUnknown ? el("span", { className: "old", textContent: "Sin fecha verificable" })
        : ageH > 48 ? el("span", { className: "old", textContent: `Nota de hace ${Math.round(ageH / 24)} días` })
        : el("span", { textContent: fmt(s.publishedAt) });
      return el("li", {}, el("b", { textContent: s.sourceName }), el("a", { href: s.url, target: "_blank", rel: "noopener", textContent: s.title }), el("br"), when);
    }));
  }
  function readDraft() {
    const useImage = $("d-use-image").checked && state.draft.image;
    return {
      ...state.draft,
      title: $("d-title").value.trim(),
      summary: $("d-summary").value.trim().replace(/\r\n/g, "\n"),
      keyPoints: $("d-points").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6),
      category: $("d-category").value,
      scope: $("d-category").value === "internacional" ? "internacional" : state.draft.scope,
      image: useImage ? state.draft.image : null,
      sources: state.draft.sources.map(({ dateUnknown, ...s }) => s),
    };
  }
  $("discard-btn").addEventListener("click", () => {
    if (!confirm("¿Descartar este borrador?")) return;
    state.draft = null;
    show($("draft"), false);
  });

  // ---------- publicar y retirar ----------
  async function waitFor(check) {
    const start = Date.now();
    while (Date.now() - start < PUBLISH_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 10_000));
      const { items } = await api("recent").catch(() => ({ items: null }));
      if (items && check(items)) return items;
    }
    return null;
  }
  function progress(title, text, url) {
    $("progress-title").textContent = title;
    $("progress-text").textContent = text;
    show($("progress-link"), Boolean(url));
    if (url) $("progress-a").href = url;
    show($("progress"));
    $("progress").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  $("publish-btn").addEventListener("click", async () => {
    const event = readDraft();
    if (!confirm(`¿Publicar ahora en elprocer.com.py?\n\n${event.title}`)) return;
    $("publish-btn").disabled = true;
    try {
      const { id, url } = await api("publish", { event });
      show($("draft"), false);
      progress("Publicando…", "Suele tardar unos dos minutos en aparecer en la web. Podés dejar esta pantalla abierta.");
      const items = await waitFor((list) => list.some((i) => i.id === id));
      if (items) {
        renderRecent(items);
        progress("Publicada", "La noticia ya está en la web y encabeza la portada durante las próximas 6 horas.", url);
        state.selected.clear();
        state.results.clear();
        renderResults();
        $("q").value = "";
      } else {
        progress("Todavía no aparece", "GitHub está demorando más de lo habitual. Si en unos minutos no está en la lista de abajo, volvé a intentarlo.", url);
      }
      state.draft = null;
    } catch (err) {
      progress("No se pudo publicar", err.message);
    } finally {
      $("publish-btn").disabled = false;
    }
  });
  function renderRecent(items) {
    $("recent").replaceChildren(...items.map((item) => {
      const off = el("button", { className: "btn btn--ghost", type: "button", textContent: "Retirar" });
      off.addEventListener("click", async () => {
        if (!confirm(`¿Retirar de la web esta noticia?\n\n${item.title}`)) return;
        off.disabled = true;
        try {
          await api("unpublish", { id: item.id, date: item.date });
          off.textContent = "Retirando…";
          const list = await waitFor((l) => !l.some((i) => i.id === item.id));
          if (list) renderRecent(list);
          else progress("Todavía no se retiró", "GitHub está demorando más de lo habitual. Revisá en unos minutos.");
        } catch (err) {
          progress("No se pudo retirar", err.message);
          off.disabled = false;
        }
      });
      return el("li", {}, el("div", {}, el("a", { href: item.url, target: "_blank", rel: "noopener", textContent: item.title }), el("small", { textContent: fmt(item.at) })), off);
    }));
    show($("recent-empty"), items.length === 0);
  }
  async function loadRecent() {
    try {
      renderRecent((await api("recent")).items);
    } catch {
      show($("recent-empty"));
    }
  }

  // ---------- arranque ----------
  (async () => {
    try {
      const cfg = await api("config");
      if (cfg.user) enter(cfg.user);
      else {
        show($("login"));
        startGoogle(cfg.clientId);
      }
    } catch (err) {
      $("fatal").textContent = `No se pudo cargar el panel: ${err.message}`;
      show($("fatal"));
    }
  })();
})();
