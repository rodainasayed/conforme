/* ============================================================
   Conforme : génération du classeur Excel dans le navigateur
   (ExcelJS). Reproduit la structure à 6 onglets du mode serveur :
   Mode d'emploi, Audit (menus déroulants pré-remplis), Synthèse
   (formules), Préconisations, Plan pluriannuel, Référentiel RGAA.
   ============================================================ */
(() => {
  "use strict";

  const NAVY = "FF1F3864", LIGHT = "FFD9E2F2", BODY = "FF1A1A1A", GRAY = "FF595959";
  const GREEN_F = "FFC6EFCE", GREEN_T = "FF006100";
  const RED_F = "FFFFC7CE", RED_T = "FF9C0006";
  const GRAYF = "FFF2F2F2";
  const BLUEF = "FFDDEBF7", BLUET = "FF1F4E79";
  const YELL = "FFFFF2CC";
  const WHITE = "FFFFFFFF";
  const LINE = "FFBFBFBF";

  const RES = '"Conforme,Non conforme,Non testé,Non applicable"';
  const PRI = '"Haute,Moyenne,Basse"';
  const CHA = '"Faible,Moyenne,Élevée"';
  const ETA = '"À faire,En cours,Fait,Reporté"';
  const PLA = '"Planifié,En cours,Fait,Reporté"';
  const QUARTERS = ["2026 T1", "2026 T2", "2026 T3", "2026 T4", "2027 T1", "2027 T2", "2027 T3", "2027 T4", "2028 T1", "2028 T2", "2028 T3", "2028 T4"];

  const estLines = (text, width) => {
    if (!text) return 1;
    const cpl = Math.max(8, width * 1.03);
    let total = 0;
    for (const part of String(text).split("\n")) total += Math.max(1, Math.ceil(part.length / cpl));
    return total;
  };
  const rowH = (pairs, extra = 6) => {
    let lines = 1;
    for (const [t, w] of pairs) lines = Math.max(lines, estLines(t, w));
    return Math.min(430, lines * 14.2 + extra);
  };
  const argb = (hex) => hex.replace("#", "").toUpperCase();

  function styleCell(c, opt = {}) {
    c.font = opt.font || { name: "Arial", size: 11, color: { argb: BODY } };
    c.alignment = opt.align || { wrapText: true, vertical: "top", horizontal: "left" };
    if (opt.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(opt.fill) } };
    if (opt.border !== false) {
      const b = { style: "thin", color: { argb: LINE } };
      c.border = { top: b, left: b, bottom: b, right: b };
    }
    if (opt.numFmt) c.numFmt = opt.numFmt;
    return c;
  }
  const fBody = () => ({ name: "Arial", size: 11, color: { argb: BODY } });
  const fTitle = () => ({ name: "Arial", size: 15, bold: true, color: { argb: NAVY } });
  const fHead = () => ({ name: "Arial", size: 10.5, bold: true, color: { argb: WHITE } });
  const fNavy = (sz = 11, bold = true) => ({ name: "Arial", size: sz, bold: bold, color: { argb: NAVY } });
  const fSub = () => ({ name: "Arial", size: 10.5, italic: true, color: { argb: GRAY } });
  const fSmall = () => ({ name: "Arial", size: 9.5, color: { argb: GRAY } });
  const AC = { wrapText: true, vertical: "center", horizontal: "left" };
  const CC = { wrapText: true, vertical: "center", horizontal: "center" };
  const TOP = { wrapText: true, vertical: "top", horizontal: "left" };

  function secteur(ws, row, text, largeur) {
    const c = ws.getCell("A" + row);
    c.value = text;
    c.font = { name: "Arial", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "center" };
    ws.getRow(row).height = 22;
    if (largeur) {
      ws.mergeCells(row, 1, row, largeur);
    }
  }

  function dvList(ws, ref, liste, promptTitre, promptTxt) {
    for (const range of ref.split(" ")) {
      const [deb, fin] = range.split(":");
      if (!fin) continue;
      const dCol = deb.replace(/\d+/, ""), dRow = parseInt(deb.replace(/\D+/, ""));
      const fCol = fin.replace(/\d+/, ""), fRow = parseInt(fin.replace(/\D+/, ""));
      const c0 = dCol.charCodeAt(0), c1 = fCol.charCodeAt(0);
      for (let r = dRow; r <= fRow; r++) {
        for (let ci = c0; ci <= c1; ci++) {
          ws.getCell(String.fromCharCode(ci) + r).dataValidation = {
            type: "list", allowBlank: true, formulae: [liste],
            showErrorMessage: true, errorTitle: "Valeur interdite",
            error: "Choisir une valeur dans la liste.",
            showInputMessage: !!promptTitre, promptTitle: promptTitre || undefined, prompt: promptTxt || undefined,
          };
        }
      }
    }
  }

  function cfListe(ws, ref, paires) {
    const rules = paires.map(([val, fill, txt]) => ({
      type: "cellIs", operator: "equal", formulae: ['"' + val + '"'], priority: 1,
      style: {
        fill: { type: "pattern", pattern: "solid", bgColor: { argb: argb(fill) } },
        font: { name: "Arial", size: 11, bold: true, color: { argb: argb(txt) } },
      },
    }));
    ws.addConditionalFormatting({ ref: ref, rules: rules });
  }

  function feuilleModeEmploi(wb, res) {
    const meta = res.meta || {};
    const ws = wb.addWorksheet("Mode d'emploi", { properties: { tabColor: { argb: "FF808080" } } });
    ws.getColumn("A").width = 3;
    ws.getColumn("B").width = 108;
    let r = 1;
    const titre = ws.getCell("B1");
    titre.value = "Audit d'accessibilité numérique avec le RGAA";
    titre.font = { name: "Arial", size: 16, bold: true, color: { argb: NAVY } };
    ws.getRow(1).height = 26;
    r = 2;
    const sous = ws.getCell("B2");
    sous.value = "Outil pour auditer un site internet avec le RGAA version 4.1.2. Ici, le site audité est " + (meta.site || "") + " (" + (meta.url || "") + ").";
    sous.font = fSub();
    r = 4;
    const sections = [
      ["A. À quoi sert cet outil", [
        "Cet outil sert à faire un audit d'accessibilité numérique simple, rapide et sans oubli. Les critères du RGAA sont déjà écrits, il n'y a plus qu'à répondre.",
        "Les réponses se choisissent dans des menus déroulants, donc tout le monde utilise les mêmes mots et il n'y a pas de fautes de frappe.",
        "Les scores se calculent tout seuls dans l'onglet Synthèse. Les corrections se rangent dans l'onglet Préconisations, puis dans le Plan pluriannuel.",
      ]],
      ["B. Les 5 onglets du fichier", [
        "Audit : le cœur de l'outil. Une ligne par test du RGAA (18 tests pour les critères 1.1, 3.2 et 6.1). On choisit le résultat dans le menu déroulant.",
        "Synthèse : les scores se calculent tout seuls. C'est la page à montrer au client.",
        "Préconisations : une ligne par problème trouvé, avec l'action à faire, la priorité, la charge et le responsable.",
        "Plan pluriannuel : on répartit les actions sur 3 ans, trimestre par trimestre.",
        "Référentiel RGAA : le texte officiel des critères et des tests, pour tout vérifier sans quitter le fichier.",
      ]],
      ["C. Comment compléter cet audit, dans l'ordre", [
        "1. L'audit automatique est déjà tracé dans l'onglet Audit. Lire chaque ligne et juger les points marqués Non testé.",
        "2. Corriger les exemples : la colonne Exemples relevés cite la page et le problème, précisément.",
        "3. Ajuster le Résultat si l'analyse automatique doit être complétée à la main (l'outil le signale honnêtement).",
        "4. Regarder la Synthèse : les scores se mettent à jour tout seuls.",
        "5. Compléter l'onglet Préconisations (responsable, échéance) puis répartir dans le Plan pluriannuel.",
      ]],
      ["D. Les 4 valeurs du menu déroulant", [
        "Conforme : le test est respecté sur les pages vérifiées.",
        "Non conforme : le test n'est pas respecté. Un exemple est cité.",
        "Non testé : le test n'a pas encore été vérifié (analyse à compléter à la main). Un audit rendu ne doit plus en contenir.",
        "Non applicable : le test ne concerne pas la page. Un non applicable ne compte pas dans le score.",
      ]],
      ["E. Bien travailler à plusieurs", [
        "Chaque test peut être vérifié par une personne différente, le menu déroulant garde les mêmes mots partout.",
        "On ne modifie que les colonnes Résultat, Pages concernées, Exemples relevés et Commentaires. Les colonnes N°, Thème, Intitulé et Que faut-il vérifier sont le référentiel.",
        "La colonne Commentaires sert aux échanges entre collègues.",
        "Pour ajouter d'autres critères plus tard : insérer des lignes dans l'onglet Audit entre la ligne 5 et la ligne 120, avec le bon Thème. Les scores suivent tout seuls.",
      ]],
      ["F. Comment le score est calculé", [
        "Pour chaque critère : taux de conformité = tests conformes / tests applicables. Les non applicables et les non testés ne comptent pas.",
        "Le taux global porte sur tous les tests. Le taux moyen est la moyenne des taux des 3 critères. C'est la méthode du RGAA.",
      ]],
      ["G. Cet outil est accessible", [
        "La couleur n'est jamais utilisée seule : chaque résultat garde son mot (vert, rouge, gris ou bleu, mais toujours écrit).",
        "Les tableaux de données n'ont pas de cellules fusionnées (elles gênent les lecteurs d'écran). Seuls les blocs d'information de la Synthèse en utilisent quelques unes, pour la mise en page.",
        "En-têtes figés, une information par cellule, police Arial 11, textes courts.",
        "L'outil s'utilise au clavier et avec un lecteur d'écran, sur Excel ou sur LibreOffice.",
      ]],
      ["H. Ce fichier est déjà rempli", [
        "Un audit de " + (meta.site || "") + " est déjà tracé ici (" + (res.pages || []).length + " pages, audit du " + (meta.date || "") + ", critères 1.1, 3.2 et 6.1).",
        "Pour reprendre ce fichier sur un autre site : remettre les résultats à Non testé, changer le nom du site dans la Synthèse et les pages dans l'onglet Audit.",
      ]],
    ];
    for (const [t, items] of sections) {
      const c = ws.getCell("B" + r);
      c.value = t;
      c.font = { name: "Arial", size: 13, bold: true, color: { argb: NAVY } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      ws.getRow(r).height = 22;
      r++;
      for (const it of items) {
        const c2 = ws.getCell("B" + r);
        c2.value = it;
        c2.font = fBody();
        c2.alignment = TOP;
        ws.getRow(r).height = rowH([[it, 108]], 4);
        r++;
      }
      r++;
    }
    const c = ws.getCell("B" + r);
    c.value = "Limites de l'audit fait le " + (meta.date || "");
    c.font = { name: "Arial", size: 13, bold: true, color: { argb: NAVY } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    ws.getRow(r).height = 22;
    r++;
    for (const it of [
      (res.pages || []).length + " pages vérifiées (la liste est dans la Synthèse). Le site est dynamique, les résultats peuvent évoluer.",
      "Les pages qui demandent une connexion (réservation, paiement, compte) n'ont pas pu être vérifiées automatiquement.",
      "Les points signalés Non testé dans l'onglet Audit restent à contrôler à la main (le moteur le dit honnêtement).",
      "Source : RGAA version 4.1.2 sur accessibilite.numerique.gouv.fr.",
    ]) {
      const c2 = ws.getCell("B" + r);
      c2.value = it;
      c2.font = fBody();
      c2.alignment = TOP;
      ws.getRow(r).height = rowH([[it, 108]], 4);
      r++;
    }
    ws.views = [{ showGridLines: false }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  function feuilleAudit(wb, res) {
    const meta = res.meta || {};
    const tests = res.tests || [];
    const ws = wb.addWorksheet("Audit", { properties: { tabColor: { argb: NAVY } } });
    const widths = { A: 8, B: 13, C: 34, D: 38, E: 15, F: 24, G: 46, H: 40, I: 24 };
    for (const [col, w] of Object.entries(widths)) ws.getColumn(col).width = w;
    const t = ws.getCell("A1");
    t.value = "Audit RGAA 4.1.2, site " + (meta.site || "") + " (" + (meta.url || "") + ")";
    t.font = fTitle();
    const s2 = ws.getCell("A2");
    s2.value = "Audit du " + (meta.date || "") + " (moteur automatique : " + (meta.mode || "") + "), critères 1.1, 3.2 et 6.1. Le résultat se choisit dans le menu déroulant de la colonne Résultat. Les scores sont dans l'onglet Synthèse.";
    s2.font = fSub();
    const heads = ["N°", "Thème", "Intitulé du test", "Que faut-il vérifier ?", "Résultat", "Pages concernées", "Exemples relevés", "Préconisation", "Commentaires"];
    heads.forEach((h, i) => styleCell(ws.getCell(4, i + 1), { font: fHead(), align: CC, fill: NAVY }));
    ws.getRow(4).height = 30;
    let r = 5;
    for (const t2 of tests) {
      let pagesTxt = (t2.pages || []).map((p) => String(p).split("?")[0].replace("https://", "")).slice(0, 3).join(", ") || "(aucune page applicable)";
      if ((t2.pages || []).length > 3) pagesTxt += ", + " + (t2.pages.length - 3);
      const exTxt = (t2.examples || []).map((e) => "• " + String(e.page).split("?")[0].replace("https://", "").replace("www.", "") + " : " + e.detail).join("\n") || "Aucun problème relevé.";
      const unTxt = (t2.unsure || []).map((e) => "• " + String(e.page).split("?")[0].replace("https://", "").replace("www.", "") + " : " + e.detail).join("\n");
      const exemples = unTxt ? (exTxt + "\nÀ contrôler à la main :\n" + unTxt) : exTxt;
      const vals = [t2.id, t2.theme, t2.title, t2.verify, t2.verdict, pagesTxt, exemples, t2.reco, t2.comment || ""];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        if (i === 0) styleCell(c, { font: fNavy(), align: CC });
        else if (i === 1) styleCell(c, { font: fNavy(10), align: CC, fill: LIGHT });
        else if (i === 4) styleCell(c, { font: fNavy(), align: CC });
        else styleCell(c, { align: AC });
        c.value = v;
      });
      ws.getRow(r).height = rowH([
        [vals[2], widths.C], [vals[3], widths.D], [vals[5], widths.F], [vals[6], widths.G], [vals[7], widths.H], [vals[8], widths.I],
      ], 8);
      r++;
    }
    dvList(ws, "E5:E120", RES, "Résultat du test", "Choisir dans la liste. Voir le mode d'emploi pour les définitions.");
    cfListe(ws, "E5:E120", [
      ["Conforme", GREEN_F, GREEN_T], ["Non conforme", RED_F, RED_T], ["Non testé", GRAYF, GRAY], ["Non applicable", BLUEF, BLUET],
    ]);
    ws.autoFilter = "A4:I" + (r - 1);
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4, topLeftCell: "C5" }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  function feuilleSynthese(wb, res) {
    const meta = res.meta || {};
    const scores = res.scores || { per_criterion: {}, totals: {} };
    const pages = res.pages || [];
    const manual = res.manual || [];
    const ws = wb.addWorksheet("Synthèse", { properties: { tabColor: { argb: "FF2E7D32" } } });
    for (const [col, w] of Object.entries({ A: 26, B: 10, C: 12, D: 14, E: 12, F: 15, G: 17 })) ws.getColumn(col).width = w;
    ws.getCell("A1").value = "Synthèse de l'audit RGAA 4.1.2, site " + (meta.site || "");
    ws.getCell("A1").font = fTitle();
    ws.getCell("A2").value = "Site audité : " + (meta.url || "") + ". Audit du " + (meta.date || "") + ", critères 1.1 Images, 3.2 Contrastes et 6.1 Liens.";
    ws.getCell("A2").font = fSub();

    secteur(ws, 4, "Informations sur l'audit", 7);
    const infos = [
      ["Site audité", meta.url || ""],
      ["Pages auditées", pages.join(", ") || "aucune"],
      ["Date de l'audit", meta.date || ""],
      ["Référentiel utilisé", "RGAA version 4.1.2, critères 1.1, 3.2 et 6.1 (18 tests)"],
      ["Méthode", "Moteur automatique (" + (meta.mode || "") + ") : analyse du code rendu, images, liens et contrastes mesurés sur " + ((meta.stats || {}).texts || 0) + " textes."],
      ["Nombre d'éléments examinés", ((meta.stats || {}).imgs || 0) + " images, " + ((meta.stats || {}).links || 0) + " liens, " + ((meta.stats || {}).svgs || 0) + " svg."],
      ["Points à contrôler à la main", manual.length + " points signalés Non testé dans l'onglet Audit."],
    ];
    let r = 5;
    for (const [lab, val] of infos) {
      styleCell(ws.getCell(r, 1), { font: fNavy(), align: AC, fill: LIGHT }).value = lab;
      styleCell(ws.getCell(r, 2), { align: AC }).value = val;
      ws.mergeCells(r, 2, r, 7);
      ws.getRow(r).height = rowH([[val, 84]], 6);
      r++;
    }
    secteur(ws, 12, "Résultats par critère (les formules se mettent à jour tout seules)", 7);
    ["Critère", "Tests", "Conformes", "Non conformes", "Non testés", "Non applicables", "Taux de conformité"].forEach((h, i) => styleCell(ws.getCell(13, i + 1), { font: fHead(), align: CC, fill: NAVY }));
    ws.getRow(13).height = 30;
    r = 14;
    for (const lab of ["1.1 Images", "3.2 Contrastes", "6.1 Liens"]) {
      styleCell(ws.getCell(r, 1), { align: AC, fill: LIGHT }).value = lab;
      styleCell(ws.getCell(r, 2), { align: CC }).value = { formula: 'COUNTIF(Audit!$B$5:$B$120,"' + lab + '")' };
      ["Conforme", "Non conforme", "Non testé", "Non applicable"].forEach((v, k) => {
        styleCell(ws.getCell(r, 3 + k), { align: CC }).value = { formula: 'COUNTIFS(Audit!$B$5:$B$120,"' + lab + '",Audit!$E$5:$E$120,"' + v + '")' };
      });
      styleCell(ws.getCell(r, 7), { font: fNavy(), align: CC, numFmt: "0.0%" }).value = { formula: 'IFERROR(C' + r + '/(C' + r + '+D' + r + '),"à finir")' };
      ws.getRow(r).height = 20;
      r++;
    }
    styleCell(ws.getCell(17, 1), { font: fNavy(), align: AC, fill: LIGHT }).value = "Tous les critères";
    for (let i = 2; i <= 6; i++) {
      const col = String.fromCharCode(64 + i);
      styleCell(ws.getCell(17, i), { font: fNavy(), align: CC }).value = { formula: "SUM(" + col + "14:" + col + "16)" };
    }
    styleCell(ws.getCell(17, 7), { font: fNavy(), align: CC, numFmt: "0.0%" }).value = { formula: 'IFERROR(C17/(C17+D17),"à finir")' };
    ws.getRow(17).height = 20;
    styleCell(ws.getCell(18, 1), { font: fNavy(), align: AC, fill: LIGHT }).value = "Taux moyen des critères";
    styleCell(ws.getCell(18, 7), { font: fNavy(), align: CC, numFmt: "0.0%" }).value = { formula: 'IFERROR(AVERAGE(G14:G16),"à finir")' };
    ws.getRow(18).height = 20;

    secteur(ws, 20, "Comment lire ces résultats", 7);
    const lines = ["Le taux global et le taux moyen se lisent dans le tableau ci-dessus (colonne Taux de conformité)."];
    for (const crit of ["1.1", "3.2", "6.1"]) {
      const pc = (scores.per_criterion || {})[crit] || {};
      const name = pc.name || crit;
      if (pc.nc) lines.push("Le critère " + name + " est à corriger : " + pc.nc + " test(s) non conforme(s). Voir les exemples dans l'onglet Audit.");
      else if (pc.nt) lines.push("Le critère " + name + " contient des points Non testés : à contrôler à la main avant de conclure.");
      else lines.push("Le critère " + name + " est conforme sur les pages auditées : point fort du site.");
    }
    lines.push("Chaque correction est détaillée dans l'onglet Préconisations, puis répartie dans l'onglet Plan pluriannuel.");
    r = 21;
    for (const line of lines) {
      styleCell(ws.getCell(r, 1), { align: TOP }).value = line;
      ws.mergeCells(r, 1, r, 7);
      ws.getRow(r).height = rowH([[line, 118]], 4);
      r++;
    }
    secteur(ws, r + 1, "Historique des audits", 7);
    const hh = r + 2;
    for (const [h, c1, c2] of [["Date", 1, 1], ["Étendue", 2, 4], ["Taux global", 5, 5], ["Note", 6, 7]]) {
      styleCell(ws.getCell(hh, c1), { font: fHead(), align: CC, fill: NAVY }).value = h;
      if (c2 > c1) ws.mergeCells(hh, c1, hh, c2);
    }
    ws.getRow(hh).height = 20;
    styleCell(ws.getCell(hh + 1, 1), { align: CC }).value = meta.date || "";
    styleCell(ws.getCell(hh + 1, 2), { align: AC }).value = "3 critères (1.1, 3.2, 6.1), " + pages.length + " pages";
    ws.mergeCells(hh + 1, 2, hh + 1, 4);
    const tauxCell = styleCell(ws.getCell(hh + 1, 5), { font: { name: "Arial", size: 11, bold: true, color: { argb: "FF000000" } }, align: CC, numFmt: "0.0%" });
    tauxCell.value = { formula: "G17" };
    styleCell(ws.getCell(hh + 1, 6), { align: AC }).value = "Premier audit (moteur automatique).";
    ws.mergeCells(hh + 1, 6, hh + 1, 7);
    ws.getRow(hh + 1).height = rowH([["3 critères (1.1, 3.2, 6.1), " + pages.length + " pages", 38], ["Premier audit (moteur automatique).", 33]], 4);
    for (let k = 1; k <= 3; k++) {
      styleCell(ws.getCell(hh + 1 + k, 1), { align: CC }).value = "";
      styleCell(ws.getCell(hh + 1 + k, 2), { align: AC }).value = "";
      ws.mergeCells(hh + 1 + k, 2, hh + 1 + k, 4);
      const yc = styleCell(ws.getCell(hh + 1 + k, 5), { align: CC });
      yc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELL } };
      styleCell(ws.getCell(hh + 1 + k, 6), { align: AC }).value = "";
      ws.mergeCells(hh + 1 + k, 6, hh + 1 + k, 7);
      ws.getRow(hh + 1 + k).height = 18;
    }
    const note = ws.getCell(hh + 6, 1);
    note.value = "À chaque nouvel audit : ajouter une ligne (date, étendue, taux global, note) et mettre à jour le Plan pluriannuel. Les cases jaunes du taux se remplissent à la main.";
    note.font = fSmall();
    ws.views = [{ showGridLines: false }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  function feuillePrecos(wb, res) {
    const precos = res.precos || [];
    const ws = wb.addWorksheet("Préconisations", { properties: { tabColor: { argb: "FFC55A11" } } });
    for (const [col, w] of Object.entries({ A: 6, B: 12, C: 42, D: 48, E: 16, F: 11, G: 11, H: 12, I: 13, J: 22 })) ws.getColumn(col).width = w;
    ws.getCell("A1").value = "Préconisations pour corriger les non-conformités";
    ws.getCell("A1").font = fTitle();
    ws.getCell("A2").value = "Une ligne par action. Cet onglet se transmet à l'équipe technique (ou à l'agence chargée des corrections). Les colonnes Priorité, Charge et État ont un menu déroulant.";
    ws.getCell("A2").font = fSub();
    ["N°", "Test RGAA", "Constat (résumé simple)", "Action à faire", "Qui", "Priorité", "Charge", "État", "Échéance", "Commentaire"].forEach((h, i) => styleCell(ws.getCell(4, i + 1), { font: fHead(), align: CC, fill: NAVY }));
    ws.getRow(4).height = 30;
    let r = 5;
    for (const p of precos) {
      const vals = [p.n, p.test, p.constat, p.action, p.qui, p.priorite, p.charge, p.etat, p.echeance, p.commentaire || ""];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        if (i === 0) styleCell(c, { font: fNavy(), align: CC });
        else if (i >= 5 && i <= 8) styleCell(c, { font: fNavy(), align: CC });
        else styleCell(c, { align: AC });
        c.value = v;
      });
      ws.getRow(r).height = rowH([[vals[2], 42], [vals[3], 48], [vals[9], 22]], 8);
      r++;
    }
    dvList(ws, "F5:F40", PRI); dvList(ws, "G5:G40", CHA); dvList(ws, "H5:H40", ETA);
    cfListe(ws, "F5:F40", [["Haute", RED_F, RED_T], ["Moyenne", YELL, "FF8A6100"], ["Basse", BLUEF, BLUET]]);
    cfListe(ws, "G5:G40", [["Faible", GREEN_F, GREEN_T], ["Moyenne", YELL, "FF8A6100"], ["Élevée", RED_F, RED_T]]);
    cfListe(ws, "H5:H40", [["À faire", RED_F, RED_T], ["En cours", YELL, "FF8A6100"], ["Fait", GREEN_F, GREEN_T], ["Reporté", BLUEF, BLUET]]);
    ws.autoFilter = "A4:J" + (r - 1);
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 2, ySplit: 4, topLeftCell: "C5" }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  function feuillePlan(wb, res) {
    const planRows = res.plan || [];
    const ws = wb.addWorksheet("Plan pluriannuel", { properties: { tabColor: { argb: "FF2E74B5" } } });
    ws.getCell("A1").value = "Plan pluriannuel de mise en accessibilité (2026 à 2028)";
    ws.getCell("A1").font = fTitle();
    ws.getCell("A2").value = "Chaque case de trimestre se remplit avec le menu déroulant : Planifié, En cours, Fait, Reporté. Une case vide veut dire : rien de prévu sur ce trimestre.";
    ws.getCell("A2").font = fSub();
    ws.getCell("A3").value = "Principe : en 2026 on corrige ce qui bloque, en 2027 on élargit les critères et on outille les équipes, en 2028 on stabilise et on fait contrôler.";
    ws.getCell("A3").font = fSub();
    ws.getCell("A4").value = "Idée clé : chaque ligne du plan reprend les numéros de l'onglet Préconisations, ainsi le plan et les corrections restent toujours en phase.";
    ws.getCell("A4").font = fSub();
    const heads = ["N°", "Action", "Basé sur", "Responsable"].concat(QUARTERS).concat(["Livrable attendu"]);
    heads.forEach((h, i) => styleCell(ws.getCell(5, i + 1), { font: fHead(), align: CC, fill: NAVY }));
    ws.getRow(5).height = 30;
    ws.getColumn("A").width = 6;
    ws.getColumn("B").width = 44;
    ws.getColumn("C").width = 30;
    ws.getColumn("D").width = 16;
    for (let i = 5; i <= 16; i++) ws.getColumn(i).width = 10;
    ws.getColumn("Q").width = 34;
    let r = 6;
    for (const p of planRows) {
      styleCell(ws.getCell(r, 1), { font: fNavy(), align: CC }).value = p.n;
      styleCell(ws.getCell(r, 2), { align: AC }).value = p.action;
      styleCell(ws.getCell(r, 3), { align: AC }).value = p.base;
      styleCell(ws.getCell(r, 4), { align: AC }).value = p.qui;
      for (let qi = 0; qi < 12; qi++) styleCell(ws.getCell(r, 5 + qi), { align: CC }).value = (p.plan || {})[qi] || "";
      styleCell(ws.getCell(r, 17), { align: AC }).value = p.livrable;
      ws.getRow(r).height = rowH([[p.action, 44], [p.base, 30], [p.livrable, 34]], 8);
      r++;
    }
    dvList(ws, "E6:P" + (r + 4), PLA);
    cfListe(ws, "E6:P" + (r + 4), [["Planifié", BLUEF, BLUET], ["En cours", YELL, "FF8A6100"], ["Fait", GREEN_F, GREEN_T], ["Reporté", RED_F, RED_T]]);
    r += 1;
    for (const line of [
      "Comment se servir de ce plan :",
      "Commencer par les priorités Haute de l'onglet Préconisations.",
      "Ne pas placer plus de 2 ou 3 actions sur le même trimestre, sinon rien n'avance.",
      "Quand une action est terminée, mettre Fait dans le trimestre concerné et noter le livrable dans la dernière colonne.",
    ]) {
      const c = ws.getCell(r, 1);
      c.value = line;
      c.font = line.endsWith(":") ? fNavy(11, true) : fBody();
      c.alignment = TOP;
      ws.mergeCells(r, 1, r, 17);
      ws.getRow(r).height = rowH([[line, 195]], 4);
      r++;
    }
    ws.views = [{ showGridLines: false, state: "frozen", xSplit: 4, ySplit: 5, topLeftCell: "E6" }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  function feuilleReferentiel(wb, res) {
    const ws = wb.addWorksheet("Référentiel RGAA", { properties: { tabColor: { argb: "FF808080" } } });
    for (const [col, w] of Object.entries({ A: 9, B: 9, C: 46, D: 62, E: 40, F: 26 })) ws.getColumn(col).width = w;
    ws.getCell("A1").value = "Référentiel RGAA version 4.1.2, extraits des critères 1.1, 3.2 et 6.1";
    ws.getCell("A1").font = fTitle();
    ws.getCell("A2").value = "Source : https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/ (site officiel). Le texte est condensé pour rester lisible.";
    ws.getCell("A2").font = fSub();
    ["Critère", "Test", "Intitulé officiel du test", "Points de vérification (méthodologie officielle)", "Cas particuliers", "Références WCAG"].forEach((h, i) => styleCell(ws.getCell(4, i + 1), { font: fHead(), align: CC, fill: NAVY }));
    ws.getRow(4).height = 30;
    const CP11 = "Images utilisées comme CAPTCHA ou comme image-test : critère non applicable (le cas est traité par le critère 1.4).";
    const CP32 = "Le texte fait partie d'un logo ou d'un nom de marque ; le texte est purement décoratif ; le texte fait partie d'une image mais n'apporte aucune information essentielle ; le texte appartient à un élément d'interface sans action possible (bouton désactivé).";
    const CP61 = "Si le lien est ambigu pour tout le monde et qu'il est impossible de le rendre explicite dans son contexte, le critère est non applicable. Pour 6.1.5 : ponctuation et majuscules peuvent être ignorées ; si l'intitulé visible sert de symbole, le nom accessible exprime la fonction (exemple : B devient Mettre en gras).";
    const rows = [
      ["1.1", "Critère 1.1", "Chaque image porteuse d'information a-t-elle une alternative textuelle ?", "Ce critère se vérifie par les 8 tests listés en dessous (1.1.1 à 1.1.8).", CP11, "WCAG 2.1 : 1.1.1 (A) et 4.1.2 (A)"],
      ["1.1", "1.1.1", "Chaque image (balise img ou balise avec role=\"img\") porteuse d'information a-t-elle une alternative textuelle ?", "Trouver les images img et les éléments avec role=\"img\". Déterminer si l'image est porteuse d'information. Vérifier la présence d'au moins une alternative : aria-labelledby, aria-label, alt ou title (pour role=\"img\" : aria-labelledby ou aria-label uniquement). Le test est validé si une alternative est trouvée.", "", "WCAG 2.1 : 1.1.1 (A)"],
      ["1.1", "1.1.2", "Chaque zone d'une image réactive (balise area) porteuse d'information a-t-elle une alternative textuelle ?", "Trouver les balises area. Déterminer si la zone est porteuse d'information. Vérifier la présence d'un attribut alt ou d'un aria-label.", "", ""],
      ["1.1", "1.1.3", "Chaque bouton de type image (input type=\"image\") a-t-il une alternative textuelle ?", "Trouver les input type=\"image\". Déterminer si l'image est porteuse d'information. Vérifier la présence d'une alternative : aria-labelledby, aria-label, alt ou title.", "", ""],
      ["1.1", "1.1.4", "Chaque zone cliquable d'une image réactive côté serveur est-elle doublée d'un mécanisme utilisable quel que soit le dispositif de pointage ?", "Trouver les images avec l'attribut ismap. Vérifier qu'un lien ou un ensemble de liens permet d'accéder aux mêmes ressources que lors du clic sur l'image.", "", ""],
      ["1.1", "1.1.5", "Chaque image vectorielle (balise svg) porteuse d'information vérifie-t-elle role=\"img\" et une alternative ?", "Trouver les balises svg. Déterminer si l'image est porteuse d'information. Vérifier role=\"img\" (sinon le test est invalidé). Vérifier une alternative : élément title, aria-labelledby ou aria-label.", "", ""],
      ["1.1", "1.1.6", "Chaque image objet (balise object avec type=\"image/…\") porteuse d'information vérifie-t-elle une des conditions prévues ?", "Trouver les balises object de type image. Vérifier role=\"img\" et une alternative (aria-labelledby, aria-label ou title). Sinon vérifier qu'un lien ou bouton adjacent donne accès à un contenu alternatif, ou qu'un mécanisme permet de remplacer l'objet.", "", ""],
      ["1.1", "1.1.7", "Chaque image embarquée (balise embed avec type=\"image/…\") porteuse d'information vérifie-t-elle une des conditions prévues ?", "Même logique que 1.1.6, pour les balises embed de type image.", "", ""],
      ["1.1", "1.1.8", "Chaque image bitmap (balise canvas) porteuse d'information vérifie-t-elle une des conditions prévues ?", "Trouver les balises canvas porteuses d'information. Vérifier role=\"img\" et une alternative (aria-labelledby ou aria-label). Sinon : contenu alternatif entre les balises canvas, ou lien ou bouton adjacent, ou mécanisme de remplacement.", "", ""],
      ["3.2", "Critère 3.2", "Dans chaque page web, le contraste entre la couleur du texte et la couleur de son arrière-plan est-il suffisamment élevé ?", "Ce critère se vérifie par les 5 tests listés en dessous (3.2.1 à 3.2.5). Seuils : 4,5:1 pour les petits textes, 3:1 pour les grands textes.", CP32, "WCAG 2.1 : 1.4.3 (AA)"],
      ["3.2", "3.2.1", "Le texte sans effet de graisse d'une taille restituée inférieure à 24 px a-t-il un contraste d'au moins 4,5:1 ?", "Trouver les textes (et textes en image) sans graisse de moins de 24 px qui pourraient poser problème. Vérifier un rapport d'au moins 4,5:1, ou un mécanisme qui permet d'afficher le texte à 4,5:1 au moins.", "", ""],
      ["3.2", "3.2.2", "Le texte en gras d'une taille restituée inférieure à 18,5 px a-t-il un contraste d'au moins 4,5:1 ?", "Même méthode que 3.2.1, pour les textes en gras de moins de 18,5 px. Seuil : 4,5:1.", "", ""],
      ["3.2", "3.2.3", "Le texte sans effet de graisse d'une taille restituée d'au moins 24 px a-t-il un contraste d'au moins 3:1 ?", "Même méthode, pour les textes de 24 px et plus. Seuil : 3:1.", "", ""],
      ["3.2", "3.2.4", "Le texte en gras d'une taille restituée d'au moins 18,5 px a-t-il un contraste d'au moins 3:1 ?", "Même méthode, pour les textes en gras de 18,5 px et plus. Seuil : 3:1.", "", ""],
      ["3.2", "3.2.5", "Dans le mécanisme qui affiche un contraste conforme, ce contraste est-il suffisamment élevé ?", "Ce test ne concerne que les pages qui ont un mécanisme d'affichage à contraste conforme. Vérifier que le contraste affiché par ce mécanisme est suffisamment élevé.", "", ""],
      ["6.1", "Critère 6.1", "Chaque lien est-il explicite (hors cas particuliers) ?", "Ce critère se vérifie par les 5 tests listés en dessous (6.1.1 à 6.1.5). Le contexte du lien peut être le paragraphe, l'item de liste, la cellule de tableau ou le titre de section associé.", CP61, "WCAG 2.1 : 1.1.1 (A), 2.4.4 (A) et 2.5.3 (A)"],
      ["6.1", "6.1.1", "Chaque lien texte vérifie-t-il une de ces conditions ?", "Trouver les liens texte. Vérifier que l'intitulé seul, ou l'intitulé plus le contexte, permet de comprendre la fonction et la destination.", "", ""],
      ["6.1", "6.1.2", "Chaque lien image vérifie-t-il une de ces conditions ?", "Trouver les liens image (img, area, object, canvas, svg). Vérifier l'intitulé seul (alternative de l'image) ou le contexte.", "", ""],
      ["6.1", "6.1.3", "Chaque lien composite vérifie-t-il une de ces conditions ?", "Trouver les liens composites (texte plus image). Vérifier l'intitulé seul (texte plus alternative de l'image) ou le contexte.", "", ""],
      ["6.1", "6.1.4", "Chaque lien svg vérifie-t-il une de ces conditions ?", "Trouver les liens svg (svg avec un élément a et un attribut href). Vérifier le nom accessible du svg (souvent le contenu d'un élément text) ou le contexte.", "", ""],
      ["6.1", "6.1.5", "Pour chaque lien ayant un intitulé visible, le nom accessible contient-il au moins l'intitulé visible ?", "Pour chaque lien avec un intitulé visible et un aria-label, aria-labelledby ou title : vérifier que le nom accessible contient l'intitulé visible. Même vérification pour les liens svg. La ponctuation et les majuscules peuvent être ignorées.", "", ""],
    ];
    let r = 5;
    for (const row of rows) {
      const isCrit = row[1].startsWith("Critère");
      row.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        if (isCrit) styleCell(c, { font: fNavy(10.5), align: AC, fill: LIGHT }).value = v;
        else if (i === 1) styleCell(c, { font: fNavy(), align: CC }).value = v;
        else styleCell(c, { align: AC }).value = v;
      });
      ws.getRow(r).height = rowH([[row[2], 46], [row[3], 62], [row[4], 40], [row[5], 26]], 8);
      r++;
    }
    ws.views = [{ showGridLines: false, state: "frozen", ySplit: 4, topLeftCell: "A5" }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  async function exporter(res) {
    if (typeof ExcelJS === "undefined") throw new Error("La bibliothèque Excel n'est pas chargée.");
    const wb = new ExcelJS.Workbook();
    wb.creator = "";
    wb.lastModifiedBy = "";
    wb.created = new Date();
    feuilleModeEmploi(wb, res);
    feuilleAudit(wb, res);
    feuilleSynthese(wb, res);
    feuillePrecos(wb, res);
    feuillePlan(wb, res);
    feuilleReferentiel(wb, res);
    const buf = await wb.xlsx.writeBuffer();
    return buf;
  }

  function nomFichier(res) {
    const site = ((res.meta || {}).site || "site").replace(/^www\./, "");
    const safe = site.replace(/[^A-Za-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 40) || "site";
    return "Audit_accessibilite_RGAA_" + safe + ".xlsx";
  }

  window.ConformeExcel = { exporter: exporter, nomFichier: nomFichier };
})();
