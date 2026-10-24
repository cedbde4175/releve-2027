"""Relevé : capture planifiée des pages officielles suivies.

Pour chaque page de capture/pages.json :
- télécharge la page (en respectant robots.txt) et en extrait le texte visible ;
- compare l'empreinte du texte à la dernière capture ;
- si le texte a changé, archive la nouvelle version dans archive/<page>/,
  demande une copie à Internet Archive et note le changement.

Les changements détectés sont publiés dans site/data/veille.json comme
« modifications détectées, non relues ». Aucune proposition n'est créée
automatiquement : la relecture humaine reste obligatoire.

Bibliothèque standard uniquement, pour tourner gratuitement sur GitHub Actions.
"""

import difflib
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

RACINE = Path(__file__).resolve().parent.parent
PAGES = RACINE / "capture" / "pages.json"
ARCHIVE = RACINE / "archive"
ETAT = ARCHIVE / "etat.json"
VEILLE = RACINE / "site" / "data" / "veille.json"
RAPPORT = RACINE / "capture" / "rapport.md"

AGENT = "ReleveBot/0.1 (veille non commerciale de pages de programmes ; https://github.com/cedbde4175/releve-2027)"
DELAI = 30
TEXTE_MIN = 200
EXTRAITS_MAX = 8
LONGUEUR_EXTRAIT = 280
CHANGEMENTS_MAX = 300

IGNORER = {"script", "style", "noscript", "svg", "template", "iframe", "head"}
BLOCS = {
    "p", "div", "section", "article", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "br", "tr", "td", "th", "table", "header", "footer", "main", "nav", "aside", "blockquote",
    "figcaption", "dd", "dt", "hr", "form", "label", "button", "option",
}


class Texte(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.morceaux = []
        self.ignore = 0

    def handle_starttag(self, tag, attrs):
        if tag in IGNORER:
            self.ignore += 1
        elif tag in BLOCS:
            self.morceaux.append("\n")

    def handle_endtag(self, tag):
        if tag in IGNORER:
            self.ignore = max(0, self.ignore - 1)
        elif tag in BLOCS:
            self.morceaux.append("\n")

    def handle_data(self, data):
        if not self.ignore:
            self.morceaux.append(data)


def extraire_texte(html):
    p = Texte()
    p.feed(html)
    lignes = []
    for ligne in "".join(p.morceaux).split("\n"):
        ligne = re.sub(r"\s+", " ", ligne).strip()
        if ligne and (not lignes or lignes[-1] != ligne):
            lignes.append(ligne)
    return "\n".join(lignes)


def maintenant():
    return datetime.now(timezone.utc).replace(microsecond=0)


def autorise(url, robots_cache):
    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    if base not in robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": AGENT})
            with urllib.request.urlopen(req, timeout=DELAI) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as e:
            # robots.txt absent : tout est autorisé ; accès refusé : on s'abstient.
            rp.parse([] if e.code == 404 else ["User-agent: *", "Disallow: /"])
        except Exception:
            rp.parse([])
        robots_cache[base] = rp
    return robots_cache[base].can_fetch(AGENT, url)


def telecharger(url):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept-Language": "fr-FR,fr;q=0.9"})
    with urllib.request.urlopen(req, timeout=DELAI) as r:
        brut = r.read()
        jeu = r.headers.get_content_charset() or "utf-8"
        return brut.decode(jeu, "replace"), r.headers.get_content_type()


def demander_wayback(url):
    """Demande une copie à Internet Archive. Au mieux : un échec n'arrête rien."""
    try:
        req = urllib.request.Request("https://web.archive.org/save/" + url, headers={"User-Agent": AGENT})
        with urllib.request.urlopen(req, timeout=90) as r:
            lieu = r.headers.get("Content-Location")
            if lieu:
                return "https://web.archive.org" + lieu
            if "/web/" in r.geturl():
                return r.geturl()
    except Exception as e:
        print(f"  wayback indisponible : {e}", file=sys.stderr)
    return None


def couper(ligne):
    return ligne if len(ligne) <= LONGUEUR_EXTRAIT else ligne[: LONGUEUR_EXTRAIT - 1] + "…"


def comparer(avant, apres):
    a, b = avant.split("\n"), apres.split("\n")
    ajouts, retraits = [], []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op in ("replace", "delete"):
            retraits.extend(a[i1:i2])
        if op in ("replace", "insert"):
            ajouts.extend(b[j1:j2])
    return {
        "lignes_ajoutees": len(ajouts),
        "lignes_retirees": len(retraits),
        "extraits_ajoutes": [couper(x) for x in ajouts[:EXTRAITS_MAX]],
        "extraits_retires": [couper(x) for x in retraits[:EXTRAITS_MAX]],
    }


def lire_json(chemin, defaut):
    try:
        return json.loads(chemin.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return defaut


def ecrire_json(chemin, donnees):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(json.dumps(donnees, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main():
    pages = lire_json(PAGES, {"pages": []})["pages"]
    etat = lire_json(ETAT, {})
    veille = lire_json(VEILLE, {"pages": [], "changements": []})
    changements = veille.get("changements", [])
    robots = {}
    t = maintenant()
    horodatage = t.strftime("%Y-%m-%dT%H%MZ")
    nouveaux = []

    for page in pages:
        pid, url = page["id"], page["url"]
        e = etat.setdefault(pid, {"versions": []})
        e["derniere_tentative"] = t.isoformat()
        print(f"{pid} : {url}")
        if not autorise(url, robots):
            e["statut"] = "refus_robots"
            print("  refusé par robots.txt")
            continue
        try:
            html, type_ = telecharger(url)
        except Exception as ex:
            e["statut"] = "erreur"
            e["erreur"] = str(ex)[:200]
            print(f"  erreur : {ex}")
            continue
        if "html" not in type_:
            e["statut"] = "format_non_suivi"
            continue
        texte = extraire_texte(html)
        e.pop("erreur", None)
        e["statut"] = "ok" if len(texte) >= TEXTE_MIN else "texte_insuffisant"
        e["derniere_reussite"] = t.isoformat()
        empreinte = hashlib.sha256(texte.encode("utf-8")).hexdigest()
        precedente = e["versions"][-1] if e["versions"] else None
        if precedente and precedente["empreinte"] == empreinte:
            print("  inchangée")
            continue

        fichier = f"{pid}/{horodatage}.txt"
        (ARCHIVE / pid).mkdir(parents=True, exist_ok=True)
        (ARCHIVE / fichier).write_text(texte + "\n", encoding="utf-8")
        version = {"date": t.isoformat(), "empreinte": empreinte, "fichier": fichier,
                   "caracteres": len(texte), "wayback": demander_wayback(url)}
        e["versions"].append(version)

        if precedente:
            avant = (ARCHIVE / precedente["fichier"]).read_text(encoding="utf-8").rstrip("\n")
            diff = comparer(avant, texte)
            if diff["lignes_ajoutees"] or diff["lignes_retirees"]:
                ch = {"id": f"{pid}-{horodatage}", "date": t.isoformat(), "page": pid,
                      "candidat": page["candidat"], "url": url, "libelle": page["libelle"],
                      "wayback_avant": precedente.get("wayback"), "wayback_apres": version["wayback"],
                      "releve": False, **diff}
                changements.append(ch)
                nouveaux.append(ch)
                print(f"  modifiée : +{diff['lignes_ajoutees']} / -{diff['lignes_retirees']} lignes")
        else:
            print("  première capture")

    ecrire_json(ETAT, etat)
    resume = []
    for page in pages:
        e = etat.get(page["id"], {})
        versions = e.get("versions", [])
        resume.append({**page, "statut": e.get("statut", "jamais"),
                       "derniere_tentative": e.get("derniere_tentative"),
                       "derniere_reussite": e.get("derniere_reussite"),
                       "premiere_capture": versions[0]["date"] if versions else None,
                       "derniere_version": versions[-1]["date"] if versions else None,
                       "nombre_versions": len(versions),
                       "wayback": next((v["wayback"] for v in reversed(versions) if v.get("wayback")), None)})
    ecrire_json(VEILLE, {"maj": t.isoformat(), "pages": resume,
                         "changements": changements[-CHANGEMENTS_MAX:]})

    if nouveaux:
        lignes = [f"Capture du {t.strftime('%d/%m/%Y %H:%M')} UTC : {len(nouveaux)} page(s) modifiée(s), à relire.\n"]
        for ch in nouveaux:
            lignes.append(f"### {ch['libelle']}\n{ch['url']}\n")
            lignes.append(f"+{ch['lignes_ajoutees']} / -{ch['lignes_retirees']} lignes\n")
            for x in ch["extraits_ajoutes"]:
                lignes.append(f"> + {x}")
            for x in ch["extraits_retires"]:
                lignes.append(f"> − {x}")
            lignes.append("")
        lignes.append("Rien n'est publié comme proposition sans relecture : si un changement concerne une proposition, "
                      "l'ajouter à site/data/evenements.json avec la citation exacte et sa source.")
        RAPPORT.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    elif RAPPORT.exists():
        RAPPORT.unlink()


if __name__ == "__main__":
    main()
