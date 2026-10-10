# -*- coding: utf-8 -*-
"""Moteur d'audit RGAA 4.1.2 (critères 1.1, 3.2, 6.1).

Deux modes :
- navigateur (Playwright + Chromium) : DOM rendu, styles calculés, contrastes mesurés ;
- statique (requests + lxml) : repli si le navigateur est indisponible.

Chaque test RGAA reçoit un verdict : Conforme, Non conforme, Non testé ou Non applicable,
avec des exemples précis (page, élément) et une préconisation en français simple.
"""
import re
import time
from datetime import date
from urllib.parse import urljoin, urlparse

try:
    import requests
except ImportError:
    requests = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

MAX_PAGES = 5
TIMEOUT = 15000

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
}

VAGUE = {
    "en savoir plus", "lire la suite", "voir plus", "voir tout", "tout voir", "cliquez ici",
    "cliquer ici", "ici", "plus", "détails", "en détail", "découvrir", "je découvre",
    "c'est parti", "cest parti", "je réserve", "je reserve", "en savoir davantage",
    "continuer", "suivant", "précédent", "ouvrir", "afficher plus", "voir l'article",
    "lire l'article", "aller", "voir", "consulter", "télécharger", "envoyer", "go", "ok",
    "read more", "learn more", "click here", "more", "see more", "view all", "see all",
    "details", "download", "submit", "next", "previous", "open", "show more",
    "arrow", "chevron", "suiv", "prec",
}

SKIP_EXT = re.compile(r"\.(jpg|jpeg|png|webp|avif|gif|svg|css|js|json|xml|txt|pdf|zip|ico|mp4|mp3|webm|woff2?|ttf)($|\?)", re.I)

BROWSER_ARGS = ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"]

STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.chrome = window.chrome || {runtime: {}, loadTimes: () => ({}), csi: () => ({})};
Object.defineProperty(navigator, 'languages', {get: () => ['fr-FR', 'fr', 'en-US', 'en']});
Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});
"""

CHALLENGE_TITLE = re.compile(r"(captcha|datadome|are you a human|attention requise|vérification|just a moment|access denied|accès refusé)", re.I)


class BlockedSite(Exception):
    pass

FILE_ALT = re.compile(r"(\.(jpg|jpeg|png|webp|avif|gif|svg)$|^dsc[_ -]|^img[_ -]|^photo[_ -]|^image[_ -])", re.I)
MOT_OUTIL = re.compile(r"\b(le|la|les|de|du|des|un|une|et|à|a|au|aux|en|sur|avec|dans|pour|par|the|of|on|in|at|and|with)\b", re.I)


def norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def norm_label(s):
    s = (s or "").casefold()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class Stage:
    """Petit générateur d'événements pour le journal d'audit en direct."""

    def __init__(self):
        self.events = []

    def log(self, text):
        self.events.append({"type": "log", "text": text})

    def stage(self, key, text, status="en cours"):
        self.events.append({"type": "stage", "key": key, "text": text, "status": status})


# ----------------------------------------------------------------- fetch statique

def fetch_static(url):
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    return r.text, r.url


# ----------------------------------------------------------------- analyse DOM (navigateur)

JS_CLOSE_CONSENT = """
(() => {
  const btns = [...document.querySelectorAll('button, a, [role="button"]')];
  const pat = /(continuer sans accepter|tout refuser|refuser tout|refuser les cookies|reject all|continue without|deny all)/i;
  for (const b of btns) {
    const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
    if (pat.test(t) && b.offsetParent !== null) { try { b.click(); return t; } catch (e) {} }
  }
  return null;
})();
"""

JS_PAGE_DATA = """
(() => {
  const out = { url: location.href, title: document.title };
  const vis = (el) => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const nameOf = (a) => {
    if (!a) return '';
    const lbl = a.getAttribute('aria-labelledby');
    if (lbl) {
      let t = '';
      for (const id of lbl.split(/\\s+/)) { const el = document.getElementById(id); if (el) t += ' ' + el.textContent; }
      if (t.trim()) return t.replace(/\\s+/g, ' ').trim();
    }
    if ((a.getAttribute('aria-label') || '').trim()) return a.getAttribute('aria-label').replace(/\\s+/g, ' ').trim();
    let t = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) { t += ' ' + node.textContent; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (node.getAttribute('aria-hidden') === 'true') return;
      if (tag === 'img') { const alt = node.getAttribute('alt'); if (alt) t += ' ' + alt; return; }
      if (tag === 'svg') {
        const al = node.getAttribute('aria-label') || (node.querySelector(':scope > title') ? node.querySelector(':scope > title').textContent : '');
        if (al) { t += ' ' + al; return; }
        if (node.getAttribute('role') === 'img') return;
      }
      for (const c of node.childNodes) walk(c);
    };
    for (const c of a.childNodes) walk(c);
    if (!t.trim() && (a.getAttribute('title') || '').trim()) return a.getAttribute('title').replace(/\\s+/g, ' ').trim();
    return t.replace(/\\s+/g, ' ').trim();
  };
  const headingContext = (a) => {
    let anc = a.closest('article, section, li, td, th, main');
    let cur = a;
    while (anc) {
      const hs = [...anc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      let best = null;
      for (const h of hs) {
        const pos = h.compareDocumentPosition(a);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      }
      if (best) return best.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90);
      cur = anc;
      const p = anc.parentElement && anc.parentElement.closest('article, section, li, main');
      if (!p) break;
      anc = p;
    }
    return '';
  };
  // images
  out.imgs = [...document.querySelectorAll('img')].map(i => {
    const link = i.closest('a[href]');
    return {
      src: (i.currentSrc || i.src || '').slice(0, 140),
      alt: i.hasAttribute('alt') ? i.getAttribute('alt') : null,
      inLink: !!link,
      visible: vis(i),
      linkName: link ? nameOf(link).slice(0, 100) : ''
    };
  });
  out.area = [...document.querySelectorAll('area')].map(a => ({alt: a.getAttribute('alt'), aria: a.getAttribute('aria-label')}));
  out.inputImg = [...document.querySelectorAll('input[type="image"]')].map(i => ({alt: i.getAttribute('alt'), aria: i.getAttribute('aria-label'), title: i.getAttribute('title')}));
  out.ismap = [...document.querySelectorAll('img[ismap]')].length;
  out.objects = [...document.querySelectorAll('object')].map(o => ({type: o.getAttribute('type') || '', role: o.getAttribute('role'), aria: o.getAttribute('aria-label'), title: o.getAttribute('title')}));
  out.embeds = [...document.querySelectorAll('embed')].map(o => ({type: o.getAttribute('type') || '', role: o.getAttribute('role'), aria: o.getAttribute('aria-label'), title: o.getAttribute('title')}));
  out.canvases = [...document.querySelectorAll('canvas')].map(c => ({role: c.getAttribute('role'), aria: c.getAttribute('aria-label'), labelledby: c.getAttribute('aria-labelledby'), content: (c.textContent || '').trim().slice(0, 60)}));
  // svg
  out.svgs = [...document.querySelectorAll('svg')].map(s => ({
    role: s.getAttribute('role'),
    hidden: s.getAttribute('aria-hidden'),
    aria: s.getAttribute('aria-label'),
    labelledby: s.getAttribute('aria-labelledby'),
    hasTitle: !!s.querySelector(':scope > title'),
    inLink: !!s.closest('a[href]'),
    visible: vis(s),
    text: (s.textContent || '').trim().slice(0, 40)
  }));
  // liens
  out.links = [...document.querySelectorAll('a[href]')].map(a => {
    const ar = a.getBoundingClientRect();
    const visL = (getComputedStyle(a).display !== 'none' && getComputedStyle(a).visibility !== 'hidden' && ar.width > 1 && ar.height > 1);
    const imgs = [...a.querySelectorAll('img')];
    const svgs = [...a.querySelectorAll('svg')];
    return {
      href: (a.getAttribute('href') || '').slice(0, 160),
      aria: a.getAttribute('aria-label'),
      title: a.getAttribute('title'),
      text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
      name: nameOf(a).slice(0, 120),
      visible: visL,
      imgAlt: imgs.filter(i => i.getAttribute('alt')).map(i => i.getAttribute('alt').slice(0, 60)).join(' | ').slice(0, 80),
      imgEmptyAlt: imgs.some(i => i.getAttribute('alt') === ''),
      svgHidden: svgs.length > 0 && svgs.every(s => s.getAttribute('aria-hidden') === 'true'),
      svgAria: svgs.map(s => s.getAttribute('aria-label')).filter(Boolean).join(' | ').slice(0, 80),
      svgRoleImg: svgs.some(s => s.getAttribute('role') === 'img'),
      ctx: headingContext(a),
      inNav: !!a.closest('nav, header')
    };
  });
  // contrastes : texte visible sur fond calculé
  const lum = (r, g, b) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = (c) => { const m = c.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/); if (!m) return null; return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]; };
  const ratio = (a, b) => { const l1 = lum(a[0], a[1], a[2]), l2 = lum(b[0], b[1], b[2]); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const effBg = (el) => {
    const couches = [];
    let e = el;
    while (e && e !== document.documentElement) {
      const st = getComputedStyle(e);
      const c = parse(st.backgroundColor);
      if (st.backgroundImage && st.backgroundImage !== 'none') {
        const arrets = [...st.backgroundImage.matchAll(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/g)].map((m) => ([+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]));
        if (arrets.length) {
          const pire = arrets.reduce((a, b) => (b[3] > a[3] ? b : a));
          couches.push(pire);
        } else {
          return {bg: null, overImage: true};
        }
      }
      if (c && c[3] > 0.9) { e = null; break; }
      if (c && c[3] > 0) couches.push(c);
      e = e.parentElement;
    }
    let base = e === null ? null : [255, 255, 255];
    for (let i = couches.length - 1; i >= 0; i--) {
      const L = couches[i];
      base = [0, 1, 2].map((k) => Math.round(base[k] * (1 - L[3]) + L[k] * L[3]));
    }
    return {bg: base, overImage: false};
  };
  out.contrast = { checked: 0, fails: [], unsure: [], pairs: {} };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while (n = walker.nextNode()) {
    const t = n.textContent.trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const fg = parse(st.color);
    if (!fg) continue;
    const eff = effBg(el);
    if (eff.overImage) {
      out.contrast.unsure.push({text: t.slice(0, 50), detail: 'texte posé sur une image, à vérifier à la main', color: st.color});
      if (out.contrast.unsure.length >= 12) continue;
      continue;
    }
    const cr = ratio(fg, eff.bg);
    out.contrast.checked++;
    const size = parseFloat(st.fontSize);
    const bold = parseInt(st.fontWeight) >= 700;
    const th = (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
    const key = st.color + ' -> ' + (eff.bg ? eff.bg.join(',') : '');
    out.contrast.pairs[key] = (out.contrast.pairs[key] || 0) + 1;
    if (cr < th) {
      out.contrast.fails.push({text: t.slice(0, 50), color: st.color, bg: eff.bg ? ('rgb(' + eff.bg.slice(0, 3).join(',') + ')') : '', ratio: Math.round(cr * 100) / 100, needed: th, size: Math.round(size), bold});
    }
  }
  out.contrast.fails = out.contrast.fails.slice(0, 15);
  out.contrast.unsure = out.contrast.unsure.slice(0, 8);
  // mécanisme de contraste ?
  const all = document.body.innerText.slice(0, 6000).toLowerCase();
  out.contrastMechanism = /(fort contraste|contraste élevé|contraste renforcé|high contrast|augmenter le contraste)/.test(all);
  // titres pour contexte
  out.h1 = [...document.querySelectorAll('h1')].map(h => h.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80));
  return out;
})();
"""


def analysis_js_error(err, page_url):
    return {"type": "error", "page": page_url, "message": str(err)[:300]}


# ----------------------------------------------------------------- moteur principal

class Engine:
    def __init__(self, emitter):
        self.emit = emitter

    # ---- crawl
    def same_origin_links(self, html, base_url, limit=8):
        soup = BeautifulSoup(html or "", "lxml") if BeautifulSoup else None
        if not soup:
            return []
        origin = urlparse(base_url).netloc
        found = []
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            if SKIP_EXT.search(href):
                continue
            absu = urljoin(base_url, href)
            p = urlparse(absu)
            if p.netloc != origin or p.scheme not in ("http", "https"):
                continue
            key = p.path.rstrip("/") or "/"
            if any(key == f[0] for f in found):
                continue
            in_nav = bool(a.find_parent(["nav", "header"]))
            found.append((key, absu, in_nav))
        nav = [f for f in found if f[2]]
        other = [f for f in found if not f[2]]
        picked, seen = [], set()
        for _, u, _ in (nav + other):
            pu = urlparse(u)
            k = (pu.path.rstrip("/") or "/") + (("?" + pu.query) if pu.query else "")
            if k in seen:
                continue
            seen.add(k)
            picked.append(u)
            if len(picked) >= limit:
                break
        return picked

    def collect_pages(self, ctx, url):
        """Échantillon : la page demandée + jusqu'à 4 pages internes, prises dans le DOM rendu."""
        pages = [url]
        probe = ctx.new_page()
        probe.set_default_timeout(TIMEOUT)
        try:
            self.open_patient(probe, url)
            html = probe.content()
            final = probe.url
            for u in self.same_origin_links(html, final):
                if len(pages) >= MAX_PAGES:
                    break
                if u.rstrip("/") != url.rstrip("/"):
                    pages.append(u)
        except BlockedSite:
            probe.close()
            raise
        except Exception as e:
            self.emit({"type": "log", "text": "Recherche des pages internes limitée (" + str(e)[:60] + "), audit de la page seule."})
        probe.close()
        self.emit({"type": "log", "text": "Échantillon retenu : " + " , ".join(str(i + 1) + ". " + u for i, u in enumerate(pages))})
        return pages

    def open_patient(self, page, url):
        """Ouvre la page et attend la fin d'un éventuel défi anti-robot."""
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT)
        except Exception as e:
            raise BlockedSite("la page n'a pas répondu : " + str(e)[:100])
        deadline = time.time() + 14
        reloaded = False
        while True:
            page.wait_for_timeout(1800)
            if not self.looks_challenged(page):
                return
            if time.time() > deadline:
                break
            if not reloaded:
                try:
                    page.reload(wait_until="domcontentloaded", timeout=TIMEOUT)
                except Exception:
                    pass
                reloaded = True
        raise BlockedSite("le site présente une page de vérification anti-robot")

    def looks_challenged(self, page):
        try:
            info = page.evaluate("({t: document.title, n: document.body ? document.body.innerText.trim().length : 0, u: location.href})")
        except Exception:
            return True
        title = (info.get("t") or "").strip()
        if CHALLENGE_TITLE.search(title):
            return True
        # page quasi vide dont le titre n'est que le nom de domaine : défi typique
        origin = urlparse(page.url).netloc.replace("www.", "")
        if info.get("n", 0) < 350 and title.replace("www.", "") in (origin, origin + " :", origin + ":"):
            return True
        return info.get("n", 0) < 40

    # ---- analyse d'une page
    def analyze_page(self, ctx, url):
        page = ctx.new_page()
        page.set_default_timeout(TIMEOUT)
        try:
            self.open_patient(page, url)
        except BlockedSite as e:
            page.close()
            return {"url": url, "error": str(e)}
        except Exception as e:
            page.close()
            return {"url": url, "error": "chargement impossible : " + str(e)[:120]}
        page.wait_for_timeout(1600)
        try:
            closed = page.evaluate(JS_CLOSE_CONSENT)
            if closed:
                page.wait_for_timeout(900)
        except Exception:
            pass
        try:
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(1400)
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(500)
        except Exception:
            pass
        try:
            data = page.evaluate(JS_PAGE_DATA)
        except Exception as e:
            page.close()
            return {"url": url, "error": "analyse impossible : " + str(e)[:120]}
        page.close()
        data["error"] = None
        return data

    # ---- verdicts
    def build(self, url):
        t0 = time.time()
        results = {"criterion": {}, "pages": [], "meta": {}}
        self.emit({"type": "stage", "key": "fetch", "text": "Ouverture du site", "status": "en cours"})
        self.emit({"type": "log", "text": "Ouverture de " + url})

        pages = []
        mode = None
        pw = None
        ctx = None
        if sync_playwright:
            try:
                pw = sync_playwright().start()
                browser = None
                for kwargs in ({"channel": "chrome"}, {}):
                    try:
                        browser = pw.chromium.launch(headless=True, args=BROWSER_ARGS, **kwargs)
                        break
                    except Exception:
                        continue
                if browser is None:
                    raise RuntimeError("chromium indisponible")
                ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 900}, locale="fr-FR")
                ctx.add_init_script(STEALTH_JS)
                try:
                    pages = self.collect_pages(ctx, url)
                except BlockedSite:
                    msg = ("Ce site refuse les visites automatiques : une page de vérification anti-robot "
                           "s'affiche au lieu du site. L'audit ne peut pas ouvrir le site réel depuis cet outil. "
                           "Essayez une autre adresse, ou refaites l'audit à la main avec les outils d'assistance.")
                    self.emit({"type": "error", "message": msg})
                    try:
                        ctx.close()
                        pw.stop()
                    except Exception:
                        pass
                    return None
                mode = "navigateur"
                self.emit({"type": "log", "text": "Site ouvert dans un navigateur d'analyse."})
            except BlockedSite:
                pass
            except Exception as e:
                self.emit({"type": "log", "text": "Le navigateur d'analyse est indisponible (" + str(e)[:80] + ")"})
                pw = None
                ctx = None
        if ctx is None and requests and BeautifulSoup:
            try:
                html, final = fetch_static(url)
                mode = "statique"
                self.emit({"type": "log", "text": "Analyse en mode statique (code HTML brut)."})
                pages = [final] + [u for u in self.same_origin_links(html, final) if u.rstrip("/") != final.rstrip("/")][: MAX_PAGES - 1]
            except Exception as e:
                msg = "Ce site n'a pas pu être ouvert. Vérifiez l'adresse. Il protège peut être ses pages contre les visites automatiques."
                if "403" in str(e) or "429" in str(e):
                    msg += " Le serveur a répondu un refus (code " + str(e)[:3] + ")."
                self.emit({"type": "error", "message": msg})
                return None

        if not pages:
            self.emit({"type": "error", "message": "Aucune page accessible."})
            return None

        self.emit({"type": "stage", "key": "fetch", "text": "Ouverture du site", "status": "fait"})

        stats = {
            "imgs": 0, "links": 0, "svgs": 0, "texts": 0,
        }
        self.emit({"type": "stage", "key": "pages", "text": "Analyse des pages (" + str(len(pages)) + ")", "status": "en cours"})

        page_results = []
        for i, u in enumerate(pages):
            self.emit({"type": "log", "text": "Page " + str(i + 1) + "/" + str(len(pages)) + " : " + u})
            if mode == "navigateur":
                d = self.analyze_page(ctx, u)
            else:
                d = self.analyze_static(u)
            page_results.append(d)
            if d.get("error"):
                self.emit({"type": "log", "text": "Page ignorée : " + d["error"]})
            else:
                stats["imgs"] += len(d.get("imgs", []))
                stats["links"] += len(d.get("links", []))
                stats["svgs"] += len(d.get("svgs", []))
                stats["texts"] += d.get("contrast", {}).get("checked", 0)

        self.emit({"type": "stage", "key": "pages", "text": "Analyse des pages", "status": "fait"})
        self.emit({"type": "stage", "key": "verdict", "text": "Calcul des verdicts RGAA", "status": "en cours"})

        verdicts = self.verdicts(page_results, mode)
        self.emit({"type": "stage", "key": "verdict", "text": "Calcul des verdicts RGAA", "status": "fait"})

        ok_pages = [p for p in page_results if not p.get("error")]
        meta = {
            "site": urlparse(url).netloc,
            "url": ok_pages[0]["url"] if ok_pages else url,
            "title": ok_pages[0].get("title", "") if ok_pages else "",
            "date": date.today().strftime("%d/%m/%Y"),
            "mode": mode,
            "stats": stats,
            "duration": round(time.time() - t0),
        }
        results["meta"] = meta
        results["pages"] = [p["url"] for p in ok_pages]
        results["ignored"] = [p["url"] for p in page_results if p.get("error")]
        results["tests"] = verdicts["tests"]
        results["scores"] = self.scores(verdicts["tests"])
        results["precos"] = self.precos(verdicts["tests"], meta)
        results["plan"] = self.plan(results["precos"])
        results["manual"] = self.manual_points(verdicts["tests"])

        if pw:
            try:
                ctx.close()
                pw.stop()
            except Exception:
                pass
        return results

    def analyze_static(self, url):
        try:
            html, final = fetch_static(url)
        except Exception as e:
            return {"url": url, "error": "chargement impossible : " + str(e)[:120]}
        soup = BeautifulSoup(html, "lxml") if BeautifulSoup else None
        if not soup:
            return {"url": url, "error": "parsing impossible"}
        d = {"url": final, "title": (soup.title.string or "").strip() if soup.title else "", "error": None}
        d["imgs"] = [{"src": i.get("src", "")[:140], "alt": (None if not i.has_attr("alt") else i.get("alt")), "inLink": bool(i.find_parent("a")), "visible": True, "linkName": None} for i in soup.find_all("img")]
        d["area"] = [{"alt": a.get("alt"), "aria": a.get("aria-label")} for a in soup.find_all("area")]
        d["inputImg"] = [{"alt": i.get("alt"), "aria": i.get("aria-label"), "title": i.get("title")} for i in soup.find_all("input", attrs={"type": "image"})]
        d["ismap"] = len(soup.find_all("img", ismap=True))
        d["objects"] = [{"type": o.get("type") or "", "role": o.get("role"), "aria": o.get("aria-label"), "title": o.get("title")} for o in soup.find_all("object")]
        d["embeds"] = [{"type": e.get("type") or "", "role": e.get("role"), "aria": e.get("aria-label"), "title": e.get("title")} for e in soup.find_all("embed")]
        d["canvases"] = [{"role": c.get("role"), "aria": c.get("aria-label"), "labelledby": c.get("aria-labelledby"), "content": (c.get_text() or "").strip()[:60]} for c in soup.find_all("canvas")]
        d["svgs"] = [{"role": s.get("role"), "hidden": s.get("aria-hidden"), "aria": s.get("aria-label"), "labelledby": s.get("aria-labelledby"), "hasTitle": bool(s.find("title", recursive=False)), "inLink": bool(s.find_parent("a")), "visible": True, "text": (s.get_text() or "").strip()[:40]} for s in soup.find_all("svg")]

        def name_of(a):
            if a.get("aria-labelledby"):
                parts = []
                for idr in a["aria-labelledby"].split():
                    el = soup.find(id=idr)
                    if el:
                        parts.append(el.get_text(" "))
                if " ".join(parts).strip():
                    return norm(" ".join(parts))
            if (a.get("aria-label") or "").strip():
                return norm(a["aria-label"])
            txt = a.get_text(" ")
            for im in a.find_all("img"):
                if im.get("alt"):
                    txt += " " + im["alt"]
            for sv in a.find_all("svg"):
                if sv.get("aria-hidden") == "true":
                    continue
                sal = sv.get("aria-label") or (sv.find("title") and sv.find("title").get_text())
                if sal:
                    txt += " " + sal
            if not norm(txt) and (a.get("title") or "").strip():
                return norm(a["title"])
            return norm(txt)

        def ctx_of(a):
            anc = a.find_parent(["article", "section", "li", "td", "th", "main"])
            while anc:
                hs = anc.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
                if hs:
                    return norm(hs[-1].get_text(" "))[:90]
                anc = anc.find_parent(["article", "section", "li", "main"])
            return ""

        d["links"] = [{"href": a.get("href", "")[:160], "aria": a.get("aria-label"), "title": a.get("title"),
                       "text": norm(a.get_text(" "))[:100], "name": name_of(a)[:120], "visible": True,
                       "imgAlt": " | ".join([im["alt"] for im in a.find_all("img") if im.get("alt")])[:80],
                       "imgEmptyAlt": any(im.get("alt") == "" for im in a.find_all("img")),
                       "svgHidden": bool(a.find_all("svg")) and all(s.get("aria-hidden") == "true" for s in a.find_all("svg")),
                       "svgAria": " | ".join([s["aria-label"] for s in a.find_all("svg") if s.get("aria-label")])[:80],
                       "svgRoleImg": any(s.get("role") == "img" for s in a.find_all("svg")),
                       "ctx": ctx_of(a), "inNav": bool(a.find_parent(["nav", "header"]))} for a in soup.find_all("a", href=True)]
        d["contrast"] = {"checked": 0, "fails": [], "unsure": [], "pairs": {}}
        d["contrastMechanism"] = False
        d["h1"] = [norm(h.get_text(" "))[:80] for h in soup.find_all("h1")]
        return d

    # ---------------- verdicts par test
    def verdicts(self, pages, mode):
        tests = []
        ok_pages = [p for p in pages if not p.get("error")]

        def evidence(page_url, detail):
            return {"page": page_url, "detail": detail}

        def add(tid, crit, theme, title, verify, fails, unsures, applicable_pages, reco, comment=""):
            if not applicable_pages:
                verdict = "Non applicable"
            elif fails:
                verdict = "Non conforme"
            elif unsures:
                verdict = "Non testé"
            else:
                verdict = "Conforme"
            ok_count = max(0, len(applicable_pages) - len(fails) - len(unsures))
            tests.append({
                "id": tid, "criterion": crit, "theme": theme, "title": title, "verify": verify,
                "verdict": verdict,
                "counts": {"ok": ok_count, "ko": len(fails), "unsure": len(unsures)},
                "pages": sorted(set(applicable_pages)),
                "examples": fails[:6], "unsure": unsures[:6],
                "reco": reco, "comment": comment,
            })

        # ---- 1.1
        f111, u111, app111 = [], [], []
        img_total = 0
        for p in ok_pages:
            img_total += len(p.get("imgs", []))
            for im in p.get("imgs", []):
                if not im.get("visible"):
                    continue
                u = p["url"]
                src = (im.get("src") or "").split("?")[0].split("/")[-1][:40]
                app111.append(u)
                if im["alt"] is None:
                    f111.append(evidence(u, "image sans attribut alt (fichier " + src + ")"))
                elif im["alt"].strip() == "":
                    if im.get("inLink") and not (im.get("linkName") or "").strip():
                        f111.append(evidence(u, "image dans un lien sans nom accessible (fichier " + src + ") : le lien est muet"))
                    # alt vide dans un lien nommé : image décorative, cas conforme
                elif FILE_ALT.search(im["alt"]):
                    f111.append(evidence(u, "alt inutile : reprend le nom du fichier (\"" + im["alt"][:50] + "\")"))
                elif len(im["alt"]) > 150:
                    u111.append(evidence(u, "alt très long (" + str(len(im["alt"])) + " caractères), à relire : \"" + im["alt"][:60] + "...\""))
                elif len(im["alt"].split()) >= 6 and not MOT_OUTIL.search(im["alt"]):
                    u111.append(evidence(u, "alt en liste de mots clés plutôt qu'en phrase : \"" + im["alt"][:60] + "\""))
        add("1.1.1", "1.1", "1.1 Images", "Chaque image porteuse d'information a-t-elle une alternative textuelle ?",
            "Pour chaque image informative, vérifier qu'elle a un attribut alt (ou aria-label, aria-labelledby, title) qui décrit vraiment l'information.",
            f111, u111, app111,
            "Ajouter un attribut alt court et utile à chaque image informative. Garder alt=\"\" pour les images de décoration. Corriger d'abord les images sans alt du tout.",
            comment=str(img_total) + " images examinées.")

        # 1.1.2 area
        f112, app112 = [], []
        for p in ok_pages:
            for a in p.get("area", []):
                app112.append(p["url"])
                if not (a.get("alt") or "").strip() and not (a.get("aria") or "").strip():
                    f112.append(evidence(p["url"], "zone réactive (balise area) sans alt ni aria-label"))
        add("1.1.2", "1.1", "1.1 Images", "Chaque zone d'une image réactive (balise area) porteuse d'information a-t-elle une alternative textuelle ?",
            "Vérifier la présence d'un attribut alt ou aria-label sur chaque balise area.",
            f112, [], app112, "Ajouter un alt qui décrit la zone réactive.", comment=str(len(app112)) + " zones réactives trouvées.")

        # 1.1.3
        f113, app113 = [], []
        for p in ok_pages:
            for b in p.get("inputImg", []):
                app113.append(p["url"])
                if not any([b.get("alt"), b.get("aria"), b.get("title")]):
                    f113.append(evidence(p["url"], "bouton de type image sans alternative textuelle"))
        add("1.1.3", "1.1", "1.1 Images", "Chaque bouton de type image (input type=\"image\") a-t-il une alternative textuelle ?",
            "Vérifier la présence d'une alternative (alt, aria-label, aria-labelledby ou title).",
            f113, [], app113, "Ajouter un alt qui décrit l'action du bouton.", comment=str(len(app113)) + " boutons image trouvés.")

        # 1.1.4
        f114, app114 = [], []
        for p in ok_pages:
            if p.get("ismap"):
                app114.append(p["url"])
                f114.append(evidence(p["url"], "image réactive côté serveur (ismap) : vérifier un autre accès aux mêmes destinations"))
        add("1.1.4", "1.1", "1.1 Images", "Chaque zone cliquable d'une image réactive côté serveur est-elle doublée d'un autre accès à la même destination ?",
            "Vérifier qu'un lien ou un autre composant permet d'accéder aux mêmes ressources que l'image réactive.",
            f114, [], app114, "Doubler l'image ismap de liens textes vers les mêmes destinations.",
            comment=str(len(app114)) + " images ismap trouvées.")

        # 1.1.5 svg
        f115, u115, app115 = [], [], []
        svg_total = 0
        for p in ok_pages:
            for s in p.get("svgs", []):
                if not s.get("visible"):
                    continue
                svg_total += 1
                u = p["url"]
                if s.get("hidden") == "true":
                    continue
                if s.get("role") == "img":
                    app115.append(u)
                    if not (s.get("aria") or s.get("labelledby") or s.get("hasTitle")):
                        f115.append(evidence(u, "svg avec role=\"img\" mais sans alternative (aria-label, aria-labelledby ou title)"))
                elif s.get("aria") or s.get("hasTitle"):
                    app115.append(u)
                elif (s.get("text") or "").strip():
                    u115.append(evidence(u, "svg porteur de texte sans role=\"img\" ni alternative, à vérifier"))
        add("1.1.5", "1.1", "1.1 Images", "Chaque image vectorielle (balise svg) porteuse d'information a-t-elle role=\"img\" et une alternative ?",
            "Vérifier que les svg informatifs portent role=\"img\" et une alternative (title, aria-label ou aria-labelledby).",
            f115, u115, app115,
            "Donner role=\"img\" et une alternative aux svg informatifs ; masquer les svg décoratifs avec aria-hidden=\"true\".",
            comment=str(svg_total) + " svg examinés, dont " + str(len(app115)) + " informatifs.")

        # 1.1.6 / 1.1.7 / 1.1.8
        f116, app116 = [], []
        for p in ok_pages:
            for o in p.get("objects", []):
                if (o.get("type") or "").startswith("image"):
                    app116.append(p["url"])
                    if not (o.get("role") == "img" and (o.get("aria") or o.get("title"))):
                        f116.append(evidence(p["url"], "image objet (balise object) sans role=\"img\" ni alternative"))
        add("1.1.6", "1.1", "1.1 Images", "Chaque image objet (balise object avec type=\"image/…\") porteuse d'information a-t-elle une alternative ?",
            "Vérifier role=\"img\" et une alternative, ou un accès à un contenu alternatif.",
            f116, [], app116, "Remplacer si possible l'object par une img avec alt, sinon ajouter role=\"img\" et l'alternative.",
            comment=str(len(app116)) + " images objet trouvées.")

        f117, app117 = [], []
        for p in ok_pages:
            for o in p.get("embeds", []):
                if (o.get("type") or "").startswith("image"):
                    app117.append(p["url"])
                    if not (o.get("role") == "img" and (o.get("aria") or o.get("title"))):
                        f117.append(evidence(p["url"], "image embarquée (balise embed) sans role=\"img\" ni alternative"))
        add("1.1.7", "1.1", "1.1 Images", "Chaque image embarquée (balise embed avec type=\"image/…\") porteuse d'information a-t-elle une alternative ?",
            "Vérifier role=\"img\" et une alternative, ou un accès à un contenu alternatif.",
            f117, [], app117, "Remplacer si possible l'embed par une img avec alt, sinon ajouter role=\"img\" et l'alternative.",
            comment=str(len(app117)) + " images embarquées trouvées.")

        f118, app118 = [], []
        for p in ok_pages:
            for c in p.get("canvases", []):
                app118.append(p["url"])
                named = c.get("role") == "img" and (c.get("aria") or c.get("labelledby"))
                if not (named or c.get("content")):
                    f118.append(evidence(p["url"], "canvas sans alternative (pas d'aria, pas de contenu de repli)"))
        add("1.1.8", "1.1", "1.1 Images", "Chaque image bitmap (balise canvas) porteuse d'information a-t-elle une alternative ?",
            "Vérifier role=\"img\" et une alternative, un contenu de repli entre les balises, ou un mécanisme de remplacement.",
            f118, [], app118, "Fournir un contenu de repli entre les balises canvas ou un mécanisme de remplacement.",
            comment=str(len(app118)) + " canvas trouvés.")

        # ---- 3.2 contrastes
        ctr_checked = sum(p.get("contrast", {}).get("checked", 0) for p in ok_pages)
        all_fails = []
        for p in ok_pages:
            for f in p.get("contrast", {}).get("fails", []):
                all_fails.append(evidence(p["url"], "\"" + f["text"] + "\" en " + str(f["size"]) + " px (" + ("gras" if f.get("bold") else "sans graisse") + ") : contraste " + str(f["ratio"]).replace(".", ",") + ":1 au lieu de " + str(f["needed"]) + ":1 (" + f["color"] + " sur " + f["bg"] + ")"))
        unsure_all = []
        for p in ok_pages:
            for s in p.get("contrast", {}).get("unsure", []):
                unsure_all.append(evidence(p["url"], "\"" + s["text"] + "\" : " + s["detail"]))
        if mode != "navigateur":
            for p in ok_pages:
                unsure_all.append(evidence(p["url"], "contrastes non mesurables en mode statique (les styles ne sont pas calculés), à contrôler à la main"))

        self._add_32(tests, add, ok_pages, ctr_checked, all_fails, unsure_all, mode)

        # ---- 6.1
        self._add_61(tests, add, ok_pages, evidence)

        for t in tests:
            if t["verdict"] == "Conforme" and not t["counts"]["ok"] and t["counts"]["unsure"] == 0:
                t["counts"]["ok"] = 1
        return {"tests": tests}

    def _add_32(self, tests, add, ok_pages, checked, fails, unsure, mode):
        # répartir les échecs par tranche de taille/graisse selon les règles 3.2.1 à 3.2.4
        def bucket(f):
            size = f.get("size", 12)
            bold = bool(f.get("bold"))
            if bold and size >= 18.66:
                return "3.2.4"
            if not bold and size >= 24:
                return "3.2.3"
            if bold:
                return "3.2.2"
            return "3.2.1"

        spec = {
            "3.2.1": ("Le texte sans effet de graisse de moins de 24 px a-t-il un contraste d'au moins 4,5:1 ?",
                      "Mesurer le contraste entre la couleur du texte et son fond pour les textes de moins de 24 px sans graisse. Seuil : 4,5:1.",
                      "Rapprocher la couleur du texte ou celle du fond pour dépasser 4,5:1."),
            "3.2.2": ("Le texte en gras de moins de 18,5 px a-t-il un contraste d'au moins 4,5:1 ?",
                      "Même mesure pour les textes en gras de moins de 18,5 px. Seuil : 4,5:1.",
                      "Rapprocher la couleur du texte ou celle du fond pour dépasser 4,5:1."),
            "3.2.3": ("Le texte sans effet de graisse d'au moins 24 px a-t-il un contraste d'au moins 3:1 ?",
                      "Même mesure pour les grands textes de 24 px et plus. Seuil : 3:1.",
                      "Rapprocher la couleur du texte ou celle du fond pour dépasser 3:1."),
            "3.2.4": ("Le texte en gras d'au moins 18,5 px a-t-il un contraste d'au moins 3:1 ?",
                      "Même mesure pour les textes en gras de 18,5 px et plus. Seuil : 3:1.",
                      "Rapprocher la couleur du texte ou celle du fond pour dépasser 3:1."),
        }
        app_pages = [p["url"] for p in ok_pages]
        for tid, (title, verify, reco) in spec.items():
            bf = [f for f in fails if bucket(f) == tid]
            app = app_pages if checked else []
            nbf = len(bf)
            add(tid, "3.2", "3.2 Contrastes", title, verify,
                bf, unsure if not checked else [], app,
                reco,
                comment=("Mesure automatique de " + str(checked) + " textes sur les pages auditées.") if checked else "Contrastes non mesurés (mode statique).")
        # 3.2.5 mécanisme
        mech = any(p.get("contrastMechanism") for p in ok_pages)
        if not mech:
            add("3.2.5", "3.2", "3.2 Contrastes", "Le mécanisme qui permet d'afficher un contraste conforme affiche-t-il bien ce contraste ?",
                "Ce test ne concerne que les sites qui ont un mécanisme d'augmentation du contraste.",
                [], [], [],
                "Aucune action, le test ne s'applique pas.",
                comment="Aucun mécanisme d'augmentation du contraste détecté sur les pages auditées.")
        else:
            add("3.2.5", "3.2", "3.2 Contrastes", "Le mécanisme qui permet d'afficher un contraste conforme affiche-t-il bien ce contraste ?",
                "Un mécanisme d'augmentation du contraste a été détecté. Vérifier à la main le contraste qu'il affiche.",
                [], [evidence(ok_pages[0]["url"], "mécanisme de contraste détecté, contrôle manuel nécessaire")],
                [p["url"] for p in ok_pages], "Vérifier à la main le contraste affiché par le mécanisme.",
                comment="Mécanisme détecté, contrôle manuel nécessaire.")

    def _add_61(self, tests, add, ok_pages, evidence):
        # 6.1.1 liens texte
        f611, u611, app611 = [], [], []
        labels_seen = {}
        for p in ok_pages:
            for L in p.get("links", []):
                if not L.get("visible"):
                    continue
                txt = norm(L.get("text"))
                if not txt:
                    continue  # lien image, traité en 6.1.2 / 6.1.3
                u = p["url"]
                name = norm(L.get("name"))
                if not name:
                    f611.append(evidence(u, "lien texte sans nom accessible (" + L.get("href", "")[:50] + ")"))
                    continue
                app611.append(u)
                low = txt.casefold().strip()
                key = low
                labels_seen.setdefault(key, set()).add((L.get("href") or "").split("?")[0])
                if low in VAGUE or norm_label(txt) in VAGUE:
                    aria = (L.get("aria") or "").strip()
                    if aria and norm_label(aria) != low and len(norm_label(aria)) > len(low):
                        continue  # l'aria-label précise le lien
                    if L.get("ctx") and len(L["ctx"]) > 8:
                        u611.append(evidence(u, "intitulé \"" + txt[:40] + "\" à comprendre avec le contexte \"" + L["ctx"][:60] + "\" : à juger à la main"))
                    else:
                        f611.append(evidence(u, "lien texte peu explicite : \"" + txt[:40] + "\" sans contexte utile"))
        for lab, hrefs in labels_seen.items():
            if lab in VAGUE and len(hrefs) >= 3:
                f611.append(evidence("toutes les pages", "intitulé \"" + lab + "\" répété pour " + str(len(hrefs)) + " destinations différentes"))
        add("6.1.1", "6.1", "6.1 Liens", "Chaque lien texte est-il explicite (intitulé seul ou intitulé plus contexte) ?",
            "Vérifier que l'intitulé (ou l'intitulé plus son contexte) permet de comprendre la fonction et la destination.",
            f611, u611, app611,
            "Préciser la destination dans l'intitulé (exemples : \"Réserver mon billet\", \"Découvrir la carte Avantage Jeune\"). Pour les liens identiques, ajouter le nom de l'offre.",
            comment=str(len(app611)) + " liens texte examinés.")

        # 6.1.2 liens image
        f612, app612 = [], []
        for p in ok_pages:
            for L in p.get("links", []):
                if not L.get("visible"):
                    continue
                has_img = L.get("imgAlt") or L.get("imgEmptyAlt")
                if not has_img:
                    continue
                u = p["url"]
                app612.append(u)
                name = norm(L.get("name"))
                if not name:
                    f612.append(evidence(u, "lien image sans nom accessible (" + L.get("href", "")[:50] + ")"))
                elif norm_label(name) == norm_label(L.get("href", "").split("/")[-1].replace("-", " ")) and len(name) < 5:
                    f612.append(evidence(u, "nom accessible trop court : \"" + name[:40] + "\""))
        add("6.1.2", "6.1", "6.1 Liens", "Chaque lien image est-il explicite ?",
            "Vérifier que l'alternative de l'image (ou le contexte) donne la fonction et la destination.",
            f612, [], app612,
            "Donner une alternative claire aux images des liens (alt décrivant la fonction, ex : \"Suivre SNCF Connect sur Instagram\").",
            comment=str(len(app612)) + " liens image examinés.")

        # 6.1.3 liens composites
        f613, app613 = [], []
        for p in ok_pages:
            for L in p.get("links", []):
                if not L.get("visible") or not L.get("imgAlt") or not norm(L.get("text")):
                    continue
                u = p["url"]
                app613.append(u)
                combined = norm(L.get("name"))
                if not combined:
                    f613.append(evidence(u, "lien composite sans nom accessible complet (" + L.get("href", "")[:50] + ")"))
        add("6.1.3", "6.1", "6.1 Liens", "Chaque lien composite (image plus texte) est-il explicite ?",
            "Vérifier que la combinaison texte plus alternative est claire (ou que le contexte suffit).",
            f613, [], app613,
            "Vérifier que l'alternative complète le texte sans le contredire.",
            comment=str(len(app613)) + " liens composites examinés.")

        # 6.1.4 liens svg
        f614, app614 = [], []
        for p in ok_pages:
            for L in p.get("links", []):
                if not L.get("visible") or not (L.get("svgAria") or L.get("svgRoleImg") or L.get("svgHidden")):
                    continue
                u = p["url"]
                app614.append(u)
                name = norm(L.get("name"))
                if not name:
                    f614.append(evidence(u, "lien svg sans nom accessible (" + L.get("href", "")[:50] + ")"))
        add("6.1.4", "6.1", "6.1 Liens", "Chaque lien svg est-il explicite ?",
            "Vérifier le nom accessible du lien svg (aria-label du lien, texte ou aria-label du svg) ou le contexte.",
            f614, [], app614,
            "Nommer le lien (aria-label sur le lien, par exemple \"Retour à l'accueil\") et masquer le svg décoratif.",
            comment=str(len(app614)) + " liens svg examinés.")

        # 6.1.5 nom accessible contient l'intitulé visible
        f615, app615 = [], []
        for p in ok_pages:
            for L in p.get("links", []):
                if not L.get("visible"):
                    continue
                aria = (L.get("aria") or "").strip()
                vis = norm(L.get("text"))
                if not aria or not vis:
                    continue
                u = p["url"]
                app615.append(u)
                if norm_label(vis) not in norm_label(aria):
                    f615.append(evidence(u, "intitulé visible \"" + vis[:40] + "\" absent du nom accessible \"" + aria[:60] + "\""))
        add("6.1.5", "6.1", "6.1 Liens", "Le nom accessible du lien contient-il au moins l'intitulé visible ?",
            "Pour les liens avec aria-label, aria-labelledby ou title, vérifier que le nom accessible contient l'intitulé visible.",
            f615, [], app615,
            "Faire contenir l'intitulé visible au début du nom accessible (ex : \"Réserver mon billet pour Noël\").",
            comment=str(len(app615)) + " liens avec aria-label vérifiés.")

    # ---------------- scores, précos, plan
    def scores(self, tests):
        per = {}
        for crit, name in [("1.1", "1.1 Images"), ("3.2", "3.2 Contrastes"), ("6.1", "6.1 Liens")]:
            tt = [t for t in tests if t["criterion"] == crit]
            c = sum(1 for t in tt if t["verdict"] == "Conforme")
            nc = sum(1 for t in tt if t["verdict"] == "Non conforme")
            nt = sum(1 for t in tt if t["verdict"] == "Non testé")
            na = sum(1 for t in tt if t["verdict"] == "Non applicable")
            taux = round(c / (c + nc), 4) if (c + nc) else None
            per[crit] = {"name": name, "tests": len(tt), "c": c, "nc": nc, "nt": nt, "na": na, "taux": taux}
        tot_c = sum(v["c"] for v in per.values())
        tot_nc = sum(v["nc"] for v in per.values())
        tot_t = sum(v["tests"] for v in per.values())
        tot_na = sum(v["na"] for v in per.values())
        tot_nt = sum(v["nt"] for v in per.values())
        global_taux = round(tot_c / (tot_c + tot_nc), 4) if (tot_c + tot_nc) else None
        rates = [v["taux"] for v in per.values() if v["taux"] is not None]
        mean = round(sum(rates) / len(rates), 4) if rates else None
        return {"per_criterion": per, "global": global_taux, "mean": mean,
                "totals": {"tests": tot_t, "c": tot_c, "nc": tot_nc, "na": tot_na, "nt": tot_nt}}

    def precos(self, tests, meta):
        out = []
        n = 0
        for t in tests:
            if t["verdict"] != "Non conforme":
                continue
            n += 1
            prio = "Haute" if t["criterion"] in ("1.1", "6.1") else "Moyenne"
            charge = "Faible" if t["verdict"] == "Non conforme" and len(t["examples"]) <= 2 else "Moyenne"
            constat = str(len(t["examples"])) + " non-conformité(ies) relevée(s) : " + (t["examples"][0]["detail"][:110] if t["examples"] else "")
            out.append({"n": n, "test": t["id"], "constat": constat, "action": t["reco"],
                        "qui": "Développeur" if t["criterion"] in ("1.1", "6.1") else "Équipe",
                        "priorite": prio, "charge": charge, "etat": "À faire",
                        "echeance": "30 jours", "commentaire": ""})
        n += 1
        out.append({"n": n, "test": "Procédure", "constat": "L'audit porte sur " + str(len(meta.get("pages", []))) + " pages et 3 critères seulement.",
                    "action": "Étendre l'audit aux autres critères du RGAA avec cet outil.",
                    "qui": "Auditeur", "priorite": "Moyenne", "charge": "Élevée", "etat": "À faire",
                    "echeance": "3 mois", "commentaire": ""})
        n += 1
        out.append({"n": n, "test": "Procédure", "constat": "Aucun audit complet RGAA n'est prévu après les corrections.",
                    "action": "Planifier un nouvel audit complet puis mettre à jour la déclaration d'accessibilité.",
                    "qui": "Auditeur", "priorite": "Haute", "charge": "Élevée", "etat": "À faire",
                    "echeance": "12 mois", "commentaire": ""})
        n += 1
        out.append({"n": n, "test": "Procédure", "constat": "Les équipes ne sont pas outillées sur l'accessibilité au quotidien.",
                    "action": "Former les équipes (alts, liens explicites) et intégrer des tests automatiques dans la fab.",
                    "qui": "Auditeur et design", "priorite": "Moyenne", "charge": "Moyenne", "etat": "À faire",
                    "echeance": "12 mois", "commentaire": ""})
        n += 1
        out.append({"n": n, "test": "Procédure", "constat": "Aucun audit de maintenance n'est prévu.",
                    "action": "Refaire un audit annuel et mettre à jour la déclaration d'accessibilité chaque année.",
                    "qui": "Auditeur", "priorite": "Moyenne", "charge": "Élevée", "etat": "À faire",
                    "echeance": "chaque année", "commentaire": ""})
        return out

    def plan(self, precos):
        haut = [p["n"] for p in precos if p["priorite"] == "Haute" and p["test"] != "Procédure"]
        moy = [p["n"] for p in precos if p["priorite"] == "Moyenne" and p["test"] != "Procédure"]
        bas = [p["n"] for p in precos if p["priorite"] == "Basse" and p["test"] != "Procédure"]
        proc = [p["n"] for p in precos if p["test"] == "Procédure"]
        def ref(ns):
            return ("précos " + ", ".join(map(str, ns))) if ns else "audit"
        return [
            {"n": 1, "action": "Corriger les non-conformités prioritaires (images et liens)", "base": ref(haut), "qui": "Équipe du site", "plan": {0: "En cours", 1: "Planifié"}, "livrable": "Toutes les corrections prioritaires en production."},
            {"n": 2, "action": "Corriger les non-conformités secondaires (contrastes, alts à relire)", "base": ref(moy + bas), "qui": "Équipe du site", "plan": {1: "Planifié", 2: "En cours", 3: "Fait"}, "livrable": "Corrections secondaires en production."},
            {"n": 3, "action": "Étendre l'audit aux autres critères du RGAA avec cet outil", "base": ref(proc[:1]), "qui": "Auditeur", "plan": {1: "Planifié", 2: "En cours", 3: "Fait"}, "livrable": "Un audit complet du site."},
            {"n": 4, "action": "Former les équipes (rédaction, design, développement)", "base": ref(proc[2:3] or proc), "qui": "Auditeur et design", "plan": {2: "Planifié", 3: "Planifié"}, "livrable": "Séances de formation faites, supports diffusés."},
            {"n": 5, "action": "Nouvel audit complet RGAA (échantillon élargi)", "base": "Procédure", "qui": "Auditeur", "plan": {4: "Planifié", 5: "Planifié"}, "livrable": "Rapport d'audit complet avec scores."},
            {"n": 6, "action": "Mettre à jour la déclaration d'accessibilité", "base": "Procédure", "qui": "Équipe du site", "plan": {5: "Planifié"}, "livrable": "Nouvelle déclaration publiée sur le site."},
            {"n": 7, "action": "Intégrer des tests automatiques d'accessibilité dans la fab", "base": "Procédure", "qui": "Équipe technique", "plan": {5: "Planifié", 6: "En cours", 7: "Fait"}, "livrable": "Tests automatiques lancés à chaque mise en ligne."},
            {"n": 8, "action": "Audit de maintenance annuel et mise à jour de la déclaration", "base": "Procédure", "qui": "Auditeur", "plan": {7: "Planifié", 11: "Planifié"}, "livrable": "Déclaration annuelle mise à jour."},
            {"n": 9, "action": "Contrôle de conformité complet par un tiers", "base": "Suite du plan", "qui": "Bureau indépendant", "plan": {10: "Planifié", 11: "Planifié"}, "livrable": "Contrôle validé, site conforme."},
        ]

    def manual_points(self, tests):
        pts = []
        for t in tests:
            for s in t.get("unsure", []):
                pts.append({"test": t["id"], "page": s["page"], "detail": s["detail"]})
        return pts[:20]


def pct(x):
    return "à finir" if x is None else str(round(x * 1000) / 10).replace(".", ",") + " %"


def verdict_summary(results):
    s = results["scores"]
    if s["global"] is None:
        return "AUDIT INCOMPLET"
    tot = s["totals"]
    if tot["nc"] == 0 and tot["nt"] == 0:
        return "CONFORMITÉ TOTALE"
    if s["global"] >= 0.5:
        return "CONFORMITÉ PARTIELLE"
    return "NON CONFORME"
