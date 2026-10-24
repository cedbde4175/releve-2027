# Relevé · Présidentielle 2027

Ce qui a changé dans la campagne présidentielle 2027, avec la source. Application Web installable (PWA), sans compte, sans publicité, sans traceur.

Site : https://cedbde4175.github.io/releve-2027/

## Principe

- Le registre est public et statique : des fichiers JSON dans `site/data/`.
- La personnalisation (candidats suivis, date de dernière visite) se calcule dans le navigateur et reste sur l'appareil.
- Chaque jour, GitHub Actions capture le texte des pages officielles suivies, archive toute nouvelle version (`archive/`), demande une copie à Internet Archive et ouvre un ticket « relecture » si une page a changé.
- Rien n'est publié comme proposition sans relecture humaine, avec la phrase exacte, sa date et une source primaire.

## Arborescence

| Chemin | Rôle |
| --- | --- |
| `site/` | La PWA publiée sur GitHub Pages (HTML, CSS, JS sans dépendance). |
| `site/data/candidats.json` | Fiches : formation, statut daté, certitude, sources, pages suivies. |
| `site/data/evenements.json` | Événements relus qui alimentent le relevé. |
| `site/data/calendrier.json` | Dates de l'élection et leur niveau de certitude. |
| `site/data/sources.json` | Sources citées (éditeur, type, dates de publication et de consultation). |
| `site/data/veille.json` | Généré par la capture : état des pages et modifications détectées. |
| `capture/pages.json` | Liste des pages officielles suivies. |
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
```

## Licence

Code sous licence MIT. Données rédigées par Relevé sous Licence Ouverte 2.0. Voir `LICENSE`.
