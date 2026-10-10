/* Conforme : logique de l'interface (lecture du flux d'audit, rendu du rapport, export Excel). */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  let RESULTS = null;
  let MODE_AUDIT = "navigateur"; // ou "serveur", décidé au chargement
  let MODE_AUDIT_TXT = "navigateur";

  const VIEWS = { home: $("#view-home"), run: $("#view-run"), report: $("#view-report") };

  function show(name) {
    for (const k of Object.keys(VIEWS)) VIEWS[k].hidden = k !== name;
    if (name === "run") { VIEWS.run.scrollIntoView(); }
    if (name === "report") { window.scrollTo(0, 0); }
    if (name === "home") { $("#url").focus(); }
  }

  /* ---------------- vue : audit en cours ---------------- */

  const stageEls = {};
  for (const li of document.querySelectorAll("#stages li")) stageEls[li.dataset.key] = li;

  function setStage(key, status) {
    const li = stageEls[key];
    if (!li) return;
    li.className = status;
    li.querySelector(".st-status").textContent = status === "fait" ? "fait" : (status === "erreur" ? "bloqué" : "en cours");
  }

  let logCount = 0;
  function logLine(text, isErr) {
    const box = $("#console-lines");
    const caret = box.querySelector(".cl.caret");
    if (caret) caret.remove();
    const div = document.createElement("div");
    div.className = "cl" + (isErr ? " err" : "");
    div.textContent = text;
    box.appendChild(div);
    const caret2 = document.createElement("div");
    caret2.className = "cl caret";
    box.appendChild(caret2);
    logCount++;
    if (logCount > 60) { const first = box.querySelector(".cl:not(.caret)"); if (first) first.remove(); }
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- mode : serveur local ou navigateur ---------------- */

  async function detecterMode() {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1200);
      const r = await fetch("/api/health", { signal: c.signal });
      clearTimeout(t);
      if (r.ok) {
        MODE_AUDIT = "serveur";
        MODE_AUDIT_TXT = "serveur local (analyse approfondie)";
      }
    } catch (e) { MODE_AUDIT = "navigateur"; }
    const b = document.querySelector("#mode-badge");
    if (b) {
      b.textContent = MODE_AUDIT === "serveur"
        ? "Mode serveur local : contrastes mesurés dans Chromium"
        : "Mode navigateur : analyse dans votre navigateur, via un relais public";
    }
  }

  /* ---------------- lancement ---------------- */

  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("#url").value.trim();
    const errBox = $("#form-err");
    errBox.hidden = true;
    if (!url) {
      errBox.textContent = "Donnez d'abord l'adresse du site à auditer.";
      errBox.hidden = false;
      $("#url").focus();
      return;
    }
    const btn = $("#submit");
    btn.disabled = true;
    btn.textContent = "Audit en cours";
    show("run");
    setStage("fetch", "en cours");
    setStage("pages", "à venir");
    setStage("verdict", "à venir");
    setStage("report", "à venir");
    $("#console-lines").innerHTML = "";
    $("#run-site").textContent = url.replace(/^https?:\/\//, "");
    logCount = 0;
    logLine(MODE_AUDIT === "serveur" ? "moteur serveur (Chromium + Playwright) réveillé" : "moteur navigateur réveillé");

    try {
      if (MODE_AUDIT !== "serveur") {
        // audit entièrement dans le navigateur
        const emit = (evt) => {
          if (evt.type === "log") logLine(evt.text);
          else if (evt.type === "stage") {
            if (stageEls[evt.key] && evt.status) setStage(evt.key, evt.status);
            if (evt.key === "pages" && evt.text && evt.text !== "Analyse des pages") {
              const t = stageEls.pages.querySelector(".st-txt");
              if (t) t.textContent = evt.text;
            }
          }
        };
        RESULTS = await window.Conforme.auditer(url, emit);
      } else {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
      if (!res.ok || !res.body) {
        let msg = "Le serveur d'audit n'a pas répondu (code " + res.status + ").";
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let evt;
          try { evt = JSON.parse(line); } catch (_) { continue; }
          if (evt.type === "log") { logLine(evt.text); }
          else if (evt.type === "stage") {
            if (stageEls[evt.key] && evt.status) setStage(evt.key, evt.status);
            if (evt.key === "pages" && evt.text && evt.text !== "Analyse des pages") {
              const t = stageEls.pages.querySelector(".st-txt");
              if (t) t.textContent = evt.text;
            }
          }
          else if (evt.type === "error") { throw new Error(evt.message); }
          else if (evt.type === "done") { RESULTS = evt.results; done = true; break; }
        }
      }
      }
      if (!RESULTS) throw new Error("L'audit n'a pas pu être mené à terme.");
      logLine("audit terminé");
      setStage("report", "en cours");
      render(RESULTS);
      setStage("report", "fait");
      show("report");
    } catch (err) {
      setStage("fetch", "erreur");
      logLine(err.message || "erreur inconnue", true);
      show("home");
      errBox.textContent = err.message || "Une erreur est survenue pendant l'audit.";
      errBox.hidden = false;
      $("#url").focus();
    } finally {
      btn.disabled = false;
      btn.textContent = "Lancer l'audit";
    }
  });

  /* ---------------- rendu du rapport ---------------- */

  const CHIP = { "Conforme": ["v-c", "cc-c"], "Non conforme": ["v-nc", "cc-nc"], "Non testé": ["v-nt", "cc-nt"], "Non applicable": ["v-na", "cc-na"] };

  function chip(verdict) {
    const cls = (CHIP[verdict] || CHIP["Non testé"])[0];
    return '<span class="verdict-chip ' + cls + '">' + esc(verdict) + "</span>";
  }

  function pctTxt(x) {
    if (x === null || x === undefined) return "à finir";
    return String(Math.round(x * 1000) / 10).replace(".", ",") + " %";
  }

  function shortPage(u) { return String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\?.*$/, ""); }

  function render(res) {
    const meta = res.meta || {};
    const scores = res.scores || { per_criterion: {}, totals: {} };
    const totals = scores.totals || {};
    const verdict = res.verdict_label || "CONFORMITÉ PARTIELLE";

    // en-tête
    $("#report-site").textContent = shortPage(meta.url || "") + " · audit du " + (meta.date || "") + " · " + (meta.mode || "") + " · " + (meta.duration || 0) + " s";

    const stamp = $("#stamp");
    stamp.className = "stamp" + (verdict === "CONFORMITÉ TOTALE" ? " ok" : (verdict === "NON CONFORME" ? " ko" : ""));
    $("#stamp-label").textContent = verdict;
    $("#stamp-sub").textContent = shortPage(meta.site || "");

    // scores
    const gPct = Math.round((scores.global || 0) * 100);
    const mPct = Math.round((scores.mean || 0) * 100);
    compterJusque($("#score-global"), gPct, 700);
    compterJusque($("#score-mean"), mPct, 700);
    compterJusque($("#score-pages"), (res.pages || []).length, 450);
    const st = meta.stats || {};
    $("#score-elements").textContent = (st.imgs || 0) + " images · " + (st.links || 0) + " liens · " + (st.texts || 0) + " textes mesurés";

    // répartition
    const cs = $("#countstrip");
    cs.innerHTML = "";
    const cells = [
      ["Conforme", totals.c || 0, "cc-c"],
      ["Non conforme", totals.nc || 0, "cc-nc"],
      ["Non testé", totals.nt || 0, "cc-nt"],
      ["Non applicable", totals.na || 0, "cc-na"],
    ];
    for (const [lab, val, cls] of cells) {
      const d = document.createElement("div");
      d.className = "countcell " + cls;
      d.setAttribute("role", "listitem");
      d.innerHTML = "<b>" + esc(val) + "</b> " + esc(lab) + (val === 1 ? "" : "s");
      cs.appendChild(d);
    }

    // cadre
    const cadre = $("#cadre");
    cadre.innerHTML = "";
    const cd = [
      ["Site audité", meta.url || "", "mono"],
      ["Date de l'audit", meta.date || "", ""],
      ["Méthode", "Moteur automatique : navigateur Chromium sans interface, styles calculés, contrastes mesurés sur " + (st.texts || 0) + " textes.", ""],
      ["Éléments examinés", (st.imgs || 0) + " images, " + (st.links || 0) + " liens, " + (st.svgs || 0) + " svg.", ""],
    ];
    for (const [k, v, extra] of cd) {
      const d = document.createElement("div");
      d.className = "cadre-cell";
      d.innerHTML = '<span class="cadre-k">' + esc(k) + '</span><span class="cadre-v ' + extra + '">' + esc(v) + "</span>";
      cadre.appendChild(d);
    }
    const dPages = document.createElement("div");
    dPages.className = "cadre-cell";
    dPages.style.gridColumn = "1 / -1";
    dPages.innerHTML = '<span class="cadre-k">Pages auditées</span><span class="cadre-v mono">' + (res.pages || []).map(esc).join("<br>") + "</span>";
    cadre.appendChild(dPages);

    // tests par critère
    const critBox = $("#criteria");
    critBox.innerHTML = "";
    const groups = [["1.1", "1.1 Images", "Chaque image porteuse d'information a-t-elle une alternative textuelle ?"],
                    ["3.2", "3.2 Contrastes", "Le contraste entre la couleur du texte et celle de son fond est-il suffisant ?"],
                    ["6.1", "6.1 Liens", "Chaque lien est-il explicite ?"]];
    for (const [key, name, titre] of groups) {
      const tt = (res.tests || []).filter((t) => t.criterion === key);
      const pc = (scores.per_criterion || {})[key] || {};
      const block = document.createElement("div");
      block.className = "crit";
      const rateTxt = pc.taux === null || pc.taux === undefined ? "à finir" : pctTxt(pc.taux) + " de conformité";
      let head = '<div class="crit-head"><span class="crit-name">' + esc(name) + "</span>";
      head += '<span class="crit-bar" aria-hidden="true"><span style="width:' + Math.round((pc.taux || 0) * 100) + '%"></span></span>';
      head += '<span class="crit-rate">' + esc(rateTxt) + "</span></div>";
      head += '<p class="crit-title">' + esc(titre) + "</p>";
      block.innerHTML = head;
      for (const t of tt) {
        const det = document.createElement("details");
        det.className = "test";
        let sum = '<summary class="test-sum"><span class="test-id">' + esc(t.id) + '</span><span class="test-t">' + esc(t.title) + "</span>" + chip(t.verdict);
        const badge = (t.counts.ko ? " · " + t.counts.ko + " problème" + (t.counts.ko > 1 ? "s" : "") : "") + (t.counts.unsure ? " · " + t.counts.unsure + " à vérifier" : "");
        sum += '<span class="test-caret" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 10 10" focusable="false"><path d="M1 3l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg></span></summary>';
        let body = '<div class="test-body"><div class="test-cols">';
        body += '<div><span class="tb-k">Que faut-il vérifier ?</span><p class="tb-v">' + esc(t.verify) + "</p>";
        body += '<span class="tb-k">Préconisation</span><p class="tb-v"><strong>' + esc(t.reco) + "</strong></p>";
        body += '<span class="tb-k">Commentaire du moteur</span><p class="tb-v">' + esc(t.comment || "") + "</p></div>";
        body += '<div><span class="tb-k">Exemples relevés' + esc(badge) + "</span>";
        if (t.examples && t.examples.length) {
          body += '<ul class="ex-list">' + t.examples.map((x) => '<li><span class="ex-page">' + esc(shortPage(x.page)) + "</span><span>" + esc(x.detail) + "</span></li>").join("") + "</ul>";
        } else {
          body += '<p class="ex-none">Aucun problème relevé sur les pages auditées.</p>';
        }
        if (t.unsure && t.unsure.length) {
          body += '<span class="tb-k">À contrôler à la main</span><ul class="ex-list">' + t.unsure.map((x) => '<li><span class="ex-page">' + esc(shortPage(x.page)) + "</span><span>" + esc(x.detail) + "</span></li>").join("") + "</ul>";
        }
        body += "</div></div></div>";
        det.innerHTML = sum + body;
        block.appendChild(det);
      }
      const critTitle = block.querySelector(".crit-title");
      critBox.appendChild(block);
    }

    // points manuels
    const man = res.manual || [];
    const manBox = $("#manual");
    if (!man.length) {
      manBox.innerHTML = '<p class="manual-none">Rien à compléter : tous les tests applicables ont été tranchés automatiquement sur les pages auditées.</p>';
    } else {
      manBox.innerHTML = '<p class="rnote" style="margin:-8px 0 14px">Ces points dépendent d\'un jugement humain (le sens des images, le contexte des liens). Le moteur les signale au lieu de trancher à l\'aveugle.</p><ul class="manual-list">' + man.map((m) => '<li><span class="manual-test">' + esc(m.test) + "</span><span><span class=\"manual-detail\">" + esc(m.detail) + '</span><br><span class="ex-page">' + esc(shortPage(m.page)) + "</span></span></li>").join("") + "</ul>";
    }

    // préconisations
    const precos = res.precos || [];
    const PRIO_CLS = { "Haute": "v-nc", "Moyenne": "v-nt", "Basse": "v-na" };
    const pbox = $("#precos");
    pbox.innerHTML = '<div class="precos-list">' + precos.map((p) =>
      '<div class="prow"><span class="p-n">' + esc(p.n) + '</span><span class="p-test">' + esc(p.test) + '</span><span class="p-main"><span class="p-action">' + esc(p.action) + '</span><span class="p-who">Pour : ' + esc(p.qui) + " · Charge : " + esc(p.charge) + "</span></span>" + '<span class="p-prio"><span class="verdict-chip ' + (PRIO_CLS[p.priorite] || "v-nt") + '">' + esc(p.priorite) + '</span></span><span class="p-ech"><span class="verdict-chip v-na">' + esc(p.echeance) + "</span></span></div>"
    ).join("") + "</div>";

    // plan
    const tbody = $("#plan-body");
    tbody.innerHTML = "";
    const QN = ["2026 T1", "2026 T2", "2026 T3", "2026 T4", "2027 T1", "2027 T2", "2027 T3", "2027 T4", "2028 T1", "2028 T2", "2028 T3", "2028 T4"];
    for (const p of res.plan || []) {
      const tr = document.createElement("tr");
      let cells = '<th scope="row" class="plan-act">' + esc(p.action) + "</th>";
      cells += '<td class="plan-base">' + esc(p.base) + "</td>";
      cells += '<td class="plan-who">' + esc(p.qui) + "</td>";
      for (let qi = 0; qi < 12; qi++) {
        const v = p.plan && p.plan[qi];
        const cls = v === "Fait" ? "q q-c" : v === "Planifié" ? "q q-p" : v === "En cours" ? "q q-r" : "q";
        cells += '<td class="' + cls + '">' + (v ? esc(v) : "") + "</td>";
      }
      cells += '<td class="plan-liv">' + esc(p.livrable) + "</td>";
      tr.innerHTML = cells;
      tbody.appendChild(tr);
    }
    // entête trimestres
    const thead = $("#plan-table thead tr");
    while (thead.children.length > 4) thead.removeChild(thead.lastChild);
    for (const q of QN) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = q;
      thead.appendChild(th);
    }
    const thLiv = document.createElement("th");
    thLiv.scope = "col";
    thLiv.textContent = "Livrable";
    thead.appendChild(thLiv);
  }

  /* ---------------- export et redémarrage ---------------- */

  $("#btn-export").addEventListener("click", async () => {
    if (!RESULTS) return;
    const btn = $("#btn-export");
    btn.disabled = true;
    btn.textContent = "Préparation du classeur...";
    try {
      if (MODE_AUDIT !== "serveur") {
        const buf = await window.ConformeExcel.exporter(RESULTS);
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = window.ConformeExcel.nomFichier(RESULTS);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      } else {
        const r = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(RESULTS),
        });
        if (!r.ok) throw new Error("export refusé");
        const blob = await r.blob();
        const dispo = r.headers.get("Content-Disposition") || "";
        let name = "Audit_accessibilite_RGAA.xlsx";
        const m = dispo.match(/filename\*?=(?:UTF-8''|")?([^";]+)/);
        if (m) name = decodeURIComponent(m[1].replace(/"/g, ""));
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      }
    } catch (err) {
      alert("L'export Excel a échoué : " + (err.message || "erreur inconnue"));
    } finally {
      btn.disabled = false;
      btn.textContent = "Télécharger l'audit Excel";
    }
  });

  $("#btn-restart").addEventListener("click", () => {
    RESULTS = null;
    $("#url").value = "";
    show("home");
    $("#url").focus();
  });

  /* ---------------- thème : suit le système, avec choix possible ---------------- */

  const THEME_KEY = "conforme-theme";
  function appliquerTheme(pref) {
    const root = document.documentElement;
    root.removeAttribute("data-theme");
    if (pref === "clair") root.setAttribute("data-theme", "clair");
    if (pref === "sombre") root.setAttribute("data-theme", "sombre");
    root.style.colorScheme = pref === "clair" ? "light" : pref === "sombre" ? "dark" : "";
  }
  function themeActuel() { return localStorage.getItem(THEME_KEY) || "auto"; }
  function initTheme() {
    appliquerTheme(themeActuel());
    for (const btn of document.querySelectorAll("#theme-ctl button")) {
      btn.setAttribute("aria-pressed", btn.dataset.theme === themeActuel() ? "true" : "false");
      btn.addEventListener("click", () => {
        localStorage.setItem(THEME_KEY, btn.dataset.theme);
        appliquerTheme(btn.dataset.theme);
        for (const b of document.querySelectorAll("#theme-ctl button")) b.setAttribute("aria-pressed", b.dataset.theme === btn.dataset.theme ? "true" : "false");
        if (window.__specimenContraste) window.__specimenContraste();
        if (window.__specimenLecteur) window.__specimenLecteur();
      });
    }
  }

  /* ---------------- compteurs animés et apparitions ---------------- */

  const REDUIT = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function compterJusque(el, cible, duree) {
    if (REDUIT) { el.textContent = cible; return; }
    const t0 = performance.now();
    const fin = t0 + duree;
    const pas = (t) => {
      const k = Math.min(1, (t - t0) / duree);
      const v = Math.round(cible * (1 - Math.pow(1 - k, 3)));
      el.textContent = String(v);
      if (k < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  }

  function initReveal() {
    const cibles = document.querySelectorAll(".specimen, .plaque-demo");
    if (REDUIT || !("IntersectionObserver" in window)) {
      for (const c of cibles) c.classList.add("vu");
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("vu");
          if (e.target.classList.contains("plaque-demo")) e.target.classList.add("tamponne");
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.35 });
    for (const c of cibles) io.observe(c);
  }

  /* ---------------- spécimens fonctionnels (le dossier en trois mesures) ---------------- */

  function initSpecimens() {
    // ---- mesure 1 : le contraste (critère 3.2, méthode réelle)
    const slider = $("#contraste-slider");
    const texte = $("#contraste-texte");
    const ratioEl = $("#contraste-ratio");
    const chipC = $("#contraste-chip");
    const wrap = $("#spec-contraste");
    if (!slider || !texte) return;

    const lum = (r, g, b) => {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const rgbTxt = (s) => {
      s = (s || "").trim();
      let m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) return [+m[1], +m[2], +m[3]];
      m = s.match(/^#([0-9a-f]{6})$/i);
      if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
      m = s.match(/^#([0-9a-f]{3})$/i);
      if (m) return m[1].split("").map((c) => parseInt(c + c, 16));
      return [128, 128, 128];
    };
    const varCss = (nom) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim();

    function couleur(t) {
      const pale = rgbTxt(varCss("--demo-pale"));
      const plein = rgbTxt(varCss("--demo-plein"));
      const k = t / 100;
      const c = pale.map((v, i) => Math.round(v + (plein[i] - v) * k));
      return c;
    }

    function maj() {
      const t = parseInt(slider.value, 10);
      const zone = document.querySelector(".contraste-demo") || wrap;
      const bg = rgbTxt(getComputedStyle(zone).backgroundColor);
      const c = couleur(t);
      texte.style.color = "rgb(" + c.join(",") + ")";
      const l1 = lum(c[0], c[1], c[2]), l2 = lum(bg[0], bg[1], bg[2]);
      const val = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const affiche = String(Math.round(val * 100) / 100).replace(".", ",") + ":1";
      ratioEl.textContent = affiche;
      const ok = val >= 4.5;
      chipC.textContent = ok ? "Conforme" : "Non conforme";
      chipC.className = "verdict-chip " + (ok ? "v-c" : "v-nc");
      slider.setAttribute("aria-valuetext", "Contraste " + affiche + (ok ? ", conforme" : ", non conforme"));
      wrap.style.setProperty("--seuil-x", (window.__seuilX || 58) + "%");
    }
    window.__specimenContraste = maj;

    function calcSeuil() {
      const zone = document.querySelector(".contraste-demo") || wrap;
      const bg = rgbTxt(getComputedStyle(zone).backgroundColor);
      for (let t = 0; t <= 100; t++) {
        const c = couleur(t);
        const l1 = lum(c[0], c[1], c[2]), l2 = lum(bg[0], bg[1], bg[2]);
        const val = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (val >= 4.5) { window.__seuilX = t; return; }
      }
      window.__seuilX = 58;
    }
    calcSeuil();
    maj();
    slider.addEventListener("input", maj);

    // ---- mesure 2 : le lecteur d'écran (critère 1.1)
    const sw = $("#lecteur-switch");
    const bulle = $("#lecteur-txt");
    const ALT = "Des randonneurs gravissent le chemin de la crête au lever du soleil.";
    let timer = null;
    function ecrire(txt) {
      if (timer) clearInterval(timer);
      if (REDUIT) { bulle.textContent = txt; return; }
      bulle.textContent = "";
      let i = 0;
      timer = setInterval(() => {
        i += 1 + Math.floor(Math.random() * 2);
        bulle.textContent = txt.slice(0, i);
        if (i >= txt.length) clearInterval(timer);
      }, 26);
    }
    function majLecteur() {
      ecrire(sw.checked ? ALT : "image");
    }
    window.__specimenLecteur = majLecteur;
    sw.addEventListener("change", majLecteur);
    majLecteur();

    // ---- mesure 3 : la plaque de verdict (se tamponne au scroll)
    const nums = [...document.querySelectorAll(".plaque .num")];
    function animerPlaque() {
      const cibles = ["72,7", "70,0", "4"];
      if (REDUIT) {
        nums.forEach((n, i) => n.textContent = cibles[i]);
        return;
      }
      nums.forEach((n, i) => {
        const cible = parseFloat(cibles[i].replace(",", "."));
        const entier = i === 2;
        const t0 = performance.now();
        const pas = (t) => {
          const k = Math.min(1, (t - t0) / 900);
          const v = cible * (1 - Math.pow(1 - k, 3));
          n.textContent = entier ? String(Math.round(v)) : String(Math.round(v * 10) / 10).replace(".", ",");
          if (k < 1) requestAnimationFrame(pas);
        };
        requestAnimationFrame(pas);
      });
    }
    const plaque = $("#spec-plaque");
    if (plaque) {
      const io = new IntersectionObserver((es) => {
        for (const e of es) if (e.isIntersecting) { animerPlaque(); io.disconnect(); }
      }, { threshold: 0.4 });
      io.observe(plaque);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initReveal();
    initSpecimens();
    detecterMode();
    $("#url").focus();
  });

})();
