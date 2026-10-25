"""Relevé : fichiers dérivés, recalculés à chaque publication.

À partir des données publiées et des archives, sans rien rédiger :
- site/data/derive.json : phrases actuelles des pages de programme classées par
  thème (mots-clés publics, sans IA), thèmes des passages publiés, paires
  « phrase retirée / phrase ajoutée » qui se ressemblent (remplacements) ;
- site/data/journal.json : journal des modifications du registre, lu dans
  l'historique Git (les captures automatiques sont exclues) ;
- site/flux.xml et site/flux/<candidat>.xml : flux Atom du relevé.

Bibliothèque standard uniquement.
"""

import difflib
import re
import subprocess
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from capture import (ARCHIVE, ARCHIVE_WEB, AUTO, ETAT, PAGES, RACINE, citer, ecrire_json, est_passage,
                     lignes_du_site, lire_json)

DONNEES = RACINE / "site" / "data"
SITE = "https://cedbde4175.github.io/releve-2027/"
DEPOT = "https://github.com/cedbde4175/releve-2027"
SIMILITUDE_MIN = 0.55
ENTREES_FLUX = 100
BOT = "releve-bot"

# Mots-clés par thème, comparés sans accents ni majuscules, en début de mot.
# Une phrase peut relever de plusieurs thèmes ; aucune phrase n'est résumée.
THEMES = [
    ("pouvoir-achat", "Pouvoir d'achat et salaires",
     ["pouvoir d'achat", "salaire", "smic", "prix", "inflation", "fin du mois", "revenu", "cheque", "carburant",
      "facture"]),
    ("retraites", "Retraites", ["retraite", "pension", "age de depart", "age legal", "annuites", "trimestres"]),
    ("logement", "Logement", ["logement", "loyer", "locataire", "proprietaire", "hlm", "immobilier",
                              "accession", "sans-abri", "habitat", "loger"]),
    ("sante", "Santé", ["sante", "hopita", "medecin", "soignant", "deserts medicaux", "securite sociale",
                        "assurance maladie", "medicament", "infirmi", "urgences", "dependance", "ehpad"]),
    ("education", "Éducation et jeunesse", ["ecole", "education", "enseignant", "eleve", "college", "lycee",
                                            "universit", "etudiant", "professeur", "jeunesse", "apprentissage",
                                            "bac"]),
    ("securite-justice", "Sécurité et justice", ["securite", "police", "gendarme", "delinquan", "justice",
                                                 "prison", "penal", "narcotrafic", "drogue", "terroris",
                                                 "violence", "magistrat", "crime", "criminal"]),
    ("immigration", "Immigration et frontières", ["immigr", "migrant", "frontiere", "asile", "titre de sejour",
                                                  "regularisation", "expulsion", "naturalisation", "oqtf",
                                                  "etranger"]),
    ("ecologie-energie", "Écologie et énergie", ["ecolog", "climat", "carbone", "energie", "nucleaire",
                                                 "renouvelable", "biodiversite", "environnement", "pollution",
                                                 "eolien", "solaire", "agricult"]),
    ("economie-dette", "Économie, dette et impôts", ["dette", "deficit", "impot", "fiscal", "taxe", "budget",
                                                     "depense publique", "economie", "croissance", "entreprise",
                                                     "industri", "tva", "prelevement"]),
    ("travail-emploi", "Travail et emploi", ["travail", "emploi", "chomage", "travailleur", "salarie",
                                             "temps de travail", "35 heures", "france travail", "rsa",
                                             "syndica"]),
    ("institutions", "Institutions et démocratie", ["institution", "democrat", "constitution", "referendum",
                                                    "proportionnelle", "parlement", "assemblee", "senat",
                                                    "decentralisation", "laicite"]),
    ("europe-international", "Europe, défense et international", ["europe", "defense", "armee", "militaire",
                                                                  "ukraine", "russie", "otan", "diplomat",
                                                                  "international", "souverainete", "guerre"]),
    ("numerique", "Numérique et intelligence artificielle", ["numerique", "intelligence artificielle", "ia ",
                                                             "internet", "reseaux sociaux", "donnees",
                                                             "technolog", "ecrans"]),
]


def sans_accents(texte):
    texte = unicodedata.normalize("NFD", texte.lower().replace("’", "'"))
    return "".join(c for c in texte if unicodedata.category(c) != "Mn")


MOTIFS = [(tid, re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(m) for m in mots) + ")"))
          for tid, _, mots in THEMES]


def themes_de(texte):
    t = sans_accents(texte) + " "
    return [tid for tid, motif in MOTIFS if motif.search(t)]


def phrases_actuelles(pages, etat):
    """Lignes de contenu de la dernière version de chaque page de programme, telles quelles."""
    phrases = []
    for page in pages:
        if not page.get("auto"):
            continue
        versions = etat.get(page["id"], {}).get("versions", [])
        if not versions:
            continue
        derniere = versions[-1]
        try:
            texte = (ARCHIVE / derniere["fichier"]).read_text(encoding="utf-8")
        except FileNotFoundError:
            continue
        exclues = lignes_du_site(page["id"], page["url"], pages, etat)
        vues = set()
        for n, ligne in enumerate(texte.split("\n")):
            if ligne in vues or not est_passage(ligne, exclues):
                continue
            vues.add(ligne)
            citation, tronquee = citer(ligne)
            phrases.append({
                "id": f"{page['id']}-{n}", "candidat": page["candidat"], "page": page["id"],
                "libelle": page["libelle"], "url": page["url"], "archive": ARCHIVE_WEB + derniere["fichier"],
                "date": derniere["date"], "texte": citation, "tronquee": tronquee, "themes": themes_de(ligne),
            })
    return phrases


def diff_mots(avant, apres):
    """Différence mot à mot entre deux citations exactes : [["=", "..."], ["-", "..."], ["+", "..."]]."""
    a, b = avant.split(" "), apres.split(" ")
    morceaux = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            morceaux.append(["=", " ".join(a[i1:i2])])
        else:
            if i2 > i1:
                morceaux.append(["-", " ".join(a[i1:i2])])
            if j2 > j1:
                morceaux.append(["+", " ".join(b[j1:j2])])
    return morceaux


def remplacements(passages):
    """Associe, pour une même capture d'une même page, chaque phrase retirée à la phrase ajoutée la plus proche."""
    groupes = {}
    for p in passages:
        groupes.setdefault(p["id"].rsplit("-", 1)[0], []).append(p)
    paires = []
    for groupe in groupes.values():
        retraits = [p for p in groupe if p["sens"] == "retrait"]
        ajouts = [p for p in groupe if p["sens"] == "ajout"]
        candidats = []
        for r in retraits:
            for a in ajouts:
                ratio = difflib.SequenceMatcher(None, r["citation"], a["citation"], autojunk=False).ratio()
                if ratio >= SIMILITUDE_MIN:
                    candidats.append((ratio, r, a))
        pris = set()
        for ratio, r, a in sorted(candidats, key=lambda x: -x[0]):
            if r["id"] in pris or a["id"] in pris:
                continue
            pris.update((r["id"], a["id"]))
            paires.append({"retrait": r["id"], "ajout": a["id"], "similitude": round(ratio, 2),
                           "diff": diff_mots(r["citation"], a["citation"])})
    return paires


def journal():
    """Modifications du registre faites à la main ou par le code, lues dans Git."""
    chemins = ["site/data/candidats.json", "site/data/evenements.json", "site/data/calendrier.json",
               "site/data/sources.json", "capture/pages.json"]
    try:
        sortie = subprocess.run(
            ["git", "log", "--format=%H%x1f%aI%x1f%an%x1f%s", "--", *chemins],
            cwd=RACINE, capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    entrees = []
    for ligne in sortie.splitlines():
        sha, date, auteur, sujet = ligne.split("\x1f")
        if auteur == BOT:
            continue
        fichiers = subprocess.run(["git", "show", "--name-only", "--format=", sha, "--", *chemins],
                                  cwd=RACINE, capture_output=True, text=True).stdout.split()
        entrees.append({"date": date, "message": sujet, "fichiers": [Path(f).name for f in fichiers],
                        "lien": f"{DEPOT}/commit/{sha}"})
    return entrees


def nom(c):
    return f"{c['prenom']} {c['nom']}"


def entrees_flux(candidats, evenements, passages, paires):
    par_id = {c["id"]: c for c in candidats}
    remplaces = {}
    for p in paires:
        remplaces[p["retrait"]] = p
        remplaces[p["ajout"]] = p
    passages_par_id = {p["id"]: p for p in passages}
    entrees = []
    for e in evenements:
        qui = ", ".join(nom(par_id[i]) for i in e.get("candidats", []) if i in par_id)
        contenu = (f"« {e['citation']} »\n\n" if e.get("citation") else "") + (e.get("detail") or "")
        entrees.append({"id": f"evenement-{e['id']}", "date": f"{e.get('ajoute_le') or e.get('date')}T00:00:00+00:00",
                        "titre": f"{qui} : {e['titre']}" if qui else e["titre"], "contenu": contenu,
                        "lien": SITE + "#/releve", "candidats": e.get("candidats", [])})
    vus = set()
    for p in passages:
        if p["id"] in vus:
            continue
        c = par_id.get(p["candidat"])
        qui = nom(c) if c else p["libelle"]
        paire = remplaces.get(p["id"])
        if paire:
            vus.update((paire["retrait"], paire["ajout"]))
            avant = passages_par_id[paire["retrait"]]["citation"]
            apres = passages_par_id[paire["ajout"]]["citation"]
            titre = f"{qui} : phrase modifiée sur « {p['libelle']} »"
            contenu = f"Avant : « {avant} »\n\nAprès : « {apres} »"
        else:
            titre = f"{qui} : phrase {'ajoutée sur' if p['sens'] == 'ajout' else 'retirée de'} « {p['libelle']} »"
            contenu = f"« {p['citation']} »"
        contenu += f"\n\nPage officielle : {p['url']}\nTexte archivé : {p['archive_apres'] if p['sens'] == 'ajout' else p['archive_avant']}"
        entrees.append({"id": f"passage-{p['id']}", "date": p["date"], "titre": titre, "contenu": contenu,
                        "lien": SITE + "#/releve", "candidats": [p["candidat"]]})
    return sorted(entrees, key=lambda x: x["date"], reverse=True)


def atom(titre, adresse, entrees, maj):
    morceaux = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">',
        f"  <title>{escape(titre)}</title>",
        f'  <link rel="self" href="{escape(adresse)}"/>',
        f'  <link rel="alternate" href="{SITE}"/>',
        f"  <id>{escape(adresse)}</id>",
        f"  <updated>{maj}</updated>",
        "  <author><name>Relevé</name></author>",
        "  <subtitle>Ce qui a changé dans la campagne présidentielle 2027, en citations exactes avec la source.</subtitle>",
    ]
    for e in entrees[:ENTREES_FLUX]:
        morceaux += [
            "  <entry>",
            f"    <title>{escape(e['titre'])}</title>",
            f'    <link href="{escape(e["lien"])}"/>',
            f"    <id>{escape(SITE + '#' + e['id'])}</id>",
            f"    <updated>{escape(e['date'])}</updated>",
            f'    <content type="text">{escape(e["contenu"])}</content>',
            "  </entry>",
        ]
    morceaux.append("</feed>")
    return "\n".join(morceaux) + "\n"


def main():
    maj = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    pages = lire_json(PAGES, {"pages": []})["pages"]
    etat = lire_json(ETAT, {})
    passages = lire_json(AUTO, {"passages": []}).get("passages", [])
    candidats = lire_json(DONNEES / "candidats.json", {"candidats": []}).get("candidats", [])
    evenements = lire_json(DONNEES / "evenements.json", {"evenements": []}).get("evenements", [])

    paires = remplacements(passages)
    ecrire_json(DONNEES / "derive.json", {
        "maj": maj,
        "themes": [{"id": tid, "libelle": libelle, "mots": mots} for tid, libelle, mots in THEMES],
        "pages_programme": [p["id"] for p in pages if p.get("auto") and etat.get(p["id"], {}).get("versions")],
        "phrases": phrases_actuelles(pages, etat),
        "themes_passages": {p["id"]: themes_de(p["citation"]) for p in passages},
        "themes_evenements": {e["id"]: themes_de(" ".join(filter(None, [e.get("titre"), e.get("citation")])))
                              for e in evenements},
        "paires": paires,
    })
    ecrire_json(DONNEES / "journal.json", {"maj": maj, "entrees": journal()})

    entrees = entrees_flux(candidats, evenements, passages, paires)
    (RACINE / "site" / "flux.xml").write_text(
        atom("Relevé · Présidentielle 2027", SITE + "flux.xml", entrees, maj), encoding="utf-8")
    dossier = RACINE / "site" / "flux"
    dossier.mkdir(exist_ok=True)
    for c in candidats:
        siennes = [e for e in entrees if c["id"] in e["candidats"]]
        (dossier / f"{c['id']}.xml").write_text(
            atom(f"Relevé · {nom(c)}", f"{SITE}flux/{c['id']}.xml", siennes, maj), encoding="utf-8")
    print(f"{len(paires)} remplacements, {len(entrees)} entrées de flux")


if __name__ == "__main__":
    main()
