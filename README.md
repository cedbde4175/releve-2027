# Relevé · Présidentielle 2027

Ce qui a changé dans la campagne présidentielle 2027, avec la source. Application Web installable (PWA), sans compte, sans publicité, sans traceur.

Site : https://cedbde4175.github.io/releve-2027/

## Principe

- Le registre est public et statique : des fichiers JSON dans `site/data/`.
- La personnalisation (candidats suivis, date de dernière visite) se calcule dans le navigateur et reste sur l'appareil.
- Chaque jour, GitHub Actions capture le texte des pages officielles suivies, archive toute nouvelle version (`archive/`) et demande une copie à Internet Archive.
- Sur les pages marquées `"auto": true` dans `capture/pages.json` (pages de programme), les phrases de contenu ajoutées ou retirées sont publiées sans relecture dans `site/data/auto.json` : citations exactes, jamais reformulées, avec le texte archivé avant et après. Menus, boutons, lignes communes au site et simples déplacements sont filtrés.
- Les pages d'accueil et agendas (`"auto": false`) restent dans la veille brute, sans carte dans le relevé.
- À chaque publication, `capture/deriver.py` calcule sans IA : une fiche par phrase des pages de programme, suivie à travers toutes les versions archivées (apparition, modifications mot à mot, retrait), classée par thème (mots-clés publics), les paires « phrase retirée / phrase ajoutée » présentées en avant/après, le journal des modifications (lu dans Git) et les flux Atom (`flux.xml`, `flux/<candidat>.xml`).
- Chaque jour, `capture/enrichir.py` lit les fonctions des candidats dans Wikidata et, si le secret `FACTCHECK_API_KEY` existe, les vérifications publiées au format ClaimReview (Google Fact Check Tools, clé gratuite).
- Les pages en PDF sont lues avec `pdftotext` ; une page supprimée (404, 410) est marquée « retirée » avec sa date.
- Aucun texte n'est rédigé ou résumé automatiquement. Les statuts de candidature (`candidats.json`, `evenements.json`) restent mis à jour à la main.

## Arborescence

| Chemin | Rôle |
| --- | --- |
| `site/` | La PWA publiée sur GitHub Pages (HTML, CSS, JS sans dépendance). |
| `site/data/candidats.json` | Fiches : formation, statut daté, certitude, sources, pages suivies. |
| `site/data/evenements.json` | Événements relus qui alimentent le relevé. |
| `site/data/calendrier.json` | Dates de l'élection et leur niveau de certitude. |
| `site/data/sources.json` | Sources citées (éditeur, type, dates de publication et de consultation). |
| `site/data/veille.json` | Généré par la capture : état des pages et différences brutes. |
| `site/data/auto.json` | Généré par la capture : passages ajoutés ou retirés, publiés automatiquement. |
| `site/data/fonctions.json` | Généré : fonctions occupées (Wikidata). Forcer un identifiant : champ `"wikidata": "Q…"` (ou `false`) dans `candidats.json`. |
| `site/data/factchecks.json` | Généré si une clé est fournie : vérifications publiées mentionnant chaque candidat. |
| `site/data/derive.json`, `site/data/journal.json`, `site/flux*` | Générés à la publication (non versionnés) par `capture/deriver.py`. |
| `capture/pages.json` | Liste des pages officielles suivies (`"institution": true` pour les pages officielles sans candidat). |
| `capture/capture.py` | Script de capture (bibliothèque standard Python). |
| `archive/` | Textes capturés, une version par changement. |

## Ajouter un événement relu

Ajouter une entrée dans `site/data/evenements.json` :

```json
{
  "id": "2026-11-02-exemple",
  "date": "2026-11-02",
  "precision": "jour",
  "type": "proposition",
  "candidats": ["attal"],
  "titre": "Titre neutre, sans jugement",
  "citation": "Phrase exacte, copiée de la source, sans reformulation",
  "detail": "Contexte factuel éventuel",
  "sources": ["id-de-la-source"],
  "ajoute_le": "2026-11-02"
}
```

Toute source citée doit exister dans `site/data/sources.json`. Un push sur `main` republie le site en une minute.

## Lancer en local

```sh
python3 -m http.server -d site 8000
python3 capture/capture.py   # capture manuelle
python3 capture/enrichir.py  # fonctions Wikidata (et vérifications si FACTCHECK_API_KEY)
python3 capture/deriver.py   # thèmes, avant/après, journal, flux
```

## Licence

Code sous licence MIT. Données rédigées par Relevé sous Licence Ouverte 2.0. Voir `LICENSE`.
