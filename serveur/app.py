# -*- coding: utf-8 -*-
"""Conforme, mode serveur : audit plus profond avec Playwright et export Excel openpyxl.

Le site publié sur GitHub Pages fonctionne sans serveur (mode navigateur).
Ce serveur local donne l'analyse la plus profonde quand il tourne.
"""
import json
import queue
import subprocess
import tempfile
import threading
import os
from urllib.parse import urlparse

from flask import Flask, Response, jsonify, request, send_file, send_from_directory

from analyzer import Engine, verdict_summary, pct
from xlsx_export import build_workbook, export_filename

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ASSETS = {
    "index.html": "text/html; charset=utf-8",
    "styles.css": "text/css; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "moteur.js": "text/javascript; charset=utf-8",
    "export-excel.js": "text/javascript; charset=utf-8",
    "vendor/exceljs.min.js": "text/javascript; charset=utf-8",
}

app = Flask(__name__)


def recalculer_xlsx(path):
    script = os.path.expanduser("~/.config/opencode/skills/excel-xlsx/scripts/recalc.py")
    if not os.path.exists(script):
        return False
    try:
        out = subprocess.run(["python3", script, path, "90"], capture_output=True, text=True, timeout=120)
        return '"status": "success"' in out.stdout
    except Exception:
        return False


def normalize_url(raw):
    raw = (raw or "").strip()
    if not raw:
        return None, "Donnez l'adresse du site à auditer."
    if "://" not in raw:
        raw = "https://" + raw
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.netloc:
        return None, "Cette adresse ne ressemble pas à une adresse de site (exemple : www.exemple.fr)."
    host = p.netloc.lower()
    if host in ("localhost", "127.0.0.1", "0.0.0.0") or host.endswith(".local"):
        return None, "Cette adresse pointe vers votre propre machine, elle ne peut pas être auditée."
    return raw, None


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:asset>")
def asset(asset):
    if asset not in ASSETS:
        return jsonify({"error": "ressource inconnue"}), 404
    r = send_from_directory(ROOT, asset)
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.post("/api/audit")
def api_audit():
    body = request.get_json(silent=True) or {}
    url, err = normalize_url(body.get("url", ""))
    if err:
        return jsonify({"error": err}), 400

    q = queue.Queue()
    SENTINEL = object()

    def run():
        def emit(evt):
            q.put(evt)
        try:
            engine = Engine(emit)
            res = engine.build(url)
            if res is None:
                q.put(SENTINEL)
                return
            res["verdict_label"] = verdict_summary(res)
            res["taux_txt"] = {"global": pct(res["scores"]["global"]), "mean": pct(res["scores"]["mean"])}
            res["mode_audit"] = "serveur"
            q.put({"type": "done", "results": res})
        except Exception as e:
            q.put({"type": "error", "message": "Erreur pendant l'audit : " + str(e)[:200]})
        finally:
            q.put(SENTINEL)

    threading.Thread(target=run, daemon=True).start()

    def stream():
        yield json.dumps({"type": "log", "text": "Audit lancé pour " + url}) + "\n"
        while True:
            try:
                evt = q.get(timeout=120)
            except queue.Empty:
                yield json.dumps({"type": "error", "message": "L'audit a trop tardé. Le site est peut être lent ou protégé."}) + "\n"
                break
            if evt is SENTINEL:
                break
            try:
                yield json.dumps(evt, ensure_ascii=False) + "\n"
            except Exception:
                break

    return Response(stream(), mimetype="application/x-ndjson", headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


@app.post("/api/export")
def api_export():
    res = request.get_json(silent=True)
    if not res or not isinstance(res, dict) or "tests" not in res:
        return jsonify({"error": "Aucun résultat d'audit à exporter."}), 400
    buf = build_workbook(res)
    tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    tmp.write(buf.getvalue())
    tmp.close()
    recalculer_xlsx(tmp.name)
    fname = export_filename(res)
    try:
        return send_file(tmp.name, as_attachment=True, download_name=fname,
                         mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    finally:
        threading.Timer(30, lambda: os.path.exists(tmp.name) and os.unlink(tmp.name)).start()


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8791, threaded=True)
