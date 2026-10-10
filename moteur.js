/* ============================================================
   Conforme : moteur d'audit RGAA 4.1.2 (critères 1.1, 3.2, 6.1)
   Mode navigateur : tout se passe dans le navigateur du visiteur,
   sans serveur. Le code des pages est récupéré par un relais CORS
   public, puis analysé dans un iframe inactif (scripts du site
   désactivés, styles calculés disponibles) : images, liens avec
   nom accessible, contrastes de texte.
   ============================================================ */
(() => {
  "use strict";

  const MAX_PAGES = 8;
  const TIMEOUT_RECUP = 26000;   /* relais lents : larges délais pour la récupération */
  const TIMEOUT = 13000;

  const PROXIES = [
    { nom: "relais allOrigins", url: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u), entetes: {} },
    { nom: "relais allOrigins (variante)", url: (u) => "https://api.allorigins.win/get?url=" + encodeURIComponent(u), entetes: {}, json: "contents" },
    { nom: "relais codetabs", url: (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u), entetes: {} },
    { nom: "relais jina", url: (u) => "https://r.jina.ai/" + u, entetes: { "x-return-format": "html" } },
  ];

  const VAGUE = new Set([
    "en savoir plus", "lire la suite", "voir plus", "voir tout", "tout voir", "cliquez ici",
    "cliquer ici", "ici", "plus", "détails", "en détail", "découvrir", "je découvre",
    "c'est parti", "cest parti", "je réserve", "je reserve", "en savoir davantage",
    "continuer", "suivant", "précédent", "ouvrir", "afficher plus", "voir l'article",
    "lire l'article", "aller", "voir", "consulter", "télécharger", "envoyer", "go", "ok",
    "read more", "learn more", "click here", "more", "see more", "view all", "see all",
    "details", "download", "submit", "next", "previous", "open", "show more",
    "arrow", "chevron", "suiv", "prec",
  ]);

  const SKIP_EXT = /\.(jpg|jpeg|png|webp|avif|gif|svg|css|js|json|xml|txt|pdf|zip|ico|mp4|mp3|webm|woff2?|ttf)($|\?)/i;
  const FILE_ALT = /(\.(jpg|jpeg|png|webp|avif|gif|svg)$|^dsc[_ -]|^img[_ -]|^photo[_ -]|^image[_ -])/i;
  const MOT_OUTIL = /\b(le|la|les|de|du|des|un|une|et|à|a|au|aux|en|sur|avec|dans|pour|par|the|of|on|in|at|and|with)\b/i;

  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const normLabel = (s) => String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const contient = (a, b) => normLabel(a).includes(normLabel(b));

  function normaliserUrl(raw) {
    raw = (raw || "").trim();
    if (!raw) return { err: "Donnez l'adresse du site à auditer." };
    if (!raw.includes("://")) raw = "https://" + raw;
    let p;
    try { p = new URL(raw); } catch (e) { return { err: "Cette adresse ne ressemble pas à une adresse de site (exemple : www.exemple.fr)." }; }
    if (p.protocol !== "http:" && p.protocol !== "https:") return { err: "Seules les adresses http et https peuvent être auditées." };
    if (p.hostname === "localhost" || /^127\.|^0\.0\.0\.0$/.test(p.hostname)) return { err: "Cette adresse pointe vers votre propre machine, elle ne peut pas être auditée." };
    return { url: p.href };
  }

  function estDefi(texte) {
    if (!texte || texte.length < 250) return true;
    const bas = texte.slice(0, 6000).toLowerCase();
    if (/datadome|captcha|challenge-platform|cf-chl|cf_chl|just a moment|attention required|checking your browser|veuillez patienter|verifying you are|access denied|accès refusé|enable javascript/.test(bas)) return true;
    const titre = (texte.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
    const domaine = (texte.match(/https?:\/\/([^\/\s"]+)/) || [])[1] || "";
    const t = titre.trim().toLowerCase().replace(/^www\./, "");
    if (t && domaine && t === domaine.toLowerCase().replace(/^www\./, "")) return true;
    if (/^Title:\s/m.test(texte) && /Markdown Content:/.test(texte)) return true; /* jina a renvoyé du markdown au lieu du html */
    const texteNu = texte.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return texteNu.length < 350;
  }

  function avecBuste(url) {
    /* les relais mettent en cache : une marque unique force la version fraîche */
    return url + (url.includes("?") ? "&" : "?") + "_c=" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  async function tenterRelais(proxy, url, signalDef) {
    const r = await fetch(proxy.url(avecBuste(url)), { signal: signalDef.signal, headers: Object.assign({ Accept: "text/html,*/*" }, proxy.entetes) });
    if (!r.ok) throw new Error("code " + r.status);
    let texte = await r.text();
    if (proxy.json) {
      try { texte = JSON.parse(texte).contents || ""; } catch (e) { throw new Error("réponse illisible"); }
    }
    if (estDefi(texte)) throw new Error("page de vérification, vide ou format markdown");
    return texte;
  }

  async function recupererPage(url, emit) {
    const ordres = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
    ];
    for (let manche = 0; manche < ordres.length; manche++) {
      for (const idx of ordres[manche]) {
        const proxy = PROXIES[idx];
        const controle = new AbortController();
        const chrono = setTimeout(() => controle.abort(), TIMEOUT_RECUP);
        try {
          const texte = await tenterRelais(proxy, url, { signal: controle.signal });
          clearTimeout(chrono);
          emit({ type: "log", text: "Page récupérée via " + proxy.nom + "." });
          return texte;
        } catch (e) {
          clearTimeout(chrono);
          emit({ type: "log", text: proxy.nom + " : " + String(e.message || e).slice(0, 44) + ", essai suivant." });
        }
      }
      if (manche === 0) {
        const pause = 2600 + Math.floor(Math.random() * 1200);
        emit({ type: "log", text: "Tous les relais ont buté sur cette page, nouvelle tentative après " + Math.round(pause / 100) / 10 + " s." });
        await new Promise((r) => setTimeout(r, pause));
      }
    }
    throw new Error("aucun relais n'a pu récupérer cette page (site protégé, trop lent, ou relais saturés)");
  }

  // petit réservoir de tâches : N auditions de pages en même temps, pas plus
  async function reservoir(liste, taille, travail) {
    const resultats = new Array(liste.length);
    let suivant = 0;
    async function ouvrier() {
      while (suivant < liste.length) {
        const i = suivant;
        suivant += 1;
        resultats[i] = await travail(liste[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(taille, liste.length) }, ouvrier));
    return resultats;
  }

  function liensInternes(html, baseUrl, limite, navDArtabord = true) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const origin = new URL(baseUrl).hostname.replace(/^www\./, "");
    const vus = new Set();
    const nav = [], autres = [];
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (/^(mailto:|tel:|javascript:|#)/.test(href) || SKIP_EXT.test(href)) continue;
      let abs;
      try { abs = new URL(href, baseUrl); } catch (e) { continue; }
      if (!/^https?:$/.test(abs.protocol) || abs.hostname.replace(/^www\./, "") !== origin) continue;
      const key = (abs.pathname.replace(/\/$/, "") || "/") + abs.search;
      if (vus.has(key)) continue;
      vus.add(key);
      const cible = { url: abs.href, dansNav: !!a.closest("nav, header") };
      (cible.dansNav ? nav : autres).push(cible);
    }
    return (navDArtabord ? nav.concat(autres) : autres.concat(nav)).slice(0, limite).map((c) => c.url);
  }

  /* ---------------- le script d'analyse exécuté dans le iframe ---------------- */

  const SCRIPT_PAGE = `
    window.__result = (function () {
      const doc = document, win = window;
      const norm = (s) => String(s == null ? "" : s).replace(/\\s+/g, " ").trim();
      const normLabel = (s) => String(s || "").toLowerCase().replace(/[^\\w\\s]/g, " ").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const st = win.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width >= 2 && r.height >= 2;
      };
      const nomAccessible = (a) => {
        if (!a) return "";
        const lbl = a.getAttribute("aria-labelledby");
        if (lbl) {
          let t = "";
          for (const id of lbl.split(/\\s+/)) {
            const el = doc.getElementById(id);
            if (el) t += " " + el.textContent;
          }
          if (t.trim()) return t.replace(/\\s+/g, " ").trim();
        }
        if ((a.getAttribute("aria-label") || "").trim()) return a.getAttribute("aria-label").replace(/\\s+/g, " ").trim();
        let t = "";
        const marcher = (node) => {
          if (node.nodeType === 3) { t += " " + node.textContent; return; }
          if (node.nodeType !== 1) return;
          const tag = node.tagName.toLowerCase();
          if (node.getAttribute("aria-hidden") === "true") return;
          if (tag === "img") { const alt = node.getAttribute("alt"); if (alt) t += " " + alt; return; }
          if (tag === "svg") {
            const al = node.getAttribute("aria-label") || (node.querySelector(":scope > title") ? node.querySelector(":scope > title").textContent : "");
            if (al) { t += " " + al; return; }
            if (node.getAttribute("role") === "img") return;
          }
          for (const c of node.childNodes) marcher(c);
        };
        for (const c of a.childNodes) marcher(c);
        if (!t.trim() && (a.getAttribute("title") || "").trim()) return a.getAttribute("title").replace(/\\s+/g, " ").trim();
        return t.replace(/\\s+/g, " ").trim();
      };
      const contexteTitre = (a) => {
        let anc = a.closest("article, section, li, td, th, main");
        while (anc) {
          const hs = [...anc.querySelectorAll("h1,h2,h3,h4,h5,h6")];
          let best = null;
          for (const h of hs) {
            if (h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
          }
          if (best) return best.textContent.replace(/\\s+/g, " ").trim().slice(0, 90);
          const p = anc.parentElement && anc.parentElement.closest("article, section, li, main");
          if (!p) break;
          anc = p;
        }
        return "";
      };
      const imgs = [...doc.querySelectorAll("img")].map((i) => {
        const link = i.closest("a[href]");
        return {
          src: (i.src || "").slice(0, 140),
          alt: i.hasAttribute("alt") ? i.getAttribute("alt") : null,
          inLink: !!link,
          visible: visible(i),
          linkName: link ? nomAccessible(link).slice(0, 100) : "",
        };
      });
      const links = [...doc.querySelectorAll("a[href]")].map((a) => {
        const r = a.getBoundingClientRect();
        const visL = win.getComputedStyle(a).display !== "none" && win.getComputedStyle(a).visibility !== "hidden" && r.width > 1 && r.height > 1;
        const imgsL = [...a.querySelectorAll("img")];
        const svgsL = [...a.querySelectorAll("svg")];
        return {
          href: (a.getAttribute("href") || "").slice(0, 160),
          aria: a.getAttribute("aria-label"),
          title: a.getAttribute("title"),
          text: (a.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 100),
          name: nomAccessible(a).slice(0, 120),
          visible: visL,
          imgAlt: imgsL.filter((i) => i.getAttribute("alt")).map((i) => i.getAttribute("alt").slice(0, 60)).join(" | ").slice(0, 80),
          imgEmptyAlt: imgsL.some((i) => i.getAttribute("alt") === ""),
          svgHidden: svgsL.length > 0 && svgsL.every((s) => s.getAttribute("aria-hidden") === "true"),
          svgAria: svgsL.map((s) => s.getAttribute("aria-label")).filter(Boolean).join(" | ").slice(0, 80),
          svgRoleImg: svgsL.some((s) => s.getAttribute("role") === "img"),
          ctx: contexteTitre(a),
          inNav: !!a.closest("nav, header"),
        };
      });
      const svgs = [...doc.querySelectorAll("svg")].map((s) => ({
        role: s.getAttribute("role"),
        hidden: s.getAttribute("aria-hidden"),
        aria: s.getAttribute("aria-label"),
        labelledby: s.getAttribute("aria-labelledby"),
        hasTitle: !!s.querySelector(":scope > title"),
        inLink: !!s.closest("a[href]"),
        visible: visible(s),
        text: (s.textContent || "").trim().slice(0, 40),
      }));
      // contrastes
      const parseC = (s) => {
        s = (s || "").trim();
        let m = s.match(/^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)$/i);
        if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
        m = s.match(/^#([0-9a-f]{6})$/i);
        if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
        m = s.match(/^oklch\\((\\d*\\.?\\d+)%?\\s+(\\d*\\.?\\d+)\\s+(-?\\d*\\.?\\d+)(?:\\s*\\/\\s*(\\d*\\.?\\d+|\\d+%))?\\)$/i);
        if (m) {
          const L = (m[1].includes("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1])) / 100;
          const C = parseFloat(m[2]), H = (parseFloat(m[3]) * Math.PI) / 180;
          const a = Math.cos(H) * C, b = Math.sin(H) * C;
          const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
          const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
          const s2 = L - 0.0894841775 * a - 1.291485548 * b;
          const l3 = l_ ** 3, m3 = m_ ** 3, s3 = s2 ** 3;
          let r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
          let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
          let bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
          const gam = (c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
          const cl = (c) => Math.min(255, Math.max(0, Math.round(gam(c) * 255)));
          return [cl(r), cl(g), cl(bl), m[4] === undefined ? 1 : (String(m[4]).includes("%") ? parseFloat(m[4]) / 100 : +m[4])];
        }
        m = s.match(/^color\\(\\s*srgb\\s+(\\d*\\.?\\d+)%?\\s+(\\d*\\.?\\d+)%?\\s+(\\d*\\.?\\d+)%?/i);
        if (m) {
          const pc = (v) => (+v > 1 ? +v / 100 : +v);
          return [Math.round(pc(m[1]) * 255), Math.round(pc(m[2]) * 255), Math.round(pc(m[3]) * 255), 1];
        }
        m = s.match(/^light-dark\\(([\\s\\S]+),\\s*([\\s\\S]+)\\)$/i);
        if (m) {
          const sombre = win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches;
          return parseC(sombre ? m[2].trim() : m[1].trim());
        }
        const noms = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128] };
        if (noms[s.toLowerCase()]) return noms[s.toLowerCase()].concat(1);
        return null;
      };
      const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const l1 = lum(a[0], a[1], a[2]), l2 = lum(b[0], b[1], b[2]); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const contrast = { checked: 0, fails: [], unsure: [], pairs: {} };
      try {
        const walker = doc.createTreeWalker(doc.body || doc.documentElement, 4);
        let n;
        while ((n = walker.nextNode())) {
          const t = n.textContent.trim();
          if (!t) continue;
          const el = n.parentElement;
          if (!el) continue;
          const st = win.getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden" || +st.opacity < 0.5) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          const fg = parseC(st.color);
          if (!fg) continue;
          const couches = [];
          let base = null, surImage = false, e = el;
          while (e && e !== doc.documentElement) {
            const st2 = win.getComputedStyle(e);
            if (st2.backgroundImage && st2.backgroundImage !== "none") {
              const bgi = st2.backgroundImage;
              const arrets = [...bgi.matchAll(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/g)].map((m) => ([+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]));
              if (arrets.length) {
                // pire cas : l'arrêt le plus opaque du dégradé, composé sur ce qui est dessous
                const pire = arrets.reduce((a, b) => (b[3] > a[3] ? b : a));
                couches.push(pire);
              } else {
                surImage = true; break;  /* image bitmap : non mesurable */
              }
            }
            const c = parseC(st2.backgroundColor);
            if (c && c[3] >= 1) { base = c.slice(0, 3); break; }
            if (c && c[3] > 0) couches.push(c);
            e = e.parentElement;
          }
          if (surImage) { contrast.unsure.push({ text: t.slice(0, 50), detail: "texte posé sur une image, à vérifier à la main", color: st.color }); continue; }
          if (!base) base = [255, 255, 255];
          for (let i = couches.length - 1; i >= 0; i--) {
            const L = couches[i];
            base = [0, 1, 2].map((k) => Math.round(base[k] * (1 - L[3]) + L[k] * L[3]));
          }
          const cr = ratio(fg, base);
          contrast.checked++;
          const size = parseFloat(st.fontSize);
          const bold = parseInt(st.fontWeight) >= 700;
          const th = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
          if (cr < th) contrast.fails.push({ text: t.slice(0, 50), color: st.color, bg: "rgb(" + base.join(",") + ")", ratio: Math.round(cr * 100) / 100, needed: th, size: Math.round(size), bold: bold });
        }
        contrast.fails = contrast.fails.slice(0, 15);
        contrast.unsure = contrast.unsure.slice(0, 8);
      } catch (e) { contrast.erreur = String(e).slice(0, 80); }
      const texte = (doc.body ? doc.body.innerText : "").slice(0, 8000).toLowerCase();
      return {
        title: (doc.title || "").trim(),
        imgs: imgs, links: links, svgs: svgs,
        area: [...doc.querySelectorAll("area")].map((a) => ({ alt: a.getAttribute("alt"), aria: a.getAttribute("aria-label") })),
        inputImg: [...doc.querySelectorAll('input[type="image"]')].map((i) => ({ alt: i.getAttribute("alt"), aria: i.getAttribute("aria-label"), title: i.getAttribute("title") })),
        ismap: doc.querySelectorAll("img[ismap]").length,
        objects: [...doc.querySelectorAll("object")].map((o) => ({ type: o.getAttribute("type") || "", role: o.getAttribute("role"), aria: o.getAttribute("aria-label"), title: o.getAttribute("title") })),
        embeds: [...doc.querySelectorAll("embed")].map((o) => ({ type: o.getAttribute("type") || "", role: o.getAttribute("role"), aria: o.getAttribute("aria-label"), title: o.getAttribute("title") })),
        canvases: [...doc.querySelectorAll("canvas")].map((c) => ({ role: c.getAttribute("role"), aria: c.getAttribute("aria-label"), labelledby: c.getAttribute("aria-labelledby"), content: (c.textContent || "").trim().slice(0, 60) })),
        h1: [...doc.querySelectorAll("h1")].map((h) => h.textContent.replace(/\\s+/g, " ").trim().slice(0, 80)),
        contrast: contrast,
        contrastMechanism: /(fort contraste|contraste élevé|contraste renforcé|high contrast|augmenter le contraste)/.test(texte),
      };
    })();
  `;

  function nettoyerHtml(html, pageUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script").forEach((s) => s.remove());
    const baseExistant = doc.querySelector("base");
    if (baseExistant) baseExistant.remove();
    const base = doc.createElement("base");
    base.setAttribute("href", pageUrl);
    const head = doc.querySelector("head");
    if (head) head.prepend(base);
    return "<!DOCTYPE html>" + doc.documentElement.outerHTML;
  }

  function auditPage(srcHtml, pageUrl) {
    const propre = nettoyerHtml(srcHtml, pageUrl);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.setAttribute("title", "zone d'analyse");
    iframe.style.cssText = "position:absolute; left:-30000px; top:0; width:1280px; height:900px; border:0;";
    document.body.appendChild(iframe);
    return new Promise((resolve) => {
      let fini = false;
      const clore = (v) => { if (!fini) { fini = true; clearTimeout(chrono); iframe.remove(); resolve(v); } };
      const chrono = setTimeout(() => clore({ url: pageUrl, error: "chargement du code trop lent" }), TIMEOUT + 5000);
      iframe.onload = () => {
        setTimeout(() => {
          try {
            const win = iframe.contentWindow, doc = iframe.contentDocument;
            win.eval(SCRIPT_PAGE);
            const r = win.__result || {};
            r.url = pageUrl;
            r.error = null;
            clore(r);
          } catch (e) {
            clore({ url: pageUrl, error: "analyse impossible : " + String(e.message || e).slice(0, 80) });
          }
        }, 1600);
      };
      iframe.srcdoc = propre;
    });
  }

  /* ---------------- verdicts (mêmes règles que le mode serveur) ---------------- */

  function verdicts(pages) {
    const tests = [];
    const okPages = pages.filter((p) => !p.error);
    const evid = (page, detail) => ({ page: page, detail: detail });

    const add = (tid, crit, theme, title, verify, fails, unsures, applicable, reco, comment) => {
      let verdict;
      if (!applicable.length) verdict = "Non applicable";
      else if (fails.length) verdict = "Non conforme";
      else if (unsures.length) verdict = "Non testé";
      else verdict = "Conforme";
      tests.push({
        id: tid, criterion: crit, theme: theme, title: title, verify: verify,
        verdict: verdict,
        counts: { ok: Math.max(0, applicable.length - fails.length - unsures.length), ko: fails.length, unsure: unsures.length },
        pages: [...new Set(applicable)],
        examples: fails.slice(0, 6), unsure: unsures.slice(0, 6),
        reco: reco, comment: comment || "",
      });
    };

    // 1.1.1
    const f111 = [], u111 = [], app111 = [];
    let imgTotal = 0;
    for (const p of okPages) {
      for (const im of p.imgs || []) {
        if (!im.visible) continue;
        imgTotal++;
        const u = p.url;
        const src = (im.src || "").split("?")[0].split("/").pop().slice(0, 40);
        app111.push(u);
        if (im.alt === null) f111.push(evid(u, "image sans attribut alt (fichier " + src + ")"));
        else if (im.alt.trim() === "") {
          if (im.inLink && !(im.linkName || "").trim()) f111.push(evid(u, "image dans un lien sans nom accessible (fichier " + src + ") : le lien est muet"));
        } else if (FILE_ALT.test(im.alt)) f111.push(evid(u, "alt inutile : reprend le nom du fichier (\"" + im.alt.slice(0, 50) + "\")"));
        else if (im.alt.length > 150) u111.push(evid(u, "alt très long (" + im.alt.length + " caractères), à relire : \"" + im.alt.slice(0, 60) + "...\""));
        else if (im.alt.split(/\s+/).length >= 6 && !MOT_OUTIL.test(im.alt)) u111.push(evid(u, "alt en liste de mots clés plutôt qu'en phrase : \"" + im.alt.slice(0, 60) + "\""));
      }
    }
    add("1.1.1", "1.1", "1.1 Images", "Chaque image porteuse d'information a-t-elle une alternative textuelle ?",
      "Pour chaque image informative, vérifier qu'elle a un attribut alt (ou aria-label, aria-labelledby, title) qui décrit vraiment l'information.",
      f111, u111, app111,
      "Ajouter un attribut alt court et utile à chaque image informative. Garder alt=\"\" pour les images de décoration. Corriger d'abord les images sans alt du tout.",
      imgTotal + " images examinées.");

    // 1.1.2
    const f112 = [], app112 = [];
    for (const p of okPages) for (const a of p.area || []) {
      app112.push(p.url);
      if (!((a.alt || "").trim()) && !((a.aria || "").trim())) f112.push(evid(p.url, "zone réactive (balise area) sans alt ni aria-label"));
    }
    add("1.1.2", "1.1", "1.1 Images", "Chaque zone d'une image réactive (balise area) porteuse d'information a-t-elle une alternative textuelle ?",
      "Vérifier la présence d'un attribut alt ou aria-label sur chaque balise area.",
      f112, [], app112, "Ajouter un alt qui décrit la zone réactive.", app112.length + " zones réactives trouvées.");

    // 1.1.3
    const f113 = [], app113 = [];
    for (const p of okPages) for (const b of p.inputImg || []) {
      app113.push(p.url);
      if (!(b.alt || b.aria || b.title)) f113.push(evid(p.url, "bouton de type image sans alternative textuelle"));
    }
    add("1.1.3", "1.1", "1.1 Images", "Chaque bouton de type image (input type=\"image\") a-t-il une alternative textuelle ?",
      "Vérifier la présence d'une alternative (alt, aria-label, aria-labelledby ou title).",
      f113, [], app113, "Ajouter un alt qui décrit l'action du bouton.", app113.length + " boutons image trouvés.");

    // 1.1.4
    const f114 = [], app114 = [];
    for (const p of okPages) if (p.ismap) { app114.push(p.url); f114.push(evid(p.url, "image réactive côté serveur (ismap) : vérifier un autre accès aux mêmes destinations")); }
    add("1.1.4", "1.1", "1.1 Images", "Chaque zone cliquable d'une image réactive côté serveur est-elle doublée d'un autre accès à la même destination ?",
      "Vérifier qu'un lien ou un autre composant permet d'accéder aux mêmes ressources que l'image réactive.",
      f114, [], app114, "Doubler l'image ismap de liens textes vers les mêmes destinations.", app114.length + " images ismap trouvées.");

    // 1.1.5
    const f115 = [], u115 = [], app115 = [];
    let svgTotal = 0;
    for (const p of okPages) for (const s of p.svgs || []) {
      if (!s.visible) continue;
      svgTotal++;
      const u = p.url;
      if (s.hidden === "true") continue;
      if (s.role === "img") {
        app115.push(u);
        if (!(s.aria || s.labelledby || s.hasTitle)) f115.push(evid(u, "svg avec role=\"img\" mais sans alternative (aria-label, aria-labelledby ou title)"));
      } else if (s.aria || s.hasTitle) app115.push(u);
      else if ((s.text || "").trim()) u115.push(evid(u, "svg porteur de texte sans role=\"img\" ni alternative, à vérifier"));
    }
    add("1.1.5", "1.1", "1.1 Images", "Chaque image vectorielle (balise svg) porteuse d'information a-t-elle role=\"img\" et une alternative ?",
      "Vérifier que les svg informatifs portent role=\"img\" et une alternative (title, aria-label ou aria-labelledby).",
      f115, u115, app115,
      "Donner role=\"img\" et une alternative aux svg informatifs ; masquer les svg décoratifs avec aria-hidden=\"true\".",
      svgTotal + " svg examinés, dont " + app115.length + " informatifs.");

    // 1.1.6 / 1.1.7 / 1.1.8
    const f116 = [], app116 = [];
    for (const p of okPages) for (const o of p.objects || []) {
      if ((o.type || "").startsWith("image")) {
        app116.push(p.url);
        if (!(o.role === "img" && (o.aria || o.title))) f116.push(evid(p.url, "image objet (balise object) sans role=\"img\" ni alternative"));
      }
    }
    add("1.1.6", "1.1", "1.1 Images", "Chaque image objet (balise object avec type=\"image/…\") porteuse d'information a-t-elle une alternative ?",
      "Vérifier role=\"img\" et une alternative, ou un accès à un contenu alternatif.",
      f116, [], app116, "Remplacer si possible l'object par une img avec alt, sinon ajouter role=\"img\" et l'alternative.", app116.length + " images objet trouvées.");

    const f117 = [], app117 = [];
    for (const p of okPages) for (const o of p.embeds || []) {
      if ((o.type || "").startsWith("image")) {
        app117.push(p.url);
        if (!(o.role === "img" && (o.aria || o.title))) f117.push(evid(p.url, "image embarquée (balise embed) sans role=\"img\" ni alternative"));
      }
    }
    add("1.1.7", "1.1", "1.1 Images", "Chaque image embarquée (balise embed avec type=\"image/…\") porteuse d'information a-t-elle une alternative ?",
      "Vérifier role=\"img\" et une alternative, ou un accès à un contenu alternatif.",
      f117, [], app117, "Remplacer si possible l'embed par une img avec alt, sinon ajouter role=\"img\" et l'alternative.", app117.length + " images embarquées trouvées.");

    const f118 = [], app118 = [];
    for (const p of okPages) for (const c of p.canvases || []) {
      app118.push(p.url);
      const nomme = c.role === "img" && (c.aria || c.labelledby);
      if (!(nomme || c.content)) f118.push(evid(p.url, "canvas sans alternative (pas d'aria, pas de contenu de repli)"));
    }
    add("1.1.8", "1.1", "1.1 Images", "Chaque image bitmap (balise canvas) porteuse d'information a-t-elle une alternative ?",
      "Vérifier role=\"img\" et une alternative, un contenu de repli entre les balises, ou un mécanisme de remplacement.",
      f118, [], app118, "Fournir un contenu de repli entre les balises canvas ou un mécanisme de remplacement.", app118.length + " canvas trouvés.");

    // 3.2 contrastes
    const ctrChecked = okPages.reduce((s, p) => s + ((p.contrast && p.contrast.checked) || 0), 0);
    const rawFails = [], tousUnsure = [];
    for (const p of okPages) {
      for (const f of (p.contrast || {}).fails || []) rawFails.push({ page: p.url, raw: f });
      for (const s of (p.contrast || {}).unsure || []) tousUnsure.push(evid(p.url, "\"" + s.text + "\" : " + s.detail));
    }
    const spec = [
      ["3.2.1", "Le texte sans effet de graisse de moins de 24 px a-t-il un contraste d'au moins 4,5:1 ?",
        "Mesurer le contraste entre la couleur du texte et son fond pour les textes de moins de 24 px sans graisse. Seuil : 4,5:1.",
        "Rapprocher la couleur du texte ou celle du fond pour dépasser 4,5:1.",
        (f) => !(f.bold) && f.size < 24],
      ["3.2.2", "Le texte en gras de moins de 18,5 px a-t-il un contraste d'au moins 4,5:1 ?",
        "Même mesure pour les textes en gras de moins de 18,5 px. Seuil : 4,5:1.",
        "Rapprocher la couleur du texte ou celle du fond pour dépasser 4,5:1.",
        (f) => f.bold && f.size < 18.66],
      ["3.2.3", "Le texte sans effet de graisse d'au moins 24 px a-t-il un contraste d'au moins 3:1 ?",
        "Même mesure pour les grands textes de 24 px et plus. Seuil : 3:1.",
        "Rapprocher la couleur du texte ou celle du fond pour dépasser 3:1.",
        (f) => !(f.bold) && f.size >= 24],
      ["3.2.4", "Le texte en gras d'au moins 18,5 px a-t-il un contraste d'au moins 3:1 ?",
        "Même mesure pour les textes en gras de 18,5 px et plus. Seuil : 3:1.",
        "Rapprocher la couleur du texte ou celle du fond pour dépasser 3:1.",
        (f) => f.bold && f.size >= 18.66],
    ];
    const appPages = okPages.map((p) => p.url);
    for (const [tid, title, verify, reco, match] of spec) {
      const bf = rawFails.filter((x) => match(x.raw)).map((x) => evid(x.page, "\"" + x.raw.text + "\" en " + x.raw.size + " px (" + (x.raw.bold ? "gras" : "sans graisse") + ") : contraste " + String(x.raw.ratio).replace(".", ",") + ":1 au lieu de " + x.raw.needed + ":1 (" + x.raw.color + " sur " + x.raw.bg + ")"));
      add(tid, "3.2", "3.2 Contrastes", title, verify, bf, ctrChecked ? [] : tousUnsure, ctrChecked ? appPages : [], reco,
        ctrChecked ? "Mesure automatique de " + ctrChecked + " textes sur les pages auditées." : "Contrastes non mesurables sans styles calculés, à contrôler à la main.");
    }
    const mech = okPages.some((p) => p.contrastMechanism);
    if (!mech) {
      add("3.2.5", "3.2", "3.2 Contrastes", "Le mécanisme qui permet d'afficher un contraste conforme affiche-t-il bien ce contraste ?",
        "Ce test ne concerne que les sites qui ont un mécanisme d'augmentation du contraste.",
        [], [], [], "Aucune action, le test ne s'applique pas.", "Aucun mécanisme d'augmentation du contraste détecté sur les pages auditées.");
    } else {
      add("3.2.5", "3.2", "3.2 Contrastes", "Le mécanisme qui permet d'afficher un contraste conforme affiche-t-il bien ce contraste ?",
        "Un mécanisme d'augmentation du contraste a été détecté. Vérifier à la main le contraste qu'il affiche.",
        [], okPages.length ? [evid(okPages[0].url, "mécanisme de contraste détecté, contrôle manuel nécessaire")] : [],
        appPages, "Vérifier à la main le contraste affiché par le mécanisme.", "Mécanisme détecté, contrôle manuel nécessaire.");
    }

    // 6.1.1
    const f611 = [], u611 = [], app611 = [];
    const labelsVus = {};
    for (const p of okPages) for (const L of p.links || []) {
      if (!L.visible) continue;
      const txt = norm(L.text);
      if (!txt) continue;
      const u = p.url;
      const name = norm(L.name);
      if (!name) { f611.push(evid(u, "lien texte sans nom accessible (" + L.href.slice(0, 50) + ")")); continue; }
      app611.push(u);
      const low = txt.toLowerCase();
      (labelsVus[low] = labelsVus[low] || new Set()).add((L.href || "").split("?")[0]);
      if (VAGUE.has(low) || VAGUE.has(normLabel(txt))) {
        const aria = (L.aria || "").trim();
        if (aria && normLabel(aria) !== normLabel(txt) && normLabel(aria).length > normLabel(txt).length) continue;
        if (L.ctx && L.ctx.length > 8) u611.push(evid(u, "intitulé \"" + txt.slice(0, 40) + "\" à comprendre avec le contexte \"" + L.ctx.slice(0, 60) + "\" : à juger à la main"));
        else f611.push(evid(u, "lien texte peu explicite : \"" + txt.slice(0, 40) + "\" sans contexte utile"));
      }
    }
    for (const [lab, hrefs] of Object.entries(labelsVus)) {
      if (VAGUE.has(lab) && hrefs.size >= 3) f611.push(evid("toutes les pages", "intitulé \"" + lab + "\" répété pour " + hrefs.size + " destinations différentes"));
    }
    add("6.1.1", "6.1", "6.1 Liens", "Chaque lien texte est-il explicite (intitulé seul ou intitulé plus contexte) ?",
      "Vérifier que l'intitulé (ou l'intitulé plus son contexte) permet de comprendre la fonction et la destination.",
      f611, u611, app611,
      "Préciser la destination dans l'intitulé (exemples : \"Réserver mon billet\", \"Découvrir la carte Avantage Jeune\"). Pour les liens identiques, ajouter le nom de l'offre.",
      app611.length + " liens texte examinés.");

    // 6.1.2
    const f612 = [], app612 = [];
    for (const p of okPages) for (const L of p.links || []) {
      if (!L.visible) continue;
      if (!(L.imgAlt || L.imgEmptyAlt)) continue;
      const u = p.url;
      app612.push(u);
      if (!norm(L.name)) f612.push(evid(u, "lien image sans nom accessible (" + L.href.slice(0, 50) + ")"));
    }
    add("6.1.2", "6.1", "6.1 Liens", "Chaque lien image est-il explicite ?",
      "Vérifier que l'alternative de l'image (ou le contexte) donne la fonction et la destination.",
      f612, [], app612,
      "Donner une alternative claire aux images des liens (alt décrivant la fonction, ex : \"Suivre SNCF Connect sur Instagram\").",
      app612.length + " liens image examinés.");

    // 6.1.3
    const f613 = [], app613 = [];
    for (const p of okPages) for (const L of p.links || []) {
      if (!L.visible || !L.imgAlt || !norm(L.text)) continue;
      const u = p.url;
      app613.push(u);
      if (!norm(L.name)) f613.push(evid(u, "lien composite sans nom accessible complet (" + L.href.slice(0, 50) + ")"));
    }
    add("6.1.3", "6.1", "6.1 Liens", "Chaque lien composite (image plus texte) est-il explicite ?",
      "Vérifier que la combinaison texte plus alternative est claire (ou que le contexte suffit).",
      f613, [], app613, "Vérifier que l'alternative complète le texte sans le contredire.", app613.length + " liens composites examinés.");

    // 6.1.4
    const f614 = [], app614 = [];
    for (const p of okPages) for (const L of p.links || []) {
      if (!L.visible || !(L.svgAria || L.svgRoleImg || L.svgHidden)) continue;
      const u = p.url;
      app614.push(u);
      if (!norm(L.name)) f614.push(evid(u, "lien svg sans nom accessible (" + L.href.slice(0, 50) + ")"));
    }
    add("6.1.4", "6.1", "6.1 Liens", "Chaque lien svg est-il explicite ?",
      "Vérifier le nom accessible du lien svg (aria-label du lien, texte ou aria-label du svg) ou le contexte.",
      f614, [], app614,
      "Nommer le lien (aria-label sur le lien, par exemple \"Retour à l'accueil\") et masquer le svg décoratif.",
      app614.length + " liens svg examinés.");

    // 6.1.5
    const f615 = [], app615 = [];
    for (const p of okPages) for (const L of p.links || []) {
      if (!L.visible) continue;
      const aria = (L.aria || "").trim();
      const vis = norm(L.text);
      if (!aria || !vis) continue;
      const u = p.url;
      app615.push(u);
      if (!contient(aria, vis)) f615.push(evid(u, "intitulé visible \"" + vis.slice(0, 40) + "\" absent du nom accessible \"" + aria.slice(0, 60) + "\""));
    }
    add("6.1.5", "6.1", "6.1 Liens", "Le nom accessible du lien contient-il au moins l'intitulé visible ?",
      "Pour les liens avec aria-label, aria-labelledby ou title, vérifier que le nom accessible contient l'intitulé visible.",
      f615, [], app615,
      "Faire contenir l'intitulé visible au début du nom accessible (ex : \"Réserver mon billet pour Noël\").",
      app615.length + " liens avec aria-label vérifiés.");

    return { tests: tests };
  }

  function scores(tests) {
    const per = {};
    for (const [crit, name] of [["1.1", "1.1 Images"], ["3.2", "3.2 Contrastes"], ["6.1", "6.1 Liens"]]) {
      const tt = tests.filter((t) => t.criterion === crit);
      const c = tt.filter((t) => t.verdict === "Conforme").length;
      const nc = tt.filter((t) => t.verdict === "Non conforme").length;
      const nt = tt.filter((t) => t.verdict === "Non testé").length;
      const na = tt.filter((t) => t.verdict === "Non applicable").length;
      const taux = c + nc ? Math.round((c / (c + nc)) * 10000) / 10000 : null;
      per[crit] = { name: name, tests: tt.length, c: c, nc: nc, nt: nt, na: na, taux: taux };
    }
    const tot = { tests: 0, c: 0, nc: 0, na: 0, nt: 0 };
    for (const v of Object.values(per)) { tot.tests += v.tests; tot.c += v.c; tot.nc += v.nc; tot.na += v.na; tot.nt += v.nt; }
    const global = tot.c + tot.nc ? Math.round((tot.c / (tot.c + tot.nc)) * 10000) / 10000 : null;
    const rates = Object.values(per).map((v) => v.taux).filter((x) => x !== null);
    const mean = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10000) / 10000 : null;
    return { per_criterion: per, global: global, mean: mean, totals: tot };
  }

  function precos(tests, meta) {
    const out = [];
    let n = 0;
    for (const t of tests) {
      if (t.verdict !== "Non conforme") continue;
      n++;
      out.push({
        n: n, test: t.id,
        constat: t.examples.length + " non-conformité(ies) relevée(s) : " + (t.examples[0] ? t.examples[0].detail.slice(0, 110) : ""),
        action: t.reco,
        qui: t.criterion === "3.2" ? "Équipe" : "Développeur",
        priorite: t.criterion === "3.2" ? "Moyenne" : "Haute",
        charge: t.examples.length <= 2 ? "Faible" : "Moyenne",
        etat: "À faire", echeance: "30 jours", commentaire: "",
      });
    }
    n++;
    out.push({ n: n, test: "Procédure", constat: "L'audit porte sur " + meta.pages.length + " pages et 3 critères seulement.", action: "Étendre l'audit aux autres critères du RGAA avec cet outil.", qui: "Auditeur", priorite: "Moyenne", charge: "Élevée", etat: "À faire", echeance: "3 mois", commentaire: "" });
    n++;
    out.push({ n: n, test: "Procédure", constat: "Aucun audit complet RGAA n'est prévu après les corrections.", action: "Planifier un nouvel audit complet puis mettre à jour la déclaration d'accessibilité.", qui: "Auditeur", priorite: "Haute", charge: "Élevée", etat: "À faire", echeance: "12 mois", commentaire: "" });
    n++;
    out.push({ n: n, test: "Procédure", constat: "Les équipes ne sont pas outillées sur l'accessibilité au quotidien.", action: "Former les équipes (alts, liens explicites) et intégrer des tests automatiques dans la fab.", qui: "Auditeur et design", priorite: "Moyenne", charge: "Moyenne", etat: "À faire", echeance: "12 mois", commentaire: "" });
    n++;
    out.push({ n: n, test: "Procédure", constat: "Aucun audit de maintenance n'est prévu.", action: "Refaire un audit annuel et mettre à jour la déclaration d'accessibilité chaque année.", qui: "Auditeur", priorite: "Moyenne", charge: "Élevée", etat: "À faire", echeance: "chaque année", commentaire: "" });
    return out;
  }

  function plan(precos) {
    const haut = precos.filter((p) => p.priorite === "Haute" && p.test !== "Procédure").map((p) => p.n);
    const moy = precos.filter((p) => p.priorite === "Moyenne" && p.test !== "Procédure").map((p) => p.n);
    const bas = precos.filter((p) => p.priorite === "Basse" && p.test !== "Procédure").map((p) => p.n);
    const proc = precos.filter((p) => p.test === "Procédure").map((p) => p.n);
    const ref = (ns) => ns.length ? "précos " + ns.join(", ") : "audit";
    return [
      { n: 1, action: "Corriger les non-conformités prioritaires (images et liens)", base: ref(haut), qui: "Équipe du site", plan: { 0: "En cours", 1: "Planifié" }, livrable: "Toutes les corrections prioritaires en production." },
      { n: 2, action: "Corriger les non-conformités secondaires (contrastes, alts à relire)", base: ref(moy.concat(bas)), qui: "Équipe du site", plan: { 1: "Planifié", 2: "En cours", 3: "Fait" }, livrable: "Corrections secondaires en production." },
      { n: 3, action: "Étendre l'audit aux autres critères du RGAA avec cet outil", base: ref(proc.slice(0, 1)), qui: "Auditeur", plan: { 1: "Planifié", 2: "En cours", 3: "Fait" }, livrable: "Un audit complet du site." },
      { n: 4, action: "Former les équipes (rédaction, design, développement)", base: ref(proc.slice(2, 3).length ? proc.slice(2, 3) : proc), qui: "Auditeur et design", plan: { 2: "Planifié", 3: "Planifié" }, livrable: "Séances de formation faites, supports diffusés." },
      { n: 5, action: "Nouvel audit complet RGAA (échantillon élargi)", base: "Procédure", qui: "Auditeur", plan: { 4: "Planifié", 5: "Planifié" }, livrable: "Rapport d'audit complet avec scores." },
      { n: 6, action: "Mettre à jour la déclaration d'accessibilité", base: "Procédure", qui: "Équipe du site", plan: { 5: "Planifié" }, livrable: "Nouvelle déclaration publiée sur le site." },
      { n: 7, action: "Intégrer des tests automatiques d'accessibilité dans la fab", base: "Procédure", qui: "Équipe technique", plan: { 5: "Planifié", 6: "En cours", 7: "Fait" }, livrable: "Tests automatiques lancés à chaque mise en ligne." },
      { n: 8, action: "Audit de maintenance annuel et mise à jour de la déclaration", base: "Procédure", qui: "Auditeur", plan: { 7: "Planifié", 11: "Planifié" }, livrable: "Déclaration annuelle mise à jour." },
      { n: 9, action: "Contrôle de conformité complet par un tiers", base: "Suite du plan", qui: "Bureau indépendant", plan: { 10: "Planifié", 11: "Planifié" }, livrable: "Contrôle validé, site conforme." },
    ];
  }

  function pointsManuels(tests) {
    const pts = [];
    for (const t of tests) for (const s of t.unsure || []) pts.push({ test: t.id, page: s.page, detail: s.detail });
    return pts.slice(0, 20);
  }

  function resumeVerdict(res) {
    const s = res.scores;
    if (s.global === null) return "AUDIT INCOMPLET";
    if (s.totals.nc === 0 && s.totals.nt === 0) return "CONFORMITÉ TOTALE";
    if (s.global >= 0.5) return "CONFORMITÉ PARTIELLE";
    return "NON CONFORME";
  }

  function pctTxt(x) {
    if (x === null || x === undefined) return "à finir";
    return String(Math.round(x * 1000) / 10).replace(".", ",") + " %";
  }

  /* ---------------- orchestration ---------------- */

  async function auditer(urlBrut, emit) {
    const t0 = Date.now();
    const { url, err } = normaliserUrl(urlBrut);
    if (err) throw new Error(err);
    emit({ type: "log", text: "Audit lancé pour " + url });
    emit({ type: "stage", key: "fetch", text: "Ouverture du site", status: "en cours" });
    emit({ type: "log", text: "Ouverture de " + url });

    const html = await recupererPage(url, emit);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = (doc.title || "").trim();
    emit({ type: "log", text: "Site récupéré : " + title.slice(0, 80) });
    emit({ type: "stage", key: "fetch", text: "Ouverture du site", status: "fait" });

    emit({ type: "stage", key: "pages", text: "Analyse des pages (" + MAX_PAGES + " max)", status: "en cours" });

    // niveau 1 : les liens de navigation de la page d'accueil
    let candidats = liensInternes(html, url, MAX_PAGES - 1, true);
    if (candidats.length < 3) candidats = candidats.concat(liensInternes(html, url, MAX_PAGES - 1, false));
    candidats = [...new Set(candidats.map((u) => u.replace(/\/$/, "")))].slice(0, MAX_PAGES - 1).map((u) => u + (u.endsWith("/") ? "" : ""));
    const echantillon = [url].concat(candidats.filter((u) => u.replace(/\/$/, "") !== url.replace(/\/$/, "")));
    emit({ type: "log", text: "Échantillon retenu : " + echantillon.map((u, i) => (i + 1) + ". " + u).join(" , ") });

    // niveau 2 : les liens du premier sous-page pour compléter l'échantillon
    if (echantillon.length < MAX_PAGES && echantillon.length >= 2) {
      try {
        const h2 = await recupererPage(echantillon[1], emit);
        const plus = liensInternes(h2, echantillon[1], MAX_PAGES - echantillon.length, false)
          .filter((u) => !echantillon.some((x) => x.replace(/\/$/, "") === u.replace(/\/$/, "")));
        for (const u of plus) {
          if (echantillon.length >= MAX_PAGES) break;
          echantillon.push(u);
        }
        if (plus.length) emit({ type: "log", text: "Échantillon élargi avec les liens internes du sous-page : +" + plus.length + " page(s)." });
      } catch (e) { /* le sous-page est resté fermé, on garde l'échantillon */ }
    }

    // audit des pages : trois au plus en même temps (les relais sont limités)
    const pages = await reservoir(echantillon, 3, async (u, i) => {
      emit({ type: "log", text: "Page " + (i + 1) + "/" + echantillon.length + " : " + u });
      try {
        const h = await recupererPage(u, emit);
        const r = await auditPage(h, u);
        if (r.error) emit({ type: "log", text: "Page ignorée : " + r.error });
        return r;
      } catch (e) {
        const msg = String(e.message || e).slice(0, 90);
        emit({ type: "log", text: "Page ignorée : " + msg });
        return { url: u, error: msg };
      }
    });

    emit({ type: "stage", key: "pages", text: "Analyse des pages", status: "fait" });
    emit({ type: "stage", key: "verdict", text: "Calcul des verdicts RGAA", status: "en cours" });
    await new Promise((r) => setTimeout(r, 60));

    const v = verdicts(pages);
    emit({ type: "stage", key: "verdict", text: "Calcul des verdicts RGAA", status: "fait" });
    const ignorees = pages.filter((p) => p.error).length;
    if (ignorees) emit({ type: "log", text: ignorees + " page(s) non accessible(s) : le site ou le relais a refusé. Elles sont listées dans le rapport." });

    const okPages = pages.filter((p) => !p.error);
    const meta = {
      site: new URL(url).hostname,
      url: okPages.length ? okPages[0].url : url,
      title: okPages.length ? okPages[0].title : title,
      date: new Date().toLocaleDateString("fr-FR"),
      mode: "navigateur (relais public)",
      stats: {
        imgs: okPages.reduce((s, p) => s + (p.imgs || []).length, 0),
        links: okPages.reduce((s, p) => s + (p.links || []).length, 0),
        svgs: okPages.reduce((s, p) => s + (p.svgs || []).length, 0),
        texts: okPages.reduce((s, p) => s + ((p.contrast && p.contrast.checked) || 0), 0),
      },
      duration: Math.round((Date.now() - t0) / 1000),
    };
    const res = {
      meta: meta,
      pages: okPages.map((p) => p.url),
      ignored: pages.filter((p) => p.error).map((p) => p.url),
      tests: v.tests,
      scores: scores(v.tests),
      precos: [], plan: [], manual: [],
    };
    res.precos = precos(v.tests, { pages: res.pages });
    res.plan = plan(res.precos);
    res.manual = pointsManuels(v.tests);
    res.verdict_label = resumeVerdict(res);
    res.taux_txt = { global: pctTxt(res.scores.global), mean: pctTxt(res.scores.mean) };
    res.mode_audit = "navigateur";
    return res;
  }

  window.Conforme = { auditer: auditer, exportable: true };
})();
