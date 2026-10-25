// Relevé : tout est calculé dans le navigateur à partir des fichiers JSON publiés.
// Les suivis et la date de dernière visite restent sur l'appareil (localStorage).

const DEPOT = "https://github.com/cedbde4175/releve-2027";
const CLE = "releve.v1";
const JOUR = 86400000;

const LIBELLES_STATUT = {
  intention: "Intention annoncée",
  declaree: "Candidature déclarée",
  investie: "Investiture",
  officielle: "Candidature officielle",
  retiree: "Retrait",
};
const LIBELLES_CERTITUDE = { sur: "Sûr", incertain: "Incertain", conteste: "Contesté" };
const LIBELLES_TYPE_SOURCE = {
  institutionnelle: "Source officielle",
  primaire: "Source primaire",
  presse: "Presse",
  commentaire: "Site tiers",
};
const LIBELLES_EVENEMENT = {
  candidature: "Candidature",
  intention: "Intention",
  investiture: "Investiture",
  calendrier: "Calendrier",
  retrait: "Retrait",
  proposition: "Proposition",
};
const PERIODES = [
  ["visite", "Depuis ma dernière visite"],
  ["7", "7 jours"],
  ["30", "30 jours"],
  ["tout", "Tout"],
];
const TYPES_RELEVE = [
  ["tout", "Tout"],
  ["evenement", "Événements relus"],
  ["remplacement", "Phrases modifiées"],
  ["ajout", "Phrases ajoutées"],
  ["retrait", "Phrases retirées"],
];
// Environ 30 secondes par carte : 6 cartes pour 3 minutes, 20 pour 10 minutes.
const SECONDES_PAR_CARTE = 30;
const DUREES = [
  ["3", "3 min", 6],
  ["10", "10 min", 20],
  ["tout", "Sans limite", Infinity],
];
const LUS_MAX = 3000;

// ---------- Stockage local ----------

function lireStockage() {
  try {
    return JSON.parse(localStorage.getItem(CLE)) || {};
  } catch {
    return {};
  }
}

function ecrireStockage(etat) {
  try {
    localStorage.setItem(CLE, JSON.stringify(etat));
  } catch {
    // Navigation privée ou stockage bloqué : l'application fonctionne sans mémoire.
  }
}

const stockage = Object.assign({ suivis: [], themes: [], lus: [], derniereVisite: null, periode: null }, lireStockage());
// La visite précédente sert au relevé de cette session ; la nouvelle date est enregistrée tout de suite.
const visitePrecedente = stockage.derniereVisite ? new Date(stockage.derniereVisite) : null;
stockage.derniereVisite = new Date().toISOString();
ecrireStockage(stockage);

function estSuivi(id) {
  return stockage.suivis.includes(id);
}

function basculerSuivi(id) {
  stockage.suivis = estSuivi(id) ? stockage.suivis.filter((x) => x !== id) : [...stockage.suivis, id];
  ecrireStockage(stockage);
}

function basculerTheme(id) {
  stockage.themes = stockage.themes.includes(id) ? stockage.themes.filter((x) => x !== id) : [...stockage.themes, id];
  ecrireStockage(stockage);
}

function marquerLus(ids, lu = true) {
  const autres = stockage.lus.filter((x) => !ids.includes(x));
  stockage.lus = (lu ? [...autres, ...ids] : autres).slice(-LUS_MAX);
  ecrireStockage(stockage);
}

// ---------- Données ----------

const donnees = {};

async function charger() {
  const noms = ["candidats", "evenements", "calendrier", "sources", "veille", "auto", "derive", "journal", "fonctions", "factchecks"];
  const res = await Promise.all(
    noms.map((n) =>
      fetch(`data/${n}.json`, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );
  noms.forEach((n, i) => (donnees[n] = res[i]));
  donnees.sourcesParId = Object.fromEntries((donnees.sources?.sources || []).map((s) => [s.id, s]));
  donnees.candidatsParId = Object.fromEntries((donnees.candidats?.candidats || []).map((c) => [c.id, c]));
  donnees.passagesParId = Object.fromEntries((donnees.auto?.passages || []).map((p) => [p.id, p]));
  donnees.paires = donnees.derive?.paires || [];
  donnees.themes = donnees.derive?.themes || [];
  donnees.themesParId = Object.fromEntries(donnees.themes.map((t) => [t.id, t]));
  donnees.phrases = donnees.derive?.phrases || [];
  donnees.pagesProgramme = new Set(donnees.derive?.pages_programme || []);
}

// ---------- Outils d'affichage ----------

const echapper = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function formaterDate(iso, precision) {
  if (!iso) return "date non précisée";
  const [a, m, j] = iso.slice(0, 10).split("-").map(Number);
  if (precision === "annee" || !m) return String(a);
  if (precision === "mois" || !j) return `${MOIS[m - 1]} ${a}`;
  return `${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${a}`;
}

function formaterCourt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function formaterHorodatage(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function dateDe(iso) {
  // « 2024-09 » devient le 1er du mois ; les dates seules sont lues à midi pour éviter les décalages.
  if (!iso) return null;
  const s = iso.length === 7 ? `${iso}-01` : iso.slice(0, 10);
  return new Date(`${s}T12:00:00`);
}

const nomComplet = (c) => `${c.prenom} ${c.nom}`;

function ligneSources(ids) {
  if (!ids?.length) return `<p class="sources sources-vide">Aucune source publiée pour l'instant.</p>`;
  const sources = ids.map((id) => donnees.sourcesParId[id]).filter(Boolean);
  const liens = sources.map(
    (s) =>
      `<a href="${echapper(s.url)}" rel="noopener" target="_blank">${echapper(s.editeur)}</a>` +
      `<span class="source-meta">${echapper(LIBELLES_TYPE_SOURCE[s.type] || s.type)}${s.date_publication ? `, ${formaterCourt(s.date_publication)}` : ""}</span>`
  );
  // Répartition par type de source (jamais par orientation politique), puis les dates de chaque source.
  const parType = {};
  sources.forEach((s) => (parType[s.type] = (parType[s.type] || 0) + 1));
  const repartition = sources.length > 1
    ? Object.entries(parType).map(([t, n]) => `${n} ${(LIBELLES_TYPE_SOURCE[t] || t).toLowerCase()}`).join(", ")
    : "";
  const dates = sources
    .map((s) => `<li><strong>${echapper(s.editeur)}</strong>${s.titre ? `, « ${echapper(s.titre)} »` : ""} : publiée ${s.date_publication ? `le ${formaterDate(s.date_publication)}` : "à une date non indiquée"}, consultée ${s.date_consultation ? `le ${formaterDate(s.date_consultation)}` : "à une date non notée"}${s.date_archivage ? `, archivée le ${formaterDate(s.date_archivage)}` : ""}${s.archive ? ` (${lienExterne(s.archive, "archive")})` : ""}.</li>`)
    .join("");
  return `<p class="sources"><span class="sources-titre">Sources</span> ${liens.join('<span class="sep">·</span>')}</p>
    <details class="dates-sources"><summary>${repartition ? `${echapper(repartition)} · ` : ""}dates des sources</summary><ul>${dates}</ul></details>`;
}

function pastilleStatut(statut) {
  const cert = statut.certitude && statut.certitude !== "sur"
    ? `<span class="pastille pastille-${echapper(statut.certitude)}">${echapper(LIBELLES_CERTITUDE[statut.certitude])}</span>`
    : "";
  return `<span class="pastille">${echapper(LIBELLES_STATUT[statut.code] || statut.code)}</span>${cert}`;
}

function boutonSuivi(c) {
  const suivi = estSuivi(c.id);
  return `<button class="suivre${suivi ? " actif" : ""}" data-suivre="${echapper(c.id)}" aria-pressed="${suivi}">${suivi ? "Suivi" : "Suivre"}</button>`;
}

function lienSignaler(titre) {
  const url = `${DEPOT}/issues/new?template=signaler.yml&title=${encodeURIComponent("Signalement : " + titre)}`;
  return `<a class="signaler" href="${url}" rel="noopener" target="_blank">Signaler une erreur</a>`;
}

function prochainRendezVous() {
  const auj = new Date();
  return (donnees.calendrier?.dates || []).find((d) => d.date && dateDe(d.date) >= new Date(auj.toDateString()));
}

function cartePassage(p, avecCandidat = true) {
  const cand = donnees.candidatsParId[p.candidat];
  const ajout = p.sens === "ajout";
  const archives = [
    `<a href="${echapper(p.url)}" rel="noopener" target="_blank">Page officielle</a>`,
    `<a href="${echapper(ajout ? p.archive_apres : p.archive_avant)}" rel="noopener" target="_blank">Texte archivé</a>`,
    (ajout ? p.wayback_apres : p.wayback_avant) ? `<a href="${echapper(ajout ? p.wayback_apres : p.wayback_avant)}" rel="noopener" target="_blank">Internet Archive</a>` : "",
  ].filter(Boolean);
  return `<article class="carte carte-auto">
    <p class="carte-haut"><span class="type">${ajout ? "Ajouté sur la page officielle" : "Retiré de la page officielle"}</span>${avecCandidat && cand ? `<span class="qui"><a href="#/candidat/${cand.id}">${echapper(nomComplet(cand))}</a></span>` : ""}<time datetime="${echapper(p.date)}">${formaterDate(p.date)}</time></p>
    <h3>${echapper(p.libelle)}</h3>
    <blockquote class="${ajout ? "" : "barre"}">« ${echapper(p.citation)} »</blockquote>
    <p class="sources"><span class="sources-titre">Preuve</span> ${archives.join('<span class="sep">·</span>')}</p>
    <p class="auto-mention">Publication automatique : citation exacte de la page, sans reformulation ni relecture.${p.tronquee ? " Passage abrégé." : ""}</p>
  </article>`;
}

// ---------- Vues ----------

function carteEvenement(e) {
  const noms = e.candidats.map((id) => donnees.candidatsParId[id]).filter(Boolean);
  const qui = noms.map((c) => `<a href="#/candidat/${c.id}">${echapper(nomComplet(c))}</a>`).join(", ");
  return `<article class="carte">
    <p class="carte-haut"><span class="type">${echapper(LIBELLES_EVENEMENT[e.type] || e.type)}</span>${qui ? `<span class="qui">${qui}</span>` : ""}<time datetime="${echapper(e.date)}">${formaterDate(e.date, e.precision)}</time></p>
    <h3>${echapper(e.titre)}</h3>
    ${e.citation ? `<blockquote>« ${echapper(e.citation)} »</blockquote>` : ""}
    ${e.detail ? `<p class="detail">${echapper(e.detail)}</p>` : ""}
    ${ligneSources(e.sources)}
  </article>`;
}

function lienExterne(url, texte) {
  return url ? `<a href="${echapper(url)}" rel="noopener" target="_blank">${texte}</a>` : "";
}

// Une phrase retirée et une phrase ajoutée proches, sur la même page et la même capture : une seule carte avant/après.
function carteRemplacement(paire, avecCandidat = true) {
  const r = donnees.passagesParId[paire.retrait];
  const a = donnees.passagesParId[paire.ajout];
  const cand = donnees.candidatsParId[a.candidat];
  const diff = paire.diff
    .map(([op, t]) => (op === "=" ? echapper(t) : op === "-" ? `<del>${echapper(t)}</del>` : `<ins>${echapper(t)}</ins>`))
    .join(" ");
  const preuves = [
    lienExterne(a.url, "Page officielle"),
    lienExterne(r.archive_avant, "Texte archivé avant"),
    lienExterne(a.archive_apres, "Texte archivé après"),
    lienExterne(r.wayback_avant, "Internet Archive avant"),
    lienExterne(a.wayback_apres, "Internet Archive après"),
  ].filter(Boolean);
  return `<article class="carte carte-auto">
    <p class="carte-haut"><span class="type">Modifié sur la page officielle</span>${avecCandidat && cand ? `<span class="qui"><a href="#/candidat/${cand.id}">${echapper(nomComplet(cand))}</a></span>` : ""}<time datetime="${echapper(a.date)}">${formaterDate(a.date)}</time></p>
    <h3>${echapper(a.libelle)}</h3>
    <p class="diff-mots">« ${diff} »</p>
    <details class="avant-apres"><summary>Voir les deux phrases complètes</summary>
      <p class="source-meta">Avant</p><blockquote class="barre">« ${echapper(r.citation)} »</blockquote>
      <p class="source-meta">Après</p><blockquote>« ${echapper(a.citation)} »</blockquote>
    </details>
    <p class="sources"><span class="sources-titre">Preuve</span> ${preuves.join('<span class="sep">·</span>')}</p>
    <p class="auto-mention">Publication automatique : les deux phrases sont copiées mot pour mot ; les mots retirés sont barrés, les mots ajoutés soulignés. Aucune relecture.</p>
  </article>`;
}

// Tous les changements publiés, sous une forme commune : événements relus, remplacements, ajouts et retraits.
function elementsDuReleve() {
  const d = donnees.derive || {};
  const themesPassages = d.themes_passages || {};
  const themesEvenements = d.themes_evenements || {};
  const dansPaire = new Set();
  const elements = [];
  for (const paire of donnees.paires) {
    const r = donnees.passagesParId[paire.retrait];
    const a = donnees.passagesParId[paire.ajout];
    if (!r || !a) continue;
    dansPaire.add(r.id).add(a.id);
    elements.push({
      id: `paire-${r.id}`, type: "remplacement", date: a.date, dateAjout: a.date, candidats: [a.candidat],
      themes: [...new Set([...(themesPassages[r.id] || []), ...(themesPassages[a.id] || [])])],
      html: (avecCandidat) => carteRemplacement(paire, avecCandidat),
    });
  }
  for (const p of donnees.auto?.passages || []) {
    if (dansPaire.has(p.id)) continue;
    elements.push({
      id: p.id, type: p.sens, date: p.date, dateAjout: p.date, candidats: [p.candidat],
      themes: themesPassages[p.id] || [], html: (avecCandidat) => cartePassage(p, avecCandidat),
    });
  }
  for (const e of donnees.evenements?.evenements || []) {
    elements.push({
      id: `evenement-${e.id}`, type: "evenement", date: e.date || "", dateAjout: `${e.ajoute_le}T23:59:59`,
      candidats: e.candidats, themes: themesEvenements[e.id] || [], proposition: e.type === "proposition",
      html: () => carteEvenement(e),
    });
  }
  return elements.sort((x, y) => y.date.localeCompare(x.date));
}

function avecBoutonLu(html, id) {
  const lu = stockage.lus.includes(id);
  const bouton = `<p class="carte-actions"><button class="lien-bouton" data-lu="${echapper(id)}" aria-pressed="${lu}">${lu ? "Marquer comme non lu" : "Marquer comme lu"}</button></p>`;
  return html.trim().replace(/<\/article>$/, `${bouton}</article>`);
}

function vueReleve() {
  const changements = donnees.veille?.changements || [];
  const { suivis, themes: themesSuivis } = stockage;
  const periode = stockage.periode || (visitePrecedente ? "visite" : "30");
  const type = stockage.type || "tout";
  const duree = stockage.duree || "tout";

  const concerne = (cands) => !suivis.length || !cands.length || cands.some((id) => suivis.includes(id));
  // Les statuts et dates du calendrier concernent tous les thèmes ; les propositions et passages sont filtrés.
  const dansThemes = (x) =>
    !themesSuivis.length || (x.type === "evenement" && !x.proposition) || x.themes.some((t) => themesSuivis.includes(t));
  const depuis =
    periode === "visite" ? visitePrecedente :
    periode === "tout" ? null :
    new Date(Date.now() - Number(periode) * JOUR);
  // En mode « dernière visite », on retient ce qui a été ajouté au registre depuis ;
  // sinon, ce qui s'est passé pendant la période choisie.
  const dansPeriode = (x) => {
    if (!depuis) return true;
    const d = periode === "visite" || x.type !== "evenement" ? new Date(x.dateAjout) : dateDe(x.date);
    return d > depuis;
  };
  const filtreType = (x) => type === "tout" || x.type === type;

  const tous = elementsDuReleve().filter((x) => concerne(x.candidats) && dansThemes(x) && dansPeriode(x));
  const parType = tous.filter(filtreType);
  const nonLus = parType.filter((x) => !stockage.lus.includes(x.id));
  const affiches = stockage.voirLus ? parType : nonLus;
  const limite = DUREES.find(([v]) => v === duree)?.[2] ?? Infinity;
  const visibles = affiches.slice(0, limite);
  const reste = affiches.length - visibles.length;
  const veilleRetenue = changements.filter(
    (c) => concerne(c.candidat ? [c.candidat] : []) && (!depuis || new Date(c.date) > depuis)
  );

  const nb = nonLus.length;
  const titre = nb === 0 ? "Aucun changement" : nb === 1 ? "1 changement" : `${nb} changements`;
  const portee = [
    suivis.length ? (suivis.length === 1 ? "le candidat que vous suivez" : `les ${suivis.length} candidats que vous suivez`) : "l'ensemble des candidats",
    themesSuivis.length ? `${themesSuivis.length === 1 ? "votre thème" : `vos ${themesSuivis.length} thèmes`} (${themesSuivis.map((t) => donnees.themesParId[t]?.libelle || t).join(", ")})` : "",
  ].filter(Boolean).join(", sur ");
  const puces = (liste, cle, valeur) =>
    liste.map(([v, l]) => `<button class="puce${v === valeur ? " actif" : ""}" data-${cle}="${v}" aria-pressed="${v === valeur}">${l}</button>`).join("");
  const lusMasques = parType.length - nonLus.length;
  const rdv = prochainRendezVous();
  const blocVeille = veilleRetenue.length
    ? `<a class="encart" href="#/veille"><strong>${veilleRetenue.length} modification${veilleRetenue.length > 1 ? "s" : ""} détectée${veilleRetenue.length > 1 ? "s" : ""}</strong> sur les pages officielles suivies, y compris menus et actualités. Voir la veille</a>`
    : "";

  return `
    <section class="releve">
      <h1>${titre}</h1>
      <p class="chapeau">${periode === "visite" ? `Depuis votre dernière visite, le ${formaterHorodatage(visitePrecedente)}` : "Sur la période choisie"}, sur ${portee}.${!visitePrecedente ? " C'est votre première visite : voici les 30 derniers jours." : ""}${visibles.length ? ` Lecture estimée : ${Math.max(1, Math.round(visibles.length * SECONDES_PAR_CARTE / 60))} min.` : ""}</p>
      <div class="puces" role="group" aria-label="Période">${puces(PERIODES.filter(([v]) => v !== "visite" || visitePrecedente), "periode", periode)}</div>
      <details class="filtres"${type !== "tout" || duree !== "tout" ? " open" : ""}><summary>Type de changement et durée</summary>
        <div class="puces" role="group" aria-label="Type de changement">${puces(TYPES_RELEVE, "type", type)}</div>
        <div class="puces" role="group" aria-label="Durée de lecture">${puces(DUREES, "duree", duree)}</div>
      </details>
      ${!suivis.length && !themesSuivis.length ? `<p class="astuce">Suivez des candidats dans l'onglet <a href="#/candidats">Candidats</a> ou des sujets dans <a href="#/themes">Thèmes</a> pour ne voir que ce qui vous concerne.</p>` : ""}
      ${blocVeille}
      ${visibles.map((x) => avecBoutonLu(x.html(true), x.id)).join("") || `<p class="vide">Rien de nouveau sur cette période. Essayez « 30 jours » ou « Tout ».</p>`}
      ${reste > 0 ? `<p class="suite">Encore ${reste} changement${reste > 1 ? "s" : ""} au-delà de la durée choisie. <button class="lien-bouton" data-duree="tout">Tout afficher</button></p>` : ""}
      <p class="actions-releve">
        ${nonLus.length ? `<button class="bouton" data-tout-lu="${echapper(nonLus.map((x) => x.id).join(" "))}">Tout marquer comme lu</button>` : ""}
        ${lusMasques ? `<button class="lien-bouton" data-voir-lus="1">${stockage.voirLus ? "Masquer" : "Afficher"} les ${lusMasques} changement${lusMasques > 1 ? "s" : ""} déjà lu${lusMasques > 1 ? "s" : ""}</button>` : ""}
      </p>
      <div class="a-jour">
        <p><strong>Vous êtes à jour.</strong></p>
        ${rdv ? `<p>Prochain rendez-vous : ${echapper(rdv.titre.toLowerCase())}, le ${formaterDate(rdv.date)}.</p>` : ""}
        <p class="source-meta">Être prévenu sans revenir : <a href="flux.xml">flux RSS du relevé</a>${suivis.length ? `, ou par candidat suivi dans <a href="#/suivis">Mes suivis</a>` : ""}.</p>
      </div>
    </section>`;
}

function trierCandidats(liste) {
  if (stockage.ordre === "aleatoire") {
    const copie = [...liste];
    for (let i = copie.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copie[i], copie[j]] = [copie[j], copie[i]];
    }
    return copie;
  }
  return [...liste].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
}

function vueCandidats() {
  const { candidats = [], regle, en_attente_seconde_source: attente = [], maj } = donnees.candidats || {};
  const ordre = stockage.ordre === "aleatoire" ? "aleatoire" : "alpha";
  const lignes = trierCandidats(candidats)
    .map(
      (c) => `<li class="ligne">
        <a class="ligne-lien" href="#/candidat/${c.id}">
          <span class="ligne-nom">${echapper(nomComplet(c))}</span>
          <span class="ligne-formation">${echapper(c.formation || "Formation non précisée")}</span>
        </a>
        <span class="ligne-statut">${pastilleStatut(c.statut)}</span>
        ${boutonSuivi(c)}
      </li>`
    )
    .join("");
  const enAttente = attente
    .map((a) => `<li><strong>${echapper(a.nom)}</strong> : ${echapper(a.texte)}. ${ligneSources(a.sources)}</li>`)
    .join("");
  return `
    <section>
      <h1>Candidats</h1>
      <p class="chapeau">${candidats.length} fiches, état au ${formaterDate(maj)}. ${echapper(regle)}</p>
      <div class="puces" role="group" aria-label="Ordre">
        <button class="puce${ordre === "alpha" ? " actif" : ""}" data-ordre="alpha" aria-pressed="${ordre === "alpha"}">Ordre alphabétique</button>
        <button class="puce${ordre === "aleatoire" ? " actif" : ""}" data-ordre="aleatoire" aria-pressed="${ordre === "aleatoire"}">Ordre aléatoire</button>
      </div>
      <ul class="liste">${lignes}</ul>
      ${enAttente ? `<h2>En attente d'une seconde source</h2><p class="chapeau">Annonces relevées par un seul média consulté. Elles auront une fiche dès qu'un second média national les confirme.</p><ul class="attente">${enAttente}</ul>` : ""}
    </section>`;
}

function etatPage(p) {
  if (!p || !p.premiere_capture) return "première capture à venir";
  const morceaux = [`suivie depuis le ${formaterCourt(p.premiere_capture)}, ${p.nombre_versions} version${p.nombre_versions > 1 ? "s" : ""} archivée${p.nombre_versions > 1 ? "s" : ""}`];
  if (p.retiree_le) morceaux.push(`<span class="pastille pastille-incertain">Page retirée le ${formaterCourt(p.retiree_le)}</span>`);
  else if (p.nombre_versions > 1) morceaux.push(`<span class="pastille">Page modifiée le ${formaterCourt(p.derniere_version)}</span>`);
  return morceaux.join(" ");
}

function periodeFonction(f) {
  const an = (d) => (d ? formaterDate(d, d.length === 4 ? "annee" : d.length === 7 ? "mois" : "jour") : "");
  if (f.debut && f.fin) return `${an(f.debut)} – ${an(f.fin)}`;
  if (f.debut) return `depuis ${an(f.debut)}`;
  if (f.fin) return `jusqu'à ${an(f.fin)}`;
  return "dates non renseignées";
}

function vueCandidat(id) {
  const c = donnees.candidatsParId[id];
  if (!c) return `<section><h1>Fiche introuvable</h1><p><a href="#/candidats">Retour aux candidats</a></p></section>`;
  const evenements = (donnees.evenements?.evenements || [])
    .filter((e) => e.candidats.includes(id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const changements = elementsDuReleve().filter((x) => x.type !== "evenement" && x.candidats.includes(id)).slice(0, 20);
  const recents = changements.filter((x) => new Date(x.date) > new Date(Date.now() - 30 * JOUR)).length;
  const pagesVeille = Object.fromEntries((donnees.veille?.pages || []).map((p) => [p.id, p]));
  const pages = c.pages_suivies
    .map((pid) => {
      const p = pagesVeille[pid];
      const libelle = p?.libelle || pid;
      return `<li>${p?.url ? lienExterne(p.url, echapper(libelle)) : echapper(libelle)}
        <span class="source-meta">${etatPage(p)}${p?.wayback ? ` · ${lienExterne(p.wayback, "archive")}` : ""}</span></li>`;
    })
    .join("");

  // Thèmes : phrases actuelles de ses pages de programme, classées par mots-clés.
  const aDesProgrammes = c.pages_suivies.some((pid) => donnees.pagesProgramme.has(pid));
  const phrases = donnees.phrases.filter((p) => p.candidat === id);
  const parTheme = donnees.themes.map((t) => [t, phrases.filter((p) => p.themes.includes(t.id)).length]);
  const avec = parTheme.filter(([, n]) => n);
  const sans = parTheme.filter(([, n]) => !n);
  const blocThemes = !aDesProgrammes
    ? `<p class="vide">Aucune page de programme n'est suivie pour ce candidat : Relevé ne peut rien dire de ses thèmes.</p>`
    : `${avec.length ? `<ul class="themes-candidat">${avec.map(([t, n]) => `<li><a href="#/theme/${t.id}">${echapper(t.libelle)}</a> <span class="source-meta">${n} phrase${n > 1 ? "s" : ""}</span></li>`).join("")}</ul>` : ""}
      ${sans.length ? `<h3>Ce qu'on ne sait pas encore</h3><p>Aucune phrase sur ${sans.map(([t]) => echapper(t.libelle.toLowerCase())).join(", ")} dans ses pages de programme suivies, au ${formaterDate(donnees.derive?.maj)}. Cela ne veut pas dire qu'il n'a rien dit ailleurs.</p>` : ""}`;

  const f = donnees.fonctions?.candidats?.[id];
  const blocFonctions = f?.fonctions?.length
    ? `<ol class="frise frise-compacte">${f.fonctions.slice(0, 10).map((x) => `<li><time>${periodeFonction(x)}</time> ${echapper(x.intitule)}</li>`).join("")}</ol>
       <p class="source-meta">Source : ${lienExterne(`https://www.wikidata.org/wiki/${f.wikidata}`, "Wikidata")}, base collaborative lue automatiquement, à vérifier sur une source primaire.${f.fonctions.length > 10 ? ` ${f.fonctions.length - 10} autres fonctions sur Wikidata.` : ""}</p>`
    : `<p class="vide">${f ? "Aucune fonction trouvée automatiquement dans Wikidata." : "Les fonctions seront ajoutées automatiquement à la prochaine capture."}</p>`;

  const verifs = donnees.factchecks?.candidats?.[id];
  const blocVerifs = verifs?.length
    ? `<ul class="verifs">${verifs.map((v) => `<li>${lienExterne(v.url, echapper(v.titre || v.affirmation || "Vérification"))}
        <span class="source-meta">${echapper(v.editeur || "")}${v.date ? `, ${formaterCourt(v.date)}` : ""}${v.verdict ? ` · verdict de l'éditeur : « ${echapper(v.verdict)} »` : ""}</span></li>`).join("")}</ul>
       <p class="source-meta">Vérifications publiées par des médias et mentionnant ce candidat, recensées automatiquement (Google Fact Check Tools). Relevé ne fait pas ses propres vérifications.</p>`
    : verifs
      ? `<p class="vide">Aucune vérification publiée et balisée mentionnant ce candidat sur les deux dernières années.</p>`
      : "";

  return `
    <section class="fiche">
      <p class="fil"><a href="#/candidats">Candidats</a></p>
      <div class="fiche-tete">
        <div>
          <h1>${echapper(nomComplet(c))}</h1>
          <p class="chapeau">${echapper(c.formation || "Formation non précisée")}${c.formation_note ? ` (${echapper(c.formation_note)})` : ""}</p>
        </div>
        ${boutonSuivi(c)}
      </div>
      ${c.statut.code === "retiree" ? `<p class="encart">Candidature retirée${c.statut.date ? ` le ${formaterDate(c.statut.date, c.statut.precision)}` : ""}. La fiche est conservée.</p>` : ""}

      <h2>Statut</h2>
      <div class="bloc">
        <p>${pastilleStatut(c.statut)}</p>
        <p class="statut-libelle">${echapper(c.statut.libelle)}</p>
        ${c.statut.date ? `<p class="source-meta">Date : ${formaterDate(c.statut.date, c.statut.precision)}</p>` : ""}
        ${c.note ? `<p class="detail">${echapper(c.note)}</p>` : ""}
        ${ligneSources(c.statut.sources)}
        <p class="source-meta">Aucune candidature n'est officielle avant la publication de la liste par le Conseil constitutionnel.</p>
      </div>

      <h2>Changements sur ses pages officielles</h2>
      ${changements.length ? `<p class="source-meta">${recents} sur les 30 derniers jours.</p>` + changements.map((x) => x.html(false)).join("") : `<p class="vide">Aucun passage ajouté ou retiré depuis le début de la capture.${c.pages_suivies.length ? "" : " Aucune page officielle n'est suivie pour l'instant."}</p>`}

      <h2>Son programme par thème</h2>
      ${blocThemes}

      <h2>Historique</h2>
      ${evenements.length
        ? `<ol class="frise">${evenements.map((e) => `<li><time>${formaterDate(e.date, e.precision)}</time> ${echapper(e.titre)}${ligneSources(e.sources)}</li>`).join("")}</ol>`
        : `<p class="vide">Aucun événement daté relevé pour l'instant.</p>`}

      <h2>Fonctions occupées</h2>
      ${blocFonctions}
      <p class="source-meta">Votes au Parlement : ${lienExterne("https://datan.fr/", "Datan")} · ${lienExterne("https://www.komunemedia.fr/comparateur/", "Komune")}.</p>

      ${blocVerifs ? `<h2>Vérifications publiées</h2>${blocVerifs}` : ""}

      <h2>Pages officielles suivies</h2>
      ${pages ? `<ul class="pages">${pages}</ul>` : `<p class="vide">Aucune page officielle de programme vérifiée à ce jour.</p>`}
      <p class="source-meta">Être prévenu : <a href="flux/${echapper(c.id)}.xml">flux RSS de ce candidat</a>.</p>
      <p>${lienSignaler(nomComplet(c))}</p>
    </section>`;
}

function vueCalendrier() {
  const { dates = [], statuts = {} } = donnees.calendrier || {};
  const auj = new Date(new Date().toDateString());
  const rdv = prochainRendezVous();
  const lignes = dates
    .map((d) => {
      const passe = d.date && dateDe(d.date) < auj;
      return `<li class="${passe ? "passe" : ""}${d === rdv ? " prochain" : ""}">
        <time>${d.date ? formaterDate(d.date) : "Date à venir"}${d.heure ? `, ${d.heure.replace(":", " h ")}` : ""}</time>
        <div>
          <p class="cal-titre">${echapper(d.titre)}</p>
          <p class="source-meta"><span class="pastille pastille-${echapper(d.statut)}">${echapper(statuts[d.statut] || d.statut)}</span></p>
          ${ligneSources(d.sources)}
        </div>
      </li>`;
    })
    .join("");
  return `
    <section>
      <h1>Calendrier</h1>
      <p class="chapeau">Chaque date indique son niveau de certitude. Les dates calculées par Relevé sont distinguées des dates publiées.</p>
      <ol class="calendrier">${lignes}</ol>
    </section>`;
}

function vueVeille() {
  const v = donnees.veille || {};
  const changements = [...(v.changements || [])].reverse();
  const pages = v.pages || [];
  const libelleStatut = {
    ok: "capturée", jamais: "première capture à venir", erreur: "inaccessible lors de la dernière tentative",
    refus_robots: "capture refusée par le site (robots.txt)", texte_insuffisant: "texte non lisible sans JavaScript",
    format_non_suivi: "format non suivi", illisible: "texte illisible (décodage)",
    retiree: "page retirée par le site (archive conservée)",
  };
  const cartes = changements
    .map((c) => {
      const cand = donnees.candidatsParId[c.candidat];
      const extraits = [
        ...c.extraits_ajoutes.map((x) => `<li class="ajout"><span aria-label="Ajouté">+</span> ${echapper(x)}</li>`),
        ...c.extraits_retires.map((x) => `<li class="retrait"><span aria-label="Retiré">−</span> ${echapper(x)}</li>`),
      ].join("");
      return `<article class="carte carte-veille">
        <p class="carte-haut"><span class="type">Page modifiée</span>${cand ? `<span class="qui"><a href="#/candidat/${cand.id}">${echapper(nomComplet(cand))}</a></span>` : ""}<time>${formaterHorodatage(c.date)}</time></p>
        <h3><a href="${echapper(c.url)}" rel="noopener" target="_blank">${echapper(c.libelle)}</a></h3>
        <p class="source-meta">${c.lignes_ajoutees} ligne${c.lignes_ajoutees > 1 ? "s" : ""} ajoutée${c.lignes_ajoutees > 1 ? "s" : ""}, ${c.lignes_retirees} retirée${c.lignes_retirees > 1 ? "s" : ""}. Premiers extraits :</p>
        <ul class="diff">${extraits}</ul>
        <p class="source-meta">${c.wayback_avant ? `<a href="${echapper(c.wayback_avant)}" rel="noopener" target="_blank">Archive avant</a>` : "Archive avant : copie interne"} · ${c.wayback_apres ? `<a href="${echapper(c.wayback_apres)}" rel="noopener" target="_blank">Archive après</a>` : "Archive après : copie interne"}</p>
      </article>`;
    })
    .join("");
  const tableau = pages
    .map((p) => {
      const cand = donnees.candidatsParId[p.candidat];
      return `<tr><td><a href="${echapper(p.url)}" rel="noopener" target="_blank">${echapper(p.libelle)}</a></td><td>${cand ? echapper(nomComplet(cand)) : p.institution ? "Institution" : ""}</td><td>${echapper(libelleStatut[p.statut] || p.statut)}</td><td>${p.nombre_versions || 0}</td><td>${formaterCourt(p.derniere_reussite)}</td></tr>`;
    })
    .join("");
  return `
    <section>
      <h1>Veille des pages officielles</h1>
      <p class="chapeau">Chaque jour, Relevé capture le texte des pages officielles suivies et archive toute nouvelle version. Ci-dessous, toutes les différences de texte brutes, menus et actualités compris. Sur les pages de programme, les phrases de contenu ajoutées ou retirées sont aussi publiées dans le relevé, telles quelles. Une différence de texte n'est pas un changement de position.</p>
      <p class="source-meta">Dernière capture : ${v.maj ? formaterHorodatage(v.maj) : "pas encore effectuée"}.</p>
      ${cartes || `<p class="vide">Aucune modification détectée pour l'instant. L'historique commence à la première capture.</p>`}
      <h2>Pages suivies</h2>
      ${tableau
        ? `<div class="tableau-defile"><table><thead><tr><th>Page</th><th>Candidat</th><th>État</th><th>Versions</th><th>Dernière capture</th></tr></thead><tbody>${tableau}</tbody></table></div>`
        : `<p class="vide">La liste apparaîtra après la première capture.</p>`}
      <p class="source-meta">Pour proposer une page à suivre : ${lienSignaler("page à suivre")}.</p>
    </section>`;
}

function boutonTheme(t) {
  const suivi = stockage.themes.includes(t.id);
  return `<button class="suivre${suivi ? " actif" : ""}" data-suivre-theme="${echapper(t.id)}" aria-pressed="${suivi}">${suivi ? "Suivi" : "Suivre"}</button>`;
}

function vueThemes() {
  if (!donnees.themes.length) return `<section><h1>Thèmes</h1><p class="vide">Les thèmes seront calculés à la prochaine publication.</p></section>`;
  const lignes = donnees.themes
    .map((t) => {
      const phrases = donnees.phrases.filter((p) => p.themes.includes(t.id));
      const nbCandidats = new Set(phrases.map((p) => p.candidat)).size;
      return `<li class="ligne">
        <a class="ligne-lien" href="#/theme/${t.id}">
          <span class="ligne-nom">${echapper(t.libelle)}</span>
          <span class="ligne-formation">${phrases.length} phrase${phrases.length > 1 ? "s" : ""} de programme, ${nbCandidats} candidat${nbCandidats > 1 ? "s" : ""}</span>
        </a>
        ${boutonTheme(t)}
      </li>`;
    })
    .join("");
  return `
    <section>
      <h1>Thèmes</h1>
      <p class="chapeau">Les phrases actuelles des pages de programme suivies, classées par thème selon une liste publique de mots-clés. Aucun texte n'est résumé : vous lisez les phrases exactes. Un thème suivi filtre votre relevé.</p>
      <ul class="liste">${lignes}</ul>
      <p class="source-meta">État au ${formaterDate(donnees.derive?.maj)}. Le classement par mots-clés peut se tromper ; chaque phrase garde son lien vers la page et son archive.</p>
    </section>`;
}

function vueTheme(id) {
  const t = donnees.themesParId[id];
  if (!t) return `<section><h1>Thème introuvable</h1><p><a href="#/themes">Retour aux thèmes</a></p></section>`;
  const candidats = trierCandidats(donnees.candidats?.candidats || []);
  const suivis = candidats.filter((c) => c.pages_suivies.some((pid) => donnees.pagesProgramme.has(pid)));
  const sansPage = candidats.filter((c) => !suivis.includes(c));
  const blocs = suivis
    .map((c) => {
      const phrases = donnees.phrases.filter((p) => p.candidat === c.id && p.themes.includes(id));
      const ligne = (p) => `<li><blockquote>« ${echapper(p.texte)} »</blockquote>
        <p class="source-meta">${lienExterne(p.url, echapper(p.libelle))} · ${lienExterne(p.archive, `texte archivé le ${formaterCourt(p.date)}`)}</p></li>`;
      return `<div class="bloc bloc-theme">
        <h3><a href="#/candidat/${c.id}">${echapper(nomComplet(c))}</a></h3>
        ${phrases.length
          ? `<ul class="phrases">${phrases.slice(0, 4).map(ligne).join("")}</ul>
             ${phrases.length > 4 ? `<details><summary>${phrases.length - 4} autre${phrases.length > 5 ? "s" : ""} phrase${phrases.length > 5 ? "s" : ""}</summary><ul class="phrases">${phrases.slice(4).map(ligne).join("")}</ul></details>` : ""}`
          : `<p class="vide">Pas de phrase sur ce thème dans ses pages de programme suivies, au ${formaterDate(donnees.derive?.maj)}.</p>`}
      </div>`;
    })
    .join("");
  const recents = elementsDuReleve().filter((x) => x.type !== "evenement" && x.themes.includes(id)).slice(0, 10);
  return `
    <section>
      <p class="fil"><a href="#/themes">Thèmes</a></p>
      <div class="fiche-tete"><h1>${echapper(t.libelle)}</h1>${boutonTheme(t)}</div>
      <p class="chapeau">Phrases exactes des pages de programme suivies, au ${formaterDate(donnees.derive?.maj)}. Les candidats sont présentés dans le même gabarit, ${stockage.ordre === "aleatoire" ? "en ordre aléatoire" : "par ordre alphabétique"}. Le nombre de phrases dépend de la longueur des pages, pas de l'importance du sujet pour le candidat.</p>
      <details class="filtres"><summary>Mots-clés utilisés</summary><p class="source-meta">${t.mots.map(echapper).join(", ")}</p></details>
      ${recents.length ? `<h2>Changements récents sur ce thème</h2>${recents.map((x) => x.html(true)).join("")}` : ""}
      <h2>Par candidat</h2>
      ${blocs || `<p class="vide">Aucune page de programme n'a encore été capturée.</p>`}
      ${sansPage.length ? `<p class="source-meta">Pas de page de programme suivie pour : ${sansPage.map((c) => echapper(nomComplet(c))).join(", ")}. ${lienSignaler("page de programme à suivre")}</p>` : ""}
    </section>`;
}

// ---------- Recherche plein texte, calculée dans le navigateur ----------

const normaliser = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/’/g, "'");
let corpus = null;

function construireCorpus() {
  const nomDe = (id) => (donnees.candidatsParId[id] ? nomComplet(donnees.candidatsParId[id]) : "");
  const elements = [
    ...(donnees.candidats?.candidats || []).map((c) => ({
      type: "Candidat", titre: nomComplet(c), texte: [c.formation, c.statut.libelle, c.note].filter(Boolean).join(" · "),
      lien: `#/candidat/${c.id}`, candidat: c.id,
    })),
    ...(donnees.evenements?.evenements || []).map((e) => ({
      type: "Événement", titre: e.titre, texte: [e.citation && `« ${e.citation} »`, e.detail].filter(Boolean).join(" "),
      lien: e.candidats[0] ? `#/candidat/${e.candidats[0]}` : "#/releve", date: e.date, candidat: e.candidats[0],
    })),
    ...donnees.phrases.map((p) => ({
      type: "Programme", titre: `${nomDe(p.candidat)}, ${p.libelle}`, texte: `« ${p.texte} »`, lien: p.url, externe: true,
      date: p.date, candidat: p.candidat,
    })),
    ...(donnees.auto?.passages || []).map((p) => ({
      type: p.sens === "ajout" ? "Phrase ajoutée" : "Phrase retirée", titre: `${nomDe(p.candidat)}, ${p.libelle}`,
      texte: `« ${p.citation} »`, lien: p.sens === "ajout" ? p.archive_apres : p.archive_avant, externe: true,
      date: p.date, candidat: p.candidat,
    })),
    ...(donnees.calendrier?.dates || []).map((d) => ({
      type: "Calendrier", titre: d.titre, texte: d.date ? formaterDate(d.date) : "Date à venir", lien: "#/calendrier", date: d.date,
    })),
    ...(donnees.sources?.sources || []).map((s) => ({
      type: "Source", titre: s.titre || s.editeur, texte: s.editeur, lien: s.url, externe: true, date: s.date_publication,
    })),
  ];
  return elements.map((x) => ({ ...x, cle: normaliser(`${x.titre} ${x.texte}`) }));
}

function surligner(texte, termes) {
  let html = echapper(texte);
  if (!termes.length) return html;
  // On repère les termes sur la version sans accents, à la même position (la normalisation garde la longueur).
  const base = normaliser(texte);
  const zones = [];
  for (const t of termes) {
    let i = base.indexOf(t);
    while (i !== -1) {
      zones.push([i, i + t.length]);
      i = base.indexOf(t, i + t.length);
    }
  }
  if (!zones.length || base.length !== texte.length) return html;
  zones.sort((a, b) => a[0] - b[0]);
  let sortie = "";
  let pos = 0;
  for (const [d, f] of zones) {
    if (d < pos) continue;
    sortie += echapper(texte.slice(pos, d)) + `<mark>${echapper(texte.slice(d, f))}</mark>`;
    pos = f;
  }
  return sortie + echapper(texte.slice(pos));
}

function resultatsRecherche(requete, candidat) {
  corpus = corpus || construireCorpus();
  const termes = normaliser(requete).split(/\s+/).filter((t) => t.length > 1);
  if (!termes.length) return `<p class="vide">Tapez au moins un mot : un nom, un sujet, une phrase.</p>`;
  const trouves = corpus
    .filter((x) => (!candidat || x.candidat === candidat) && termes.every((t) => x.cle.includes(t)))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!trouves.length) return `<p class="vide">Nos sources ne contiennent pas « ${echapper(requete)} ». Relevé ne cherche que dans ce qu'il a publié et archivé.</p>`;
  const max = 60;
  return `<p class="source-meta">${trouves.length} résultat${trouves.length > 1 ? "s" : ""}${trouves.length > max ? `, les ${max} plus récents affichés` : ""}.</p>
    <ul class="resultats">${trouves.slice(0, max).map((x) => `<li>
      <p class="carte-haut"><span class="type">${echapper(x.type)}</span>${x.date ? `<time>${formaterDate(x.date)}</time>` : ""}</p>
      <a href="${echapper(x.lien)}"${x.externe ? ' rel="noopener" target="_blank"' : ""}>${surligner(x.titre, termes)}</a>
      <p class="detail">${surligner(x.texte.length > 400 ? x.texte.slice(0, 399) + "…" : x.texte, termes)}</p>
    </li>`).join("")}</ul>`;
}

function vueChercher(param) {
  const requete = param ? decodeURIComponent(param) : "";
  const options = trierCandidats(donnees.candidats?.candidats || [])
    .map((c) => `<option value="${echapper(c.id)}">${echapper(nomComplet(c))}</option>`)
    .join("");
  return `
    <section>
      <h1>Chercher</h1>
      <p class="chapeau">Dans les fiches, les événements, les phrases des programmes, les passages ajoutés ou retirés, le calendrier et les sources. Tout est cherché sur cet appareil : votre recherche n'est envoyée nulle part.</p>
      <form class="recherche" role="search" onsubmit="return false">
        <label class="evitement" for="requete">Rechercher</label>
        <input id="requete" type="search" value="${echapper(requete)}" placeholder="Ex. : loyers, Attal, narcotrafic" autocomplete="off">
        <label class="evitement" for="filtre-candidat">Candidat</label>
        <select id="filtre-candidat"><option value="">Tous les candidats</option>${options}</select>
      </form>
      <div id="resultats" aria-live="polite">${requete ? resultatsRecherche(requete, "") : ""}</div>
    </section>`;
}

function vueDonnees() {
  const pagesVeille = donnees.veille?.pages || [];
  const evenements = donnees.evenements?.evenements || [];
  const passages = donnees.auto?.passages || [];
  const lignes = trierCandidats(donnees.candidats?.candidats || [])
    .map((c) => {
      const pages = pagesVeille.filter((p) => p.candidat === c.id);
      const versions = pages.reduce((n, p) => n + (p.nombre_versions || 0), 0);
      return `<tr><td><a href="#/candidat/${c.id}">${echapper(nomComplet(c))}</a></td><td>${pages.length}</td><td>${versions}</td>
        <td>${donnees.phrases.filter((p) => p.candidat === c.id).length}</td><td>${passages.filter((p) => p.candidat === c.id).length}</td>
        <td>${evenements.filter((e) => e.candidats.includes(c.id)).length}</td></tr>`;
    })
    .join("");
  const journal = (donnees.journal?.entrees || [])
    .map((e) => `<li><time>${formaterHorodatage(e.date)}</time> ${lienExterne(e.lien, echapper(e.message))} <span class="source-meta">${e.fichiers.map(echapper).join(", ")}</span></li>`)
    .join("");
  const fichiers = [
    ["candidats.json", "Fiches candidats et statuts"],
    ["evenements.json", "Événements relus"],
    ["auto.json", "Phrases ajoutées ou retirées, publiées automatiquement"],
    ["derive.json", "Phrases actuelles des programmes par thème, remplacements"],
    ["calendrier.json", "Dates de l'élection"],
    ["sources.json", "Sources citées"],
    ["veille.json", "État des pages suivies et différences brutes"],
    ["fonctions.json", "Fonctions occupées (Wikidata)"],
  ];
  return `
    <section class="texte">
      <h1>Données ouvertes et transparence</h1>
      <p class="chapeau">Tout ce que Relevé publie est téléchargeable et réutilisable (Licence Ouverte 2.0 pour les données, citations dans la limite de la courte citation).</p>

      <h2>Couverture par candidat</h2>
      <p>Pour vérifier que tous les candidats sont traités de la même façon. Les écarts viennent surtout du nombre de pages officielles disponibles.</p>
      <div class="tableau-defile"><table><thead><tr><th>Candidat</th><th>Pages suivies</th><th>Versions archivées</th><th>Phrases de programme</th><th>Passages publiés</th><th>Événements</th></tr></thead><tbody>${lignes}</tbody></table></div>

      <h2>Journal des corrections et modifications</h2>
      <p>Chaque modification du registre (statuts, événements, sources, pages suivies), avec le détail exact de ce qui a changé. Les captures quotidiennes automatiques n'y figurent pas ; elles sont dans la <a href="#/veille">veille</a>.</p>
      ${journal ? `<ol class="journal">${journal}</ol>` : `<p class="vide">Le journal sera calculé à la prochaine publication.</p>`}

      <h2>Télécharger</h2>
      <ul>
        ${fichiers.map(([f, l]) => `<li><a href="data/${f}">${f}</a> : ${l}</li>`).join("")}
        <li>${lienExterne(`${DEPOT}/archive/refs/heads/main.zip`, "Archive complète du projet")} (code, données et textes capturés)</li>
        <li><a href="flux.xml">Flux RSS (Atom) du relevé</a>, et un flux par candidat depuis chaque fiche</li>
      </ul>
    </section>`;
}

function vueMethode() {
  return `
    <section class="texte">
      <h1>Méthode</h1>
      <p class="chapeau">Relevé montre ce qui a changé dans la campagne, avec la preuve. Ces règles s'appliquent à tous les candidats de la même façon.</p>

      <h2>Ce que Relevé publie</h2>
      <ul>
        <li>Des événements datés (candidatures, investitures, calendrier), chacun avec au moins une source et sa date.</li>
        <li>Des propositions uniquement avec la phrase exacte, entre guillemets, sa date et au moins une source primaire archivée. À défaut de source primaire, la proposition porte la mention « rapportée par la presse ».</li>
        <li>Chaque jour, de façon automatique, les phrases ajoutées ou retirées sur les pages de programme officielles, copiées mot pour mot, avec la page et le texte archivé avant et après. Quand une phrase retirée et une phrase ajoutée lors de la même capture se ressemblent fortement, elles sont présentées ensemble, en avant/après, avec les mots changés marqués.</li>
        <li>Les phrases actuelles des pages de programme, classées par thème (voir ci-dessous).</li>
        <li>Les fonctions occupées par chaque candidat, lues automatiquement dans Wikidata, base collaborative, avec un lien pour vérifier.</li>
        <li>Quand elles existent, les vérifications publiées par des médias de fact-checking et mentionnant un candidat, avec le verdict de l'éditeur, cité tel quel.</li>
      </ul>

      <h2>Thèmes</h2>
      <p>Une phrase est rangée dans un thème si elle contient l'un des mots-clés de ce thème, sans tenir compte des accents ni des majuscules. La liste des mots-clés est affichée sur chaque page de thème. Ce classement est mécanique : il peut ranger une phrase dans un thème qui ne lui correspond pas, ou en oublier une. Il ne mesure pas l'importance d'un sujet pour un candidat, seulement la présence de mots sur ses pages suivies. Aucune intelligence artificielle n'est utilisée.</p>

      <h2>Ce que Relevé ne fait pas</h2>
      <ul>
        <li>Pas de classement, de note ni de label « bon » ou « mauvais ».</li>
        <li>Pas de sondages.</li>
        <li>Pas de reformulation entre guillemets, pas de « contradiction » automatique : on écrit « évolution documentée » et on montre les deux versions datées.</li>
        <li>Pas de couleurs de parti.</li>
        <li>Aucun texte rédigé, résumé ou interprété automatiquement : la partie automatique ne publie que des citations exactes.</li>
      </ul>

      <h2>Hiérarchie des sources</h2>
      <ol>
        <li>Textes officiels et institutionnels (Conseil constitutionnel, Journal officiel, Assemblée, Sénat).</li>
        <li>Documents publiés par les candidats et partis.</li>
        <li>Enregistrements intégraux.</li>
        <li>Presse de référence citant une déclaration.</li>
        <li>Analyses, commentaires et sites tiers, affichés comme tels et jamais comme preuve d'une position.</li>
      </ol>
      <p>Quand les sources divergent, Relevé les affiche côte à côte et marque le statut « incertain », sans trancher.</p>

      <h2>Règle de sélection des candidats</h2>
      <p>Jusqu'à la liste officielle, toute personne ayant déclaré sa candidature selon au moins deux médias nationaux a une fiche minimale, présentée avec le même gabarit. Le suivi approfondi des propositions couvrira les candidats investis par une formation ayant des élus au Parlement, ou mesurés à 3 % ou plus dans au moins deux sondages publiés le mois précédent. Cette liste est revue le 1er de chaque mois. Dès la publication de la liste officielle, tous les candidats officiels seront suivis au même niveau.</p>
      <p>Les procédures judiciaires sont décrites par leur stade (mise en examen, condamnation non définitive, définitive) et leur source.</p>

      <h2>Veille et archives</h2>
      <p>Les pages officielles suivies sont capturées chaque jour. Relevé respecte les règles d'accès des sites (robots.txt), garde une copie du texte et demande une copie publique à Internet Archive.</p>
      <p>Sur les pages de programme, Relevé publie sans relecture les phrases réellement ajoutées ou retirées. Un filtre écarte les menus, boutons, dates isolées et textes communs à tout le site ; un simple déplacement de paragraphe n'est pas compté. Ces cartes sont marquées « publication automatique ». Elles disent ce que la page affiche, pas ce que le candidat pense : une phrase retirée d'une page n'est pas forcément un renoncement. Les pages d'accueil et les agendas restent dans la veille, sans carte.</p>

      <h2>Erreurs et corrections</h2>
      <p>Chaque fiche a un lien « Signaler une erreur ». Une carte automatique erronée (bruit, mauvaise page) est retirée sur signalement. Les corrections sont faites dans les données publiques du projet et listées dans le <a href="#/donnees">journal des corrections</a>, avec le détail de chaque modification.</p>

      <h2>Données ouvertes</h2>
      <p>Toutes les données sont téléchargeables, avec des statistiques de couverture par candidat : <a href="#/donnees">données ouvertes et transparence</a>. Un <a href="flux.xml">flux RSS</a> permet d'être prévenu sans compte.</p>

      <h2>Vos données</h2>
      <p>Pas de compte, pas de cookie, pas de mesure d'audience, pas de publicité. Les candidats et thèmes que vous suivez, les changements marqués comme lus et la date de votre dernière visite sont stockés uniquement dans ce navigateur. La recherche se fait aussi sur votre appareil. Rien n'est envoyé à un serveur. <a href="#/suivis">Voir ou effacer mes données</a>.</p>

      <h2>Mentions légales</h2>
      <p>Relevé est un projet personnel, non commercial et indépendant de tout parti et de tout candidat. Hébergement : GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (GitHub Pages). Contact : <a href="${DEPOT}/issues">via le dépôt du projet</a>.</p>
      <p>Code et données sous licence ouverte ; voir le dépôt. Les citations de candidats et de médias restent la propriété de leurs auteurs et sont limitées à de courtes citations.</p>
    </section>`;
}

function vueSuivis() {
  const suivis = stockage.suivis.map((id) => donnees.candidatsParId[id]).filter(Boolean);
  const themes = stockage.themes.map((id) => donnees.themesParId[id]).filter(Boolean);
  return `
    <section class="texte">
      <h1>Mes suivis et mes données</h1>
      <p class="chapeau">Tout ce qui suit est stocké dans ce navigateur, sur cet appareil. Rien n'est envoyé ailleurs.</p>
      <h2>Candidats suivis</h2>
      ${suivis.length
        ? `<ul class="liste">${suivis.map((c) => `<li class="ligne"><a class="ligne-lien" href="#/candidat/${c.id}"><span class="ligne-nom">${echapper(nomComplet(c))}</span></a><a class="source-meta" href="flux/${echapper(c.id)}.xml">Flux RSS</a>${boutonSuivi(c)}</li>`).join("")}</ul>`
        : `<p class="vide">Vous ne suivez aucun candidat : le relevé porte sur tous.</p>`}
      <h2>Thèmes suivis</h2>
      ${themes.length
        ? `<ul class="liste">${themes.map((t) => `<li class="ligne"><a class="ligne-lien" href="#/theme/${t.id}"><span class="ligne-nom">${echapper(t.libelle)}</span></a>${boutonTheme(t)}</li>`).join("")}</ul>`
        : `<p class="vide">Vous ne suivez aucun thème : le relevé porte sur tous. <a href="#/themes">Choisir des thèmes</a></p>`}
      <h2>Être prévenu sans compte</h2>
      <p>Abonnez-vous au <a href="flux.xml">flux RSS du relevé</a> (ou au flux d'un candidat) dans une application de lecture de flux, ou dans un service qui envoie les flux par e-mail. Relevé ne connaît pas ses abonnés.</p>
      <h2>Lecture</h2>
      <p>${stockage.lus.length} changement${stockage.lus.length > 1 ? "s" : ""} marqué${stockage.lus.length > 1 ? "s" : ""} comme lu${stockage.lus.length > 1 ? "s" : ""}.</p>
      <h2>Dernière visite</h2>
      <p>${visitePrecedente ? formaterHorodatage(visitePrecedente) : "C'est votre première visite sur cet appareil."}</p>
      <div class="actions">
        <button class="bouton" id="exporter">Exporter mes données</button>
        <button class="bouton bouton-danger" id="effacer">Tout effacer</button>
      </div>
      <p class="source-meta" id="message-donnees" role="status"></p>
    </section>`;
}

// ---------- Routage et interactions ----------

function afficher() {
  const [, route = "releve", param] = (location.hash || "#/releve").split("/");
  const vues = {
    releve: vueReleve, candidats: vueCandidats, candidat: vueCandidat, themes: vueThemes, theme: vueTheme,
    chercher: vueChercher, calendrier: vueCalendrier, veille: vueVeille, methode: vueMethode, suivis: vueSuivis,
    donnees: vueDonnees,
  };
  const main = document.getElementById("contenu");
  main.innerHTML = (vues[route] || vueReleve)(param);
  const onglet = { candidat: "candidats", theme: "themes", donnees: "methode" }[route] || route;
  document.querySelectorAll("[data-onglet]").forEach((a) => {
    if (a.dataset.onglet === onglet) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

document.addEventListener("click", (ev) => {
  const cible = ev.target.closest("button");
  if (!cible) return;
  if (cible.dataset.suivre) {
    basculerSuivi(cible.dataset.suivre);
    afficher();
  } else if (cible.dataset.suivreTheme) {
    basculerTheme(cible.dataset.suivreTheme);
    afficher();
  } else if (cible.dataset.lu) {
    marquerLus([cible.dataset.lu], !stockage.lus.includes(cible.dataset.lu));
    afficher();
  } else if (cible.dataset.toutLu) {
    marquerLus(cible.dataset.toutLu.split(" "));
    afficher();
  } else if (cible.dataset.voirLus) {
    stockage.voirLus = !stockage.voirLus;
    ecrireStockage(stockage);
    afficher();
  } else if (cible.dataset.type) {
    stockage.type = cible.dataset.type;
    ecrireStockage(stockage);
    afficher();
  } else if (cible.dataset.duree) {
    stockage.duree = cible.dataset.duree;
    ecrireStockage(stockage);
    afficher();
  } else if (cible.dataset.periode) {
    stockage.periode = cible.dataset.periode;
    ecrireStockage(stockage);
    afficher();
  } else if (cible.dataset.ordre) {
    stockage.ordre = cible.dataset.ordre;
    ecrireStockage(stockage);
    afficher();
  } else if (cible.id === "exporter") {
    const blob = new Blob([JSON.stringify(lireStockage(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "releve-mes-donnees.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (cible.id === "effacer") {
    try {
      localStorage.removeItem(CLE);
    } catch {}
    stockage.suivis = [];
    stockage.themes = [];
    stockage.lus = [];
    stockage.periode = null;
    stockage.ordre = null;
    stockage.type = null;
    stockage.duree = null;
    stockage.voirLus = false;
    document.getElementById("message-donnees").textContent = "Vos données ont été effacées de cet appareil.";
    setTimeout(afficher, 1200);
  }
});

// Recherche : les résultats se mettent à jour pendant la frappe, sans redessiner le champ.
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "requete" && ev.target.id !== "filtre-candidat") return;
  const requete = document.getElementById("requete").value;
  const candidat = document.getElementById("filtre-candidat").value;
  document.getElementById("resultats").innerHTML = requete.trim() ? resultatsRecherche(requete, candidat) : "";
  history.replaceState(null, "", `#/chercher/${encodeURIComponent(requete)}`);
});

window.addEventListener("hashchange", () => {
  afficher();
  document.getElementById("contenu").focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

// Installation de la PWA (Android, ordinateur). Sur iOS : Partager puis « Sur l'écran d'accueil ».
let invitation = null;
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  invitation = ev;
  document.getElementById("installer").hidden = false;
});
document.getElementById("installer").addEventListener("click", async () => {
  if (!invitation) return;
  invitation.prompt();
  await invitation.userChoice;
  invitation = null;
  document.getElementById("installer").hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

charger().then(afficher);
