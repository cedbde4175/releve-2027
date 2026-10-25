"""Relevé : données complémentaires récupérées automatiquement, chaque jour.

- site/data/fonctions.json : fonctions occupées par chaque candidat, lues dans
  Wikidata (base collaborative, CC0). Le candidat est retrouvé par son nom ;
  il n'est retenu que si une seule personne de nationalité française, active en
  politique, correspond. On peut forcer l'identifiant avec le champ « wikidata »
  dans candidats.json (ou le désactiver avec false).
- site/data/factchecks.json : vérifications publiées par des médias au format
  ClaimReview et mentionnant le candidat, via Google Fact Check Tools. Ne tourne
  que si la variable FACTCHECK_API_KEY est définie (clé gratuite).

Un échec réseau garde les données de la veille. Bibliothèque standard uniquement.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from capture import AGENT, RACINE, ecrire_json, lire_json

DONNEES = RACINE / "site" / "data"
WIKIDATA = "https://www.wikidata.org/w/api.php"
FACTCHECK = "https://factchecktools.googleapis.com/v1alpha1/claims:search"
FRANCE = "Q142"
HUMAIN = "Q5"
POLITIQUE = {"Q82955", "Q372436", "Q1930187"}  # personnalité politique, homme ou femme d'État, journaliste
FACTCHECKS_MAX = 10


def lire(url, params):
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def valeurs(entite, propriete):
    return [c["mainsnak"].get("datavalue", {}).get("value") for c in entite.get("claims", {}).get(propriete, [])
            if c["mainsnak"].get("snaktype") == "value"]


def ids(entite, propriete):
    return {v["id"] for v in valeurs(entite, propriete) if isinstance(v, dict) and "id" in v}


def entites(qids, props="claims|labels|descriptions"):
    resultat = {}
    qids = list(qids)
    for i in range(0, len(qids), 50):
        r = lire(WIKIDATA, {"action": "wbgetentities", "ids": "|".join(qids[i:i + 50]), "props": props,
                            "languages": "fr|en", "format": "json"})
        resultat.update(r.get("entities", {}))
        time.sleep(1)
    return resultat


def libelle(entite):
    labels = entite.get("labels", {})
    return (labels.get("fr") or labels.get("en") or {}).get("value")


def trouver(c):
    if c.get("wikidata") is False:
        return None
    if c.get("wikidata"):
        return c["wikidata"]
    r = lire(WIKIDATA, {"action": "wbsearchentities", "search": f"{c['prenom']} {c['nom']}", "language": "fr",
                        "type": "item", "limit": 7, "format": "json"})
    trouves = [x["id"] for x in r.get("search", [])]
    if not trouves:
        return None
    retenus = []
    for qid, e in entites(trouves, "claims").items():
        if HUMAIN in ids(e, "P31") and FRANCE in ids(e, "P27") and (ids(e, "P106") & POLITIQUE or "P39" in e.get("claims", {})):
            retenus.append(qid)
    return retenus[0] if len(retenus) == 1 else None


def date_wikidata(valeur):
    if not isinstance(valeur, dict) or "time" not in valeur:
        return None
    t, precision = valeur["time"].lstrip("+"), valeur.get("precision", 11)
    return t[:4] if precision <= 9 else t[:7] if precision == 10 else t[:10]


def fonctions(qid):
    e = entites([qid], "claims")[qid]
    lignes = []
    for c in e.get("claims", {}).get("P39", []):
        v = c["mainsnak"].get("datavalue", {}).get("value")
        if not isinstance(v, dict):
            continue
        q = c.get("qualifiers", {})
        debut = date_wikidata((q.get("P580") or [{}])[0].get("datavalue", {}).get("value"))
        fin = date_wikidata((q.get("P582") or [{}])[0].get("datavalue", {}).get("value"))
        lignes.append({"poste": v["id"], "debut": debut, "fin": fin})
    noms = entites({l["poste"] for l in lignes}, "labels") if lignes else {}
    for l in lignes:
        l["intitule"] = libelle(noms.get(l["poste"], {})) or l["poste"]
    return sorted(lignes, key=lambda l: l["debut"] or "", reverse=True)


def maj_fonctions(candidats, maintenant):
    ancien = lire_json(DONNEES / "fonctions.json", {"candidats": {}})
    resultat = {}
    for c in candidats:
        try:
            qid = trouver(c)
            resultat[c["id"]] = {"wikidata": qid, "fonctions": fonctions(qid) if qid else []}
            print(f"{c['id']} : {qid or 'non identifié'}")
        except Exception as ex:
            print(f"{c['id']} : Wikidata indisponible ({ex})", file=sys.stderr)
            if c["id"] in ancien["candidats"]:
                resultat[c["id"]] = ancien["candidats"][c["id"]]
        time.sleep(1)
    ecrire_json(DONNEES / "fonctions.json", {"maj": maintenant, "candidats": resultat})


def maj_factchecks(candidats, cle, maintenant):
    ancien = lire_json(DONNEES / "factchecks.json", {"candidats": {}})
    resultat = {}
    for c in candidats:
        nom = f"{c['prenom']} {c['nom']}"
        try:
            r = lire(FACTCHECK, {"query": nom, "languageCode": "fr", "pageSize": 30, "maxAgeDays": 730, "key": cle})
        except Exception as ex:
            print(f"{c['id']} : Fact Check indisponible ({ex})", file=sys.stderr)
            resultat[c["id"]] = ancien["candidats"].get(c["id"], [])
            continue
        verifications = []
        for claim in r.get("claims", []):
            texte = f"{claim.get('text', '')} {claim.get('claimant', '')}".lower()
            if c["nom"].lower() not in texte:
                continue
            for revue in claim.get("claimReview", []):
                verifications.append({
                    "affirmation": claim.get("text"), "auteur": claim.get("claimant"),
                    "editeur": (revue.get("publisher") or {}).get("name") or (revue.get("publisher") or {}).get("site"),
                    "titre": revue.get("title"), "url": revue.get("url"), "date": revue.get("reviewDate"),
                    "verdict": revue.get("textualRating"),
                })
        verifications.sort(key=lambda v: v["date"] or "", reverse=True)
        resultat[c["id"]] = verifications[:FACTCHECKS_MAX]
        time.sleep(0.5)
    ecrire_json(DONNEES / "factchecks.json", {"maj": maintenant, "candidats": resultat})


def main():
    maintenant = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    candidats = lire_json(DONNEES / "candidats.json", {"candidats": []})["candidats"]
    maj_fonctions(candidats, maintenant)
    cle = os.environ.get("FACTCHECK_API_KEY")
    if cle:
        maj_factchecks(candidats, cle, maintenant)
    else:
        print("FACTCHECK_API_KEY absente : vérifications non mises à jour.")


if __name__ == "__main__":
    main()
