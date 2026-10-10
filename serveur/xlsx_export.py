# -*- coding: utf-8 -*-
"""Génère le classeur Excel d'audit RGAA (6 onglets) à partir des résultats du moteur."""
import io
import math
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

NAVY = "1F3864"
LIGHT_BLUE = "D9E2F2"
GRAY_TXT = "595959"
BODY = "1A1A1A"
GREEN_F, GREEN_T = "C6EFCE", "006100"
RED_F, RED_T = "FFC7CE", "9C0006"
GRAY_F = "F2F2F2"
BLUE_F, BLUE_T = "DDEBF7", "1F4E79"
YELL_F = "FFF2CC"

thin = Side(style="thin", color="BFBFBF")
B_ALL = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top", horizontal="left")
WRAPC = Alignment(wrap_text=True, vertical="center", horizontal="left")
CENTER = Alignment(wrap_text=True, vertical="center", horizontal="center")

RES_LIST = '"Conforme,Non conforme,Non testé,Non applicable"'
PRI_LIST = '"Haute,Moyenne,Basse"'
CHA_LIST = '"Faible,Moyenne,Élevée"'
ETA_LIST = '"À faire,En cours,Fait,Reporté"'
PLA_LIST = '"Planifié,En cours,Fait,Reporté"'

QUARTERS = ["2026 T1", "2026 T2", "2026 T3", "2026 T4", "2027 T1", "2027 T2", "2027 T3", "2027 T4", "2028 T1", "2028 T2", "2028 T3", "2028 T4"]


def est_lines(text, width):
    if not text:
        return 1
    cpl = max(8.0, width * 1.03)
    total = 0
    for part in str(text).split("\n"):
        total += max(1, math.ceil(len(part) / cpl))
    return total


def row_h(values_widths, extra=6):
    lines = 1
    for text, w in values_widths:
        lines = max(lines, est_lines(text, w))
    return min(430, lines * 14.2 + extra)


def style_cell(c, font=None, align=WRAP, fill=None, border=True):
    if font is None:
        font = Font(name="Arial", size=11, color=BODY)
    c.font = font
    c.alignment = align
    if fill:
        c.fill = PatternFill("solid", start_color=fill)
    if border:
        c.border = B_ALL
    return c


def f_pct(x):
    if x is None:
        return "à finir"
    return str(round(x * 1000) / 10).replace(".", ",") + " %"


def build_workbook(res):
    meta = res.get("meta", {})
    tests = res.get("tests", [])
    scores = res.get("scores", {})
    precos = res.get("precos", [])
    plan = res.get("plan", [])
    manual = res.get("manual", [])
    pages = res.get("pages", [])

    wb = Workbook()
    wb.properties.creator = ""
    wb.properties.lastModifiedBy = ""
    wb.properties.title = "Audit d'accessibilité RGAA, site " + meta.get("site", "")

    # ---------------- Mode d'emploi
    ws = wb.active
    ws.title = "Mode d'emploi"
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "808080"
    W = 108
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = W
    r = 1
    c = ws.cell(r, 2, "Audit d'accessibilité numérique avec le RGAA")
    c.font = Font(name="Arial", size=16, bold=True, color=NAVY)
    ws.row_dimensions[r].height = 26
    r += 1
    c = ws.cell(r, 2, "Outil pour auditer un site internet avec le RGAA version 4.1.2. Ici, le site audité est " + meta.get("site", "") + " (" + meta.get("url", "") + ").")
    c.font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)
    r += 2
    sections = [
        ("A. À quoi sert cet outil", [
            "Cet outil sert à faire un audit d'accessibilité numérique simple, rapide et sans oubli. Les critères du RGAA sont déjà écrits, il n'y a plus qu'à répondre.",
            "Les réponses se choisissent dans des menus déroulants, donc tout le monde utilise les mêmes mots et il n'y a pas de fautes de frappe.",
            "Les scores se calculent tout seuls dans l'onglet Synthèse. Les corrections se rangent dans l'onglet Préconisations, puis dans le Plan pluriannuel.",
        ]),
        ("B. Les 5 onglets du fichier", [
            "Audit : le cœur de l'outil. Une ligne par test du RGAA (18 tests pour les critères 1.1, 3.2 et 6.1). On choisit le résultat dans le menu déroulant.",
            "Synthèse : les scores se calculent tout seuls. C'est la page à montrer au client.",
            "Préconisations : une ligne par problème trouvé, avec l'action à faire, la priorité, la charge et le responsable.",
            "Plan pluriannuel : on répartit les actions sur 3 ans, trimestre par trimestre.",
            "Référentiel RGAA : le texte officiel des critères et des tests, pour tout vérifier sans quitter le fichier.",
        ]),
        ("C. Comment compléter cet audit, dans l'ordre", [
            "1. L'audit automatique est déjà tracé dans l'onglet Audit. Lire chaque ligne et juger les points marqués Non testé.",
            "2. Corriger les exemples : la colonne Exemples relevés cite la page et le problème, précisément.",
            "3. Ajuster le Résultat si l'analyse automatique doit être complétée à la main (l'outil le signale honnêtement).",
            "4. Regarder la Synthèse : les scores se mettent à jour tout seuls.",
            "5. Compléter l'onglet Préconisations (responsable, échéance) puis répartir dans le Plan pluriannuel.",
        ]),
        ("D. Les 4 valeurs du menu déroulant", [
            "Conforme : le test est respecté sur les pages vérifiées.",
            "Non conforme : le test n'est pas respecté. Un exemple est cité.",
            "Non testé : le test n'a pas encore été vérifié (analyse à compléter à la main). Un audit rendu ne doit plus en contenir.",
            "Non applicable : le test ne concerne pas la page. Un non applicable ne compte pas dans le score.",
        ]),
        ("E. Bien travailler à plusieurs", [
            "Chaque test peut être vérifié par une personne différente, le menu déroulant garde les mêmes mots partout.",
            "On ne modifie que les colonnes Résultat, Pages concernées, Exemples relevés et Commentaires. Les colonnes N°, Thème, Intitulé et Que faut-il vérifier sont le référentiel.",
            "La colonne Commentaires sert aux échanges entre collègues.",
            "Pour ajouter d'autres critères plus tard : insérer des lignes dans l'onglet Audit entre la ligne 5 et la ligne 120, avec le bon Thème. Les scores suivent tout seuls.",
        ]),
        ("F. Comment le score est calculé", [
            "Pour chaque critère : taux de conformité = tests conformes / tests applicables. Les non applicables et les non testés ne comptent pas.",
            "Le taux global porte sur tous les tests. Le taux moyen est la moyenne des taux des 3 critères. C'est la méthode du RGAA.",
        ]),
        ("G. Cet outil est accessible", [
            "La couleur n'est jamais utilisée seule : chaque résultat garde son mot (vert, rouge, gris ou bleu, mais toujours écrit).",
            "Les tableaux de données n'ont pas de cellules fusionnées (elles gênent les lecteurs d'écran). Seuls les blocs d'information de la Synthèse en utilisent quelques unes, pour la mise en page.",
            "En-têtes figés, une information par cellule, police Arial 11, textes courts.",
            "L'outil s'utilise au clavier et avec un lecteur d'écran, sur Excel ou sur LibreOffice.",
        ]),
        ("H. Ce fichier est déjà rempli", [
            "Un audit de " + meta.get("site", "") + " est déjà tracé ici (" + str(len(pages)) + " pages, audit du " + meta.get("date", "") + ", critères 1.1, 3.2 et 6.1).",
            "Pour reprendre ce fichier sur un autre site : remettre les résultats à Non testé, changer le nom du site dans la Synthèse et les pages dans l'onglet Audit.",
        ]),
    ]
    for title, items in sections:
        c = ws.cell(r, 2, title)
        c.font = Font(name="Arial", size=13, bold=True, color=NAVY)
        c.fill = PatternFill("solid", start_color=LIGHT_BLUE)
        c.alignment = Alignment(vertical="center")
        ws.row_dimensions[r].height = 22
        r += 1
        for it in items:
            c = ws.cell(r, 2, it)
            c.font = Font(name="Arial", size=11, color=BODY)
            c.alignment = WRAP
            ws.row_dimensions[r].height = row_h([(it, W)], extra=4)
            r += 1
        r += 1
    c = ws.cell(r, 2, "Limites de l'audit fait le " + meta.get("date", ""))
    c.font = Font(name="Arial", size=13, bold=True, color=NAVY)
    c.fill = PatternFill("solid", start_color=LIGHT_BLUE)
    ws.row_dimensions[r].height = 22
    r += 1
    limits = [
        str(len(pages)) + " pages vérifiées (la liste est dans la Synthèse). Le site est dynamique, les résultats peuvent évoluer.",
        "Les pages qui demandent une connexion (réservation, paiement, compte) n'ont pas pu être vérifiées automatiquement.",
        "Les points signalés Non testé dans l'onglet Audit restent à contrôler à la main (le moteur le dit honnêtement).",
        "Source : RGAA version 4.1.2 sur accessibilite.numerique.gouv.fr.",
    ]
    for it in limits:
        c = ws.cell(r, 2, it)
        c.font = Font(name="Arial", size=11, color=BODY)
        c.alignment = WRAP
        ws.row_dimensions[r].height = row_h([(it, W)], extra=4)
        r += 1
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    # ---------------- Audit
    ws = wb.create_sheet("Audit")
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = NAVY
    widths = {"A": 8, "B": 13, "C": 34, "D": 38, "E": 15, "F": 24, "G": 46, "H": 40, "I": 24}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    t = ws.cell(1, 1, "Audit RGAA 4.1.2, site " + meta.get("site", "") + " (" + meta.get("url", "") + ")")
    t.font = Font(name="Arial", size=15, bold=True, color=NAVY)
    ws.cell(2, 1, "Audit du " + meta.get("date", "") + " (moteur automatique : " + str(meta.get("mode", "")) + "), critères 1.1, 3.2 et 6.1. Le résultat se choisit dans le menu déroulant de la colonne Résultat. Les scores sont dans l'onglet Synthèse.").font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)
    headers = ["N°", "Thème", "Intitulé du test", "Que faut-il vérifier ?", "Résultat", "Pages concernées", "Exemples relevés", "Préconisation", "Commentaires"]
    for i, h in enumerate(headers, 1):
        style_cell(ws.cell(4, i, h), font=Font(name="Arial", size=10.5, bold=True, color="FFFFFF"), align=CENTER, fill=NAVY)
    ws.row_dimensions[4].height = 30
    r = 5
    for t_ in tests:
        pages_txt = ", ".join([p.split("?")[0].replace("https://", "") for p in t_.get("pages", [])][:3]) or "(aucune page applicable)"
        if len(t_.get("pages", [])) > 3:
            pages_txt += ", + " + str(len(t_["pages"]) - 3)
        ex_txt = "\n".join(("• " + e["page"].split("?")[0].replace("https://", "").replace("www.", "") + " : " + e["detail"]) for e in t_.get("examples", [])) or "Aucun problème relevé."
        unsure_txt = "\n".join(("• " + e["page"].split("?")[0].replace("https://", "").replace("www.", "") + " : " + e["detail"]) for e in t_.get("unsure", []))
        if unsure_txt:
            ex_txt = (ex_txt + "\nÀ contrôler à la main :\n" + unsure_txt).strip()
        vals = [t_["id"], t_["theme"], t_["title"], t_["verify"], t_["verdict"], pages_txt, ex_txt, t_["reco"], t_.get("comment", "")]
        for i, val in enumerate(vals, 1):
            if i == 1:
                style_cell(ws.cell(r, i, val), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
            elif i == 2:
                style_cell(ws.cell(r, i, val), font=Font(name="Arial", size=10, bold=True, color=NAVY), align=CENTER, fill=LIGHT_BLUE)
            elif i == 5:
                style_cell(ws.cell(r, i, val), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
            else:
                style_cell(ws.cell(r, i, val), align=WRAPC)
        ws.row_dimensions[r].height = row_h(
            [(vals[2], widths["C"]), (vals[3], widths["D"]), (vals[5], widths["F"]), (vals[6], widths["G"]), (vals[7], widths["H"]), (vals[8], widths["I"])], extra=8)
        r += 1
    dv = DataValidation(type="list", formula1=RES_LIST, allow_blank=True, showErrorMessage=True)
    dv.errorTitle = "Valeur interdite"
    dv.error = "Choisir une valeur dans la liste : Conforme, Non conforme, Non testé ou Non applicable."
    dv.promptTitle = "Résultat du test"
    dv.prompt = "Choisir dans la liste. Voir le mode d'emploi pour les définitions."
    dv.showInputMessage = True
    ws.add_data_validation(dv)
    dv.add("E5:E120")
    ws.auto_filter.ref = "A4:I" + str(r - 1)
    ws.freeze_panes = "C5"
    for val, fill, txt in [("Conforme", GREEN_F, GREEN_T), ("Non conforme", RED_F, RED_T), ("Non testé", GRAY_F, GRAY_TXT), ("Non applicable", BLUE_F, BLUE_T)]:
        ws.conditional_formatting.add("E5:E120", CellIsRule(operator="equal", formula=['"' + val + '"'], fill=PatternFill("solid", start_color=fill), font=Font(name="Arial", size=11, bold=True, color=txt)))
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "4:4"

    # ---------------- Synthèse
    ws = wb.create_sheet("Synthèse")
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "2E7D32"
    for col, w in {"A": 26, "B": 10, "C": 12, "D": 14, "E": 12, "F": 15, "G": 17}.items():
        ws.column_dimensions[col].width = w
    ws.cell(1, 1, "Synthèse de l'audit RGAA 4.1.2, site " + meta.get("site", "")).font = Font(name="Arial", size=15, bold=True, color=NAVY)
    ws.cell(2, 1, "Site audité : " + meta.get("url", "") + ". Audit du " + meta.get("date", "") + ", critères 1.1 Images, 3.2 Contrastes et 6.1 Liens.").font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)

    def sect(row, text):
        c = ws.cell(row, 1, text)
        c.font = Font(name="Arial", size=12, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", start_color=NAVY)
        c.alignment = Alignment(vertical="center")
        ws.row_dimensions[row].height = 22

    sect(4, "Informations sur l'audit")
    infos = [
        ("Site audité", meta.get("url", "")),
        ("Pages auditées", ", ".join(pages) if pages else "aucune"),
        ("Date de l'audit", meta.get("date", "")),
        ("Référentiel utilisé", "RGAA version 4.1.2, critères 1.1, 3.2 et 6.1 (18 tests)"),
        ("Méthode", "Moteur automatique : navigateur Chromium sans interface, analyse du code rendu, images, liens et contrastes mesurés sur " + str(meta.get("stats", {}).get("texts", 0)) + " textes."),
        ("Nombre d'éléments examinés", str(meta.get("stats", {}).get("imgs", 0)) + " images, " + str(meta.get("stats", {}).get("links", 0)) + " liens, " + str(meta.get("stats", {}).get("svgs", 0)) + " svg."),
        ("Points à contrôler à la main", str(len(manual)) + " points signalés Non testé dans l'onglet Audit."),
    ]
    r = 5
    for lab, val in infos:
        style_cell(ws.cell(r, 1, lab), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=WRAPC, fill=LIGHT_BLUE)
        style_cell(ws.cell(r, 2, val), align=WRAPC)
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=7)
        ws.row_dimensions[r].height = row_h([(val, 84)], extra=6)
        r += 1
    sect(12, "Résultats par critère (les formules se mettent à jour tout seules)")
    for i, h in enumerate(["Critère", "Tests", "Conformes", "Non conformes", "Non testés", "Non applicables", "Taux de conformité"], 1):
        style_cell(ws.cell(13, i, h), font=Font(name="Arial", size=10.5, bold=True, color="FFFFFF"), align=CENTER, fill=NAVY)
    ws.row_dimensions[13].height = 30
    keys = {"1.1 Images": "1.1 Images", "3.2 Contrastes": "3.2 Contrastes", "6.1 Liens": "6.1 Liens"}
    r = 14
    for lab in ["1.1 Images", "3.2 Contrastes", "6.1 Liens"]:
        style_cell(ws.cell(r, 1, lab), align=WRAPC, fill=LIGHT_BLUE, font=Font(name="Arial", size=11, color=BODY))
        style_cell(ws.cell(r, 2, '=COUNTIF(Audit!$B$5:$B$120,"' + lab + '")'), align=CENTER)
        for i, val in enumerate(["Conforme", "Non conforme", "Non testé", "Non applicable"], 3):
            style_cell(ws.cell(r, i, '=COUNTIFS(Audit!$B$5:$B$120,"' + lab + '",Audit!$E$5:$E$120,"' + val + '")'), align=CENTER)
        style_cell(ws.cell(r, 7, '=IFERROR(C' + str(r) + '/(C' + str(r) + '+D' + str(r) + '),"à finir")'), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
        ws.cell(r, 7).number_format = "0.0%"
        ws.row_dimensions[r].height = 20
        r += 1
    style_cell(ws.cell(17, 1, "Tous les critères"), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=WRAPC, fill=LIGHT_BLUE)
    for i in range(2, 7):
        col = get_column_letter(i)
        style_cell(ws.cell(17, i, "=SUM(" + col + "14:" + col + "16)"), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
    style_cell(ws.cell(17, 7, '=IFERROR(C17/(C17+D17),"à finir")'), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
    ws.cell(17, 7).number_format = "0.0%"
    ws.row_dimensions[17].height = 20
    style_cell(ws.cell(18, 1, "Taux moyen des critères"), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=WRAPC, fill=LIGHT_BLUE)
    style_cell(ws.cell(18, 7, '=IFERROR(AVERAGE(G14:G16),"à finir")'), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
    ws.cell(18, 7).number_format = "0.0%"
    ws.row_dimensions[18].height = 20
    sect(20, "Comment lire ces résultats")
    rr = 21
    lines = [
        "Le taux global et le taux moyen se lisent dans le tableau ci-dessus (colonne Taux de conformité).",
    ]
    for crit in ["1.1", "3.2", "6.1"]:
        pc = scores.get("per_criterion", {}).get(crit, {})
        name = pc.get("name", crit)
        if pc.get("nc"):
            lines.append("Le critère " + name + " est à corriger : " + str(pc["nc"]) + " test(s) non conforme(s). Voir les exemples dans l'onglet Audit.")
        elif pc.get("nt"):
            lines.append("Le critère " + name + " contient des points Non testés : à contrôler à la main avant de conclure.")
        else:
            lines.append("Le critère " + name + " est conforme sur les pages auditées : point fort du site.")
    lines.append("Chaque correction est détaillée dans l'onglet Préconisations, puis répartie dans l'onglet Plan pluriannuel.")
    for line in lines:
        c = ws.cell(rr, 1, line)
        c.font = Font(name="Arial", size=11, color=BODY)
        c.alignment = WRAP
        ws.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=7)
        ws.row_dimensions[rr].height = row_h([(line, 118)], extra=4)
        rr += 1
    sect(rr + 1, "Historique des audits")
    hh = rr + 2
    for h, c1, c2 in [("Date", 1, 1), ("Étendue", 2, 4), ("Taux global", 5, 5), ("Note", 6, 7)]:
        style_cell(ws.cell(hh, c1, h), font=Font(name="Arial", size=10.5, bold=True, color="FFFFFF"), align=CENTER, fill=NAVY)
        if c2 > c1:
            ws.merge_cells(start_row=hh, start_column=c1, end_row=hh, end_column=c2)
    ws.row_dimensions[hh].height = 20
    style_cell(ws.cell(hh + 1, 1, meta.get("date", "")), align=CENTER)
    style_cell(ws.cell(hh + 1, 2, "3 critères (1.1, 3.2, 6.1), " + str(len(pages)) + " pages"), align=WRAPC)
    ws.merge_cells(start_row=hh + 1, start_column=2, end_row=hh + 1, end_column=4)
    style_cell(ws.cell(hh + 1, 5, "=G17"), font=Font(name="Arial", size=11, bold=True, color="000000"), align=CENTER)
    ws.cell(hh + 1, 5).number_format = "0.0%"
    style_cell(ws.cell(hh + 1, 6, "Premier audit (moteur automatique)."), align=WRAPC)
    ws.merge_cells(start_row=hh + 1, start_column=6, end_row=hh + 1, end_column=7)
    ws.row_dimensions[hh + 1].height = row_h([("3 critères (1.1, 3.2, 6.1), " + str(len(pages)) + " pages", 38), ("Premier audit (moteur automatique).", 33)], extra=4)
    for k in range(1, 4):
        style_cell(ws.cell(hh + 1 + k, 1, ""), align=CENTER)
        style_cell(ws.cell(hh + 1 + k, 2, ""), align=WRAPC)
        ws.merge_cells(start_row=hh + 1 + k, start_column=2, end_row=hh + 1 + k, end_column=4)
        c = style_cell(ws.cell(hh + 1 + k, 5, ""), align=CENTER)
        c.fill = PatternFill("solid", start_color=YELL_F)
        style_cell(ws.cell(hh + 1 + k, 6, ""), align=WRAPC)
        ws.merge_cells(start_row=hh + 1 + k, start_column=6, end_row=hh + 1 + k, end_column=7)
        ws.row_dimensions[hh + 1 + k].height = 18
    note = ws.cell(hh + 6, 1, "À chaque nouvel audit : ajouter une ligne (date, étendue, taux global, note) et mettre à jour le Plan pluriannuel. Les cases jaunes du taux se remplissent à la main.")
    note.font = Font(name="Arial", size=9.5, color=GRAY_TXT)
    ws.row_dimensions[hh + 6].height = 16
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    # ---------------- Préconisations
    ws = wb.create_sheet("Préconisations")
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "C55A11"
    widths = {"A": 6, "B": 12, "C": 42, "D": 48, "E": 16, "F": 11, "G": 11, "H": 12, "I": 13, "J": 22}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    ws.cell(1, 1, "Préconisations pour corriger les non-conformités").font = Font(name="Arial", size=15, bold=True, color=NAVY)
    ws.cell(2, 1, "Une ligne par action. Cet onglet se transmet à l'équipe technique (ou à l'agence chargée des corrections). Les colonnes Priorité, Charge et État ont un menu déroulant.").font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)
    for i, h in enumerate(["N°", "Test RGAA", "Constat (résumé simple)", "Action à faire", "Qui", "Priorité", "Charge", "État", "Échéance", "Commentaire"], 1):
        style_cell(ws.cell(4, i, h), font=Font(name="Arial", size=10.5, bold=True, color="FFFFFF"), align=CENTER, fill=NAVY)
    ws.row_dimensions[4].height = 30
    r = 5
    for p in precos:
        vals = [p["n"], p["test"], p["constat"], p["action"], p["qui"], p["priorite"], p["charge"], p["etat"], p["echeance"], p["commentaire"]]
        for i, val in enumerate(vals, 1):
            if i == 1:
                style_cell(ws.cell(r, i, val), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
            elif i in (6, 7, 8, 9):
                style_cell(ws.cell(r, i, val), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
            else:
                style_cell(ws.cell(r, i, val), align=WRAPC)
        ws.row_dimensions[r].height = row_h([(vals[2], widths["C"]), (vals[3], widths["D"]), (vals[9], widths["J"])], extra=8)
        r += 1
    for dv_, col in [(PRI_LIST, "F"), (CHA_LIST, "G"), (ETA_LIST, "H")]:
        dv = DataValidation(type="list", formula1=dv_, allow_blank=True, showErrorMessage=True)
        dv.errorTitle = "Valeur interdite"
        dv.error = "Choisir une valeur dans la liste."
        ws.add_data_validation(dv)
        dv.add(col + "5:" + col + "40")
    for val, fill, txt in [("Haute", RED_F, RED_T), ("Moyenne", YELL_F, "8A6100"), ("Basse", BLUE_F, BLUE_T)]:
        ws.conditional_formatting.add("F5:F40", CellIsRule(operator="equal", formula=['"' + val + '"'], fill=PatternFill("solid", start_color=fill), font=Font(name="Arial", size=11, bold=True, color=txt)))
    for val, fill, txt in [("Faible", GREEN_F, GREEN_T), ("Moyenne", YELL_F, "8A6100"), ("Élevée", RED_F, RED_T)]:
        ws.conditional_formatting.add("G5:G40", CellIsRule(operator="equal", formula=['"' + val + '"'], fill=PatternFill("solid", start_color=fill), font=Font(name="Arial", size=11, bold=True, color=txt)))
    for val, fill, txt in [("À faire", RED_F, RED_T), ("En cours", YELL_F, "8A6100"), ("Fait", GREEN_F, GREEN_T), ("Reporté", BLUE_F, BLUE_T)]:
        ws.conditional_formatting.add("H5:H40", CellIsRule(operator="equal", formula=['"' + val + '"'], fill=PatternFill("solid", start_color=fill), font=Font(name="Arial", size=11, bold=True, color=txt)))
    ws.auto_filter.ref = "A4:J" + str(r - 1)
    ws.freeze_panes = "C5"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "4:4"

    # ---------------- Plan pluriannuel
    ws = wb.create_sheet("Plan pluriannuel")
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "2E74B5"
    ws.cell(1, 1, "Plan pluriannuel de mise en accessibilité (2026 à 2028)").font = Font(name="Arial", size=15, bold=True, color=NAVY)
    ws.cell(2, 1, "Chaque case de trimestre se remplit avec le menu déroulant : Planifié, En cours, Fait, Reporté. Une case vide veut dire : rien de prévu sur ce trimestre.").font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)
    ws.cell(3, 1, "Principe : en 2026 on corrige ce qui bloque, en 2027 on élargit les critères et on outille les équipes, en 2028 on stabilise et on fait contrôler.").font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)
    ws.cell(4, 1, "Idée clé : chaque ligne du plan reprend les numéros de l'onglet Préconisations, ainsi le plan et les corrections restent toujours en phase.").font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)
    hdr = ["N°", "Action", "Basé sur", "Responsable"] + QUARTERS + ["Livrable attendu"]
    for i, h in enumerate(hdr, 1):
        style_cell(ws.cell(5, i, h), font=Font(name="Arial", size=10.5, bold=True, color="FFFFFF"), align=CENTER, fill=NAVY)
    ws.row_dimensions[5].height = 30
    ws.column_dimensions["A"].width = 6
    ws.column_dimensions["B"].width = 44
    ws.column_dimensions["C"].width = 30
    ws.column_dimensions["D"].width = 16
    for i in range(5, 17):
        ws.column_dimensions[get_column_letter(i)].width = 10
    ws.column_dimensions["Q"].width = 34
    r = 6
    for p in plan:
        style_cell(ws.cell(r, 1, p["n"]), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
        style_cell(ws.cell(r, 2, p["action"]), align=WRAPC)
        style_cell(ws.cell(r, 3, p["base"]), align=WRAPC)
        style_cell(ws.cell(r, 4, p["qui"]), align=WRAPC)
        for qi in range(12):
            style_cell(ws.cell(r, 5 + qi, p["plan"].get(qi, "")), align=CENTER)
        style_cell(ws.cell(r, 17, p["livrable"]), align=WRAPC)
        ws.row_dimensions[r].height = row_h([(p["action"], 44), (p["base"], 30), (p["livrable"], 34)], extra=8)
        r += 1
    dv = DataValidation(type="list", formula1=PLA_LIST, allow_blank=True, showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add("E6:P" + str(r + 4))
    for val, fill, txt in [("Planifié", BLUE_F, BLUE_T), ("En cours", YELL_F, "8A6100"), ("Fait", GREEN_F, GREEN_T), ("Reporté", RED_F, RED_T)]:
        ws.conditional_formatting.add("E6:P" + str(r + 4), CellIsRule(operator="equal", formula=['"' + val + '"'], fill=PatternFill("solid", start_color=fill), font=Font(name="Arial", size=11, bold=True, color=txt)))
    r += 1
    for line in [
        "Comment se servir de ce plan :",
        "Commencer par les priorités Haute de l'onglet Préconisations.",
        "Ne pas placer plus de 2 ou 3 actions sur le même trimestre, sinon rien n'avance.",
        "Quand une action est terminée, mettre Fait dans le trimestre concerné et noter le livrable dans la dernière colonne.",
    ]:
        c = ws.cell(r, 1, line)
        c.font = Font(name="Arial", size=11, bold=True, color=NAVY) if line.endswith(":") else Font(name="Arial", size=11, color=BODY)
        c.alignment = WRAP
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=17)
        ws.row_dimensions[r].height = row_h([(line, 195)], extra=4)
        r += 1
    ws.freeze_panes = "E6"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "5:5"

    # ---------------- Référentiel RGAA
    ws = wb.create_sheet("Référentiel RGAA")
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "808080"
    widths = {"A": 9, "B": 9, "C": 46, "D": 62, "E": 40, "F": 26}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    ws.cell(1, 1, "Référentiel RGAA version 4.1.2, extraits des critères 1.1, 3.2 et 6.1").font = Font(name="Arial", size=15, bold=True, color=NAVY)
    ws.cell(2, 1, "Source : https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/ (site officiel). Le texte est condensé pour rester lisible.").font = Font(name="Arial", size=10.5, color=GRAY_TXT, italic=True)
    for i, h in enumerate(["Critère", "Test", "Intitulé officiel du test", "Points de vérification (méthodologie officielle)", "Cas particuliers", "Références WCAG"], 1):
        style_cell(ws.cell(4, i, h), font=Font(name="Arial", size=10.5, bold=True, color="FFFFFF"), align=CENTER, fill=NAVY)
    ws.row_dimensions[4].height = 30
    CP11 = "Images utilisées comme CAPTCHA ou comme image-test : critère non applicable (le cas est traité par le critère 1.4)."
    CP32 = "Le texte fait partie d'un logo ou d'un nom de marque ; le texte est purement décoratif ; le texte fait partie d'une image mais n'apporte aucune information essentielle ; le texte appartient à un élément d'interface sans action possible (bouton désactivé)."
    CP61 = "Si le lien est ambigu pour tout le monde et qu'il est impossible de le rendre explicite dans son contexte, le critère est non applicable. Pour 6.1.5 : ponctuation et majuscules peuvent être ignorées ; si l'intitulé visible sert de symbole, le nom accessible exprime la fonction (exemple : B devient Mettre en gras)."
    refrows = [
        ("1.1", "Critère 1.1", "Chaque image porteuse d'information a-t-elle une alternative textuelle ?", "Ce critère se vérifie par les 8 tests listés en dessous (1.1.1 à 1.1.8).", CP11, "WCAG 2.1 : 1.1.1 (A) et 4.1.2 (A)"),
        ("1.1", "1.1.1", "Chaque image (balise img ou balise avec role=\"img\") porteuse d'information a-t-elle une alternative textuelle ?", "Trouver les images img et les éléments avec role=\"img\". Déterminer si l'image est porteuse d'information. Vérifier la présence d'au moins une alternative : aria-labelledby, aria-label, alt ou title (pour role=\"img\" : aria-labelledby ou aria-label uniquement). Le test est validé si une alternative est trouvée.", "", "WCAG 2.1 : 1.1.1 (A)"),
        ("1.1", "1.1.2", "Chaque zone d'une image réactive (balise area) porteuse d'information a-t-elle une alternative textuelle ?", "Trouver les balises area. Déterminer si la zone est porteuse d'information. Vérifier la présence d'un attribut alt ou d'un aria-label.", "", ""),
        ("1.1", "1.1.3", "Chaque bouton de type image (input type=\"image\") a-t-il une alternative textuelle ?", "Trouver les input type=\"image\". Déterminer si l'image est porteuse d'information. Vérifier la présence d'une alternative : aria-labelledby, aria-label, alt ou title.", "", ""),
        ("1.1", "1.1.4", "Chaque zone cliquable d'une image réactive côté serveur est-elle doublée d'un mécanisme utilisable quel que soit le dispositif de pointage ?", "Trouver les images avec l'attribut ismap. Vérifier qu'un lien ou un ensemble de liens permet d'accéder aux mêmes ressources que lors du clic sur l'image.", "", ""),
        ("1.1", "1.1.5", "Chaque image vectorielle (balise svg) porteuse d'information vérifie-t-elle role=\"img\" et une alternative ?", "Trouver les balises svg. Déterminer si l'image est porteuse d'information. Vérifier role=\"img\" (sinon le test est invalidé). Vérifier une alternative : élément title, aria-labelledby ou aria-label.", "", ""),
        ("1.1", "1.1.6", "Chaque image objet (balise object avec type=\"image/…\") porteuse d'information vérifie-t-elle une des conditions prévues ?", "Trouver les balises object de type image. Vérifier role=\"img\" et une alternative (aria-labelledby, aria-label ou title). Sinon vérifier qu'un lien ou bouton adjacent donne accès à un contenu alternatif, ou qu'un mécanisme permet de remplacer l'objet.", "", ""),
        ("1.1", "1.1.7", "Chaque image embarquée (balise embed avec type=\"image/…\") porteuse d'information vérifie-t-elle une des conditions prévues ?", "Même logique que 1.1.6, pour les balises embed de type image.", "", ""),
        ("1.1", "1.1.8", "Chaque image bitmap (balise canvas) porteuse d'information vérifie-t-elle une des conditions prévues ?", "Trouver les balises canvas porteuses d'information. Vérifier role=\"img\" et une alternative (aria-labelledby ou aria-label). Sinon : contenu alternatif entre les balises canvas, ou lien ou bouton adjacent, ou mécanisme de remplacement.", "", ""),
        ("3.2", "Critère 3.2", "Dans chaque page web, le contraste entre la couleur du texte et la couleur de son arrière-plan est-il suffisamment élevé ?", "Ce critère se vérifie par les 5 tests listés en dessous (3.2.1 à 3.2.5). Seuils : 4,5:1 pour les petits textes, 3:1 pour les grands textes.", CP32, "WCAG 2.1 : 1.4.3 (AA)"),
        ("3.2", "3.2.1", "Le texte sans effet de graisse d'une taille restituée inférieure à 24 px a-t-il un contraste d'au moins 4,5:1 ?", "Trouver les textes (et textes en image) sans graisse de moins de 24 px qui pourraient poser problème. Vérifier un rapport d'au moins 4,5:1, ou un mécanisme qui permet d'afficher le texte à 4,5:1 au moins.", "", ""),
        ("3.2", "3.2.2", "Le texte en gras d'une taille restituée inférieure à 18,5 px a-t-il un contraste d'au moins 4,5:1 ?", "Même méthode que 3.2.1, pour les textes en gras de moins de 18,5 px. Seuil : 4,5:1.", "", ""),
        ("3.2", "3.2.3", "Le texte sans effet de graisse d'une taille restituée d'au moins 24 px a-t-il un contraste d'au moins 3:1 ?", "Même méthode, pour les textes de 24 px et plus. Seuil : 3:1.", "", ""),
        ("3.2", "3.2.4", "Le texte en gras d'une taille restituée d'au moins 18,5 px a-t-il un contraste d'au moins 3:1 ?", "Même méthode, pour les textes en gras de 18,5 px et plus. Seuil : 3:1.", "", ""),
        ("3.2", "3.2.5", "Dans le mécanisme qui affiche un contraste conforme, ce contraste est-il suffisamment élevé ?", "Ce test ne concerne que les pages qui ont un mécanisme d'affichage à contraste conforme. Vérifier que le contraste affiché par ce mécanisme est suffisamment élevé.", "", ""),
        ("6.1", "Critère 6.1", "Chaque lien est-il explicite (hors cas particuliers) ?", "Ce critère se vérifie par les 5 tests listés en dessous (6.1.1 à 6.1.5). Le contexte du lien peut être le paragraphe, l'item de liste, la cellule de tableau ou le titre de section associé.", CP61, "WCAG 2.1 : 1.1.1 (A), 2.4.4 (A) et 2.5.3 (A)"),
        ("6.1", "6.1.1", "Chaque lien texte vérifie-t-il une de ces conditions ?", "Trouver les liens texte. Vérifier que l'intitulé seul, ou l'intitulé plus le contexte, permet de comprendre la fonction et la destination.", "", ""),
        ("6.1", "6.1.2", "Chaque lien image vérifie-t-il une de ces conditions ?", "Trouver les liens image (img, area, object, canvas, svg). Vérifier l'intitulé seul (alternative de l'image) ou le contexte.", "", ""),
        ("6.1", "6.1.3", "Chaque lien composite vérifie-t-il une de ces conditions ?", "Trouver les liens composites (texte plus image). Vérifier l'intitulé seul (texte plus alternative de l'image) ou le contexte.", "", ""),
        ("6.1", "6.1.4", "Chaque lien svg vérifie-t-il une de ces conditions ?", "Trouver les liens svg (svg avec un élément a et un attribut href). Vérifier le nom accessible du svg (souvent le contenu d'un élément text) ou le contexte.", "", ""),
        ("6.1", "6.1.5", "Pour chaque lien ayant un intitulé visible, le nom accessible contient-il au moins l'intitulé visible ?", "Pour chaque lien avec un intitulé visible et un aria-label, aria-labelledby ou title : vérifier que le nom accessible contient l'intitulé visible. Même vérification pour les liens svg. La ponctuation et les majuscules peuvent être ignorées.", "", ""),
    ]
    r = 5
    for row in refrows:
        is_crit = row[1].startswith("Critère")
        for i, val in enumerate(row, 1):
            if is_crit:
                style_cell(ws.cell(r, i, val), font=Font(name="Arial", size=10.5, bold=True, color=NAVY), align=WRAPC, fill=LIGHT_BLUE)
            elif i == 2:
                style_cell(ws.cell(r, i, val), font=Font(name="Arial", size=11, bold=True, color=NAVY), align=CENTER)
            else:
                style_cell(ws.cell(r, i, val), align=WRAPC)
        ws.row_dimensions[r].height = row_h([(row[2], widths["C"]), (row[3], widths["D"]), (row[4], widths["E"]), (row[5], widths["F"])], extra=8)
        r += 1
    ws.freeze_panes = "A5"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "4:4"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def export_filename(res):
    site = (res.get("meta", {}).get("site") or "site").replace("www.", "")
    safe = "".join(ch if ch.isalnum() else "_" for ch in site).strip("_")[:40]
    return "Audit_accessibilite_RGAA_" + safe + ".xlsx"
