# Conforme : plateforme d'audit d'accessibilité numérique

Conforme est une plateforme web qui produit un audit d'accessibilité numérique complet à partir d'une seule entrée : l'adresse d'un site. Vous collez le lien, la plateforme ouvre les pages, les examine, et rend un rapport RGAA détaillé, exportable en Excel, prêt à transmettre à une autre personne.

Plateforme en ligne : https://rodainaali2004-arch.github.io/conforme/

## Le parcours d'un audit

1. **Une seule entrée.** Vous collez l'adresse du site (exemple : `www.votre-site.fr`). Aucune connexion, aucun mot de passe.
2. **L'échantillon.** La plateforme retient la page d'accueil et jusqu'à 4 pages internes du même site (les liens de navigation d'abord).
3. **Les mesures.** Chaque page est chargée dans un navigateur interne sans script, puis examinée : images et alternatives textuelles, liens et noms accessibles, contrastes de texte mesurés un par un avec leur fond réel.
4. **Les verdicts.** Chaque test reçoit un résultat : Conforme, Non conforme, Non testé ou Non applicable. Les non conformités sont illustrées par des exemples précis (page et élément en cause).
5. **Le rapport.** Scores de conformité, préconisations rédigées en français simple, plan pluriannuel sur trois ans, et export Excel à six onglets avec menus déroulants pré-remplis.

## Ce qui est mesuré

La plateforme applique les critères 1.1, 3.2 et 6.1 du RGAA version 4.1.2, soit 18 tests :

| Critère | Thème | Tests |
| --- | --- | --- |
| 1.1 | Images | 1.1.1 à 1.1.8 : alternative textuelle des images (`img`, `area`, boutons image, `svg`, `object`, `embed`, `canvas`) |
| 3.2 | Contrastes | 3.2.1 à 3.2.5 : contraste du texte et de son fond (4,5:1 en petit texte, 3:1 en grand texte) |
| 6.1 | Liens | 6.1.1 à 6.1.5 : liens explicites (texte, image, composite, svg, nom accessible) |

La méthode de mesure est celle du référentiel : le nom accessible des liens est calculé comme un lecteur d'écran le ferait (aria-labelledby, aria-label, contenu, alternative des images, title), et le contraste est calculé entre la couleur du texte et son fond effectif, seuils 4,5:1 et 3:1 selon la taille et la graisse.

## Les scores

Pour chaque critère : taux de conformité = tests conformes / tests applicables. Les non applicables et les non testés ne comptent pas dans le taux.

- Taux global : tous les tests confondus.
- Taux moyen : la moyenne des taux des 3 critères.

## Le rapport et l'export Excel

Chaque audit produit :

- une plaque de verdict (taux global, taux moyen, pages auditées) ;
- le détail des 18 tests, test par test, avec les vérifications à faire et les exemples relevés ;
- les points que la machine ne peut pas juger seule, marqués Non testé et à contrôler à la main ;
- des préconisations numérotées, avec priorité, charge et responsable ;
- un plan pluriannuel sur 2026 à 2028, trimestre par trimestre ;
- un classeur Excel à six onglets : Mode d'emploi, Audit, Synthèse, Préconisations, Plan pluriannuel, Référentiel RGAA. Dans l'onglet Audit, chaque test a un menu déroulant (Conforme, Non conforme, Non testé, Non applicable) déjà rempli avec le résultat de l'analyse. Les scores de la Synthèse se calculent par formules et se mettent à jour tout seuls si on modifie les résultats ou si on ajoute des tests.

## Les limites (dites honnêtement)

- L'audit automatique ne juge pas le sens des images ni le contexte des liens : ces points passent en Non testé, à contrôler à la main.
- Les pages qui demandent une connexion (compte, paiement) ne sont pas auditées.
- En mode navigateur, le code des pages passe par un relais CORS public : certains sites refusent, l'audit s'arrête alors avec un message clair.
- Le contenu ajouté par JavaScript après chargement (infinite scroll, popins) peut échapper à l'analyse du mode navigateur.

## Deux modes de fonctionnement

### Mode navigateur (celui du site publié)

Tout se passe dans le navigateur du visiteur, sans serveur et sans installation. Le code des pages est récupéré par un relais CORS public puis analysé localement dans un iframe : les pages auditées ne reçoivent aucune visite automatisée côté serveur.

### Mode serveur (local, plus profond)

Le dépôt contient aussi un moteur serveur en Python qui ouvre les pages dans un vrai Chromium (Playwright) : DOM rendu après JavaScript, défis anti-robot attendus patiemment, contrastes mesurés sur le rendu final.

```zsh
cd serveur
./run.sh
```

Puis ouvrir http://127.0.0.1:8791 : le site détecte le serveur local tout seul et passe en mode serveur, avec le même rapport et un export Excel recalculé par LibreOffice.

## L'accessibilité de la plateforme elle-même

Conforme applique à elle-même ce qu'elle audite :

- claire et sombre automatiquement (suivi du réglage système, choix possible dans la barre) ;
- couleur jamais utilisée seule : chaque verdict porte son texte ;
- contrastes AA vérifiés sur les deux apparences ;
- structure sémantique : titre, repères, listes, libellés, accordéons natifs utilisables au clavier ;
- animations discrètes, supprimées quand le système demande une réduction des mouvements ;
- cibles tactiles d'au moins 44 px.

## Structure du dépôt

| Chemin | Rôle |
| --- | --- |
| `index.html` | l'interface de la plateforme |
| `styles.css` | le design (apparences claire et sombre, barre en Liquid Glass) |
| `app.js` | l'interface : journal d'audit en direct, rapport, export |
| `moteur.js` | le moteur d'analyse en mode navigateur |
| `export-excel.js` | la génération du classeur Excel dans le navigateur (ExcelJS) |
| `vendor/exceljs.min.js` | bibliothèque ExcelJS |
| `serveur/` | le moteur serveur (Flask + Playwright) pour une analyse plus profonde |

## Sources

- RGAA version 4.1.2 : https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/
- Les recommandations de design de la plateforme suivent les Human Interface Guidelines d'Apple.
