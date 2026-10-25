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

const stockage = Object.assign({ suivis: [], derniereVisite: null, periode: null }, lireStockage());
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

// ---------- Données ----------

const donnees = {};

async function charger() {
  const noms = ["candidats", "evenements", "calendrier", "sources", "veille", "auto"];
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
}

// ---------- Outils d'affichage ----------

const echapper = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function formaterDate(iso, precision) {
  if (!iso) return "date non précisée";
  const [a, m, j] = iso.slice(0, 10).split("-").map(Number);
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
  const liens = ids
    .map((id) => donnees.sourcesParId[id])
    .filter(Boolean)
    .map(
      (s) =>
        `<a href="${echapper(s.url)}" rel="noopener" target="_blank">${echapper(s.editeur)}</a>` +
        `<span class="source-meta">${echapper(LIBELLES_TYPE_SOURCE[s.type] || s.type)}${s.date_publication ? `, ${formaterCourt(s.date_publication)}` : ""}</span>`
    );
  return `<p class="sources"><span class="sources-titre">Sources</span> ${liens.join('<span class="sep">·</span>')}</p>`;
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

function vueReleve() {
  const evenements = donnees.evenements?.evenements || [];
  const changements = donnees.veille?.changements || [];
  const suivis = stockage.suivis;
  const periode = stockage.periode || (visitePrecedente ? "visite" : "30");

  const concerne = (cands) => !suivis.length || !cands.length || cands.some((id) => suivis.includes(id));
  const depuis =
    periode === "visite" ? visitePrecedente :
    periode === "tout" ? null :
    new Date(Date.now() - Number(periode) * JOUR);

  // En mode « dernière visite », on retient ce qui a été ajouté au registre depuis ;
  // sinon, ce qui s'est passé pendant la période choisie.
  const dansPeriode = (e) => {
    if (!depuis) return true;
    const d = periode === "visite" ? new Date(`${e.ajoute_le}T23:59:59`) : dateDe(e.date);
    return d > depuis;
  };

  const retenus = evenements
    .filter((e) => concerne(e.candidats) && dansPeriode(e))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const passagesRetenus = (donnees.auto?.passages || []).filter(
    (p) => concerne([p.candidat]) && (!depuis || new Date(p.date) > depuis)
  );
  const veilleRetenue = changements.filter(
    (c) => concerne([c.candidat]) && (!depuis || new Date(c.date) > depuis)
  );

  // Événements relus et passages automatiques, du plus récent au plus ancien.
  const fil = [
    ...retenus.map((e) => ({ date: e.date || "", html: () => carteEvenement(e) })),
    ...passagesRetenus.map((p) => ({ date: p.date, html: () => cartePassage(p) })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const nb = fil.length;
  const titre = nb === 0 ? "Aucun changement" : nb === 1 ? "1 changement" : `${nb} changements`;
  const portee = suivis.length
    ? `sur ${suivis.length === 1 ? "le candidat que vous suivez" : `les ${suivis.length} candidats que vous suivez`}`
    : "sur l'ensemble des candidats";

  const selecteur = PERIODES.filter(([v]) => v !== "visite" || visitePrecedente)
    .map(([v, l]) => `<button class="puce${v === periode ? " actif" : ""}" data-periode="${v}" aria-pressed="${v === periode}">${l}</button>`)
    .join("");

  const cartes = fil.map((x) => x.html()).join("");

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

  const rdv = prochainRendezVous();
  const blocVeille = veilleRetenue.length
    ? `<a class="encart" href="#/veille"><strong>${veilleRetenue.length} modification${veilleRetenue.length > 1 ? "s" : ""} détectée${veilleRetenue.length > 1 ? "s" : ""}</strong> sur les pages officielles suivies, y compris menus et actualités. Voir la veille</a>`
    : "";

  return `
    <section class="releve">
      <h1>${titre}</h1>
      <p class="chapeau">${periode === "visite" ? `Depuis votre dernière visite, le ${formaterHorodatage(visitePrecedente)}` : "Sur la période choisie"}, ${portee}.${!visitePrecedente ? " C'est votre première visite : voici les 30 derniers jours." : ""}</p>
      <div class="puces" role="group" aria-label="Période">${selecteur}</div>
      ${!suivis.length ? `<p class="astuce">Suivez des candidats dans l'onglet <a href="#/candidats">Candidats</a> pour ne voir que ce qui vous concerne.</p>` : ""}
      ${blocVeille}
      ${cartes || `<p class="vide">Rien de nouveau sur cette période. Essayez « 30 jours » ou « Tout ».</p>`}
      <div class="a-jour">
        <p><strong>Vous êtes à jour.</strong></p>
        ${rdv ? `<p>Prochain rendez-vous : ${echapper(rdv.titre.toLowerCase())}, le ${formaterDate(rdv.date)}.</p>` : ""}
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

function vueCandidat(id) {
  const c = donnees.candidatsParId[id];
  if (!c) return `<section><h1>Fiche introuvable</h1><p><a href="#/candidats">Retour aux candidats</a></p></section>`;
  const evenements = (donnees.evenements?.evenements || [])
    .filter((e) => e.candidats.includes(id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const passagesCandidat = (donnees.auto?.passages || []).filter((p) => p.candidat === id).reverse().slice(0, 20);
  const pagesVeille = Object.fromEntries((donnees.veille?.pages || []).map((p) => [p.id, p]));
  const pages = c.pages_suivies
    .map((pid) => {
      const p = pagesVeille[pid];
      const etat = !p || !p.premiere_capture
        ? "première capture à venir"
        : `suivie depuis le ${formaterCourt(p.premiere_capture)}, ${p.nombre_versions} version${p.nombre_versions > 1 ? "s" : ""} archivée${p.nombre_versions > 1 ? "s" : ""}`;
      const libelle = p?.libelle || pid;
      const url = p?.url;
      return `<li>${url ? `<a href="${echapper(url)}" rel="noopener" target="_blank">${echapper(libelle)}</a>` : echapper(libelle)}
        <span class="source-meta">${etat}${p?.wayback ? ` · <a href="${echapper(p.wayback)}" rel="noopener" target="_blank">archive</a>` : ""}</span></li>`;
    })
    .join("");
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
      ${passagesCandidat.length
        ? passagesCandidat.map((p) => cartePassage(p, false)).join("")
        : `<p class="vide">Aucun passage ajouté ou retiré depuis le début de la capture.${c.pages_suivies.length ? "" : " Aucune page officielle n'est suivie pour l'instant."}</p>`}

      <h2>Historique</h2>
      ${evenements.length
        ? `<ol class="frise">${evenements.map((e) => `<li><time>${formaterDate(e.date, e.precision)}</time> ${echapper(e.titre)}${ligneSources(e.sources)}</li>`).join("")}</ol>`
        : `<p class="vide">Aucun événement daté relevé pour l'instant.</p>`}

      <h2>Pages officielles suivies</h2>
      ${pages ? `<ul class="pages">${pages}</ul>` : `<p class="vide">Aucune page officielle de programme vérifiée à ce jour.</p>`}
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
      return `<tr><td><a href="${echapper(p.url)}" rel="noopener" target="_blank">${echapper(p.libelle)}</a></td><td>${cand ? echapper(nomComplet(cand)) : ""}</td><td>${echapper(libelleStatut[p.statut] || p.statut)}</td><td>${p.nombre_versions || 0}</td><td>${formaterCourt(p.derniere_reussite)}</td></tr>`;
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

function vueMethode() {
  return `
    <section class="texte">
      <h1>Méthode</h1>
      <p class="chapeau">Relevé montre ce qui a changé dans la campagne, avec la preuve. Ces règles s'appliquent à tous les candidats de la même façon.</p>

      <h2>Ce que Relevé publie</h2>
      <ul>
        <li>Des événements datés (candidatures, investitures, calendrier), chacun avec au moins une source et sa date.</li>
        <li>Des propositions uniquement avec la phrase exacte, entre guillemets, sa date et au moins une source primaire archivée. À défaut de source primaire, la proposition porte la mention « rapportée par la presse ».</li>
        <li>Chaque jour, de façon automatique, les phrases ajoutées ou retirées sur les pages de programme officielles, copiées mot pour mot, avec la page et le texte archivé avant et après.</li>
      </ul>

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
      <p>Chaque fiche a un lien « Signaler une erreur ». Une carte automatique erronée (bruit, mauvaise page) est retirée sur signalement. Les corrections sont faites dans les données publiques du projet, dont l'historique complet est consultable : <a href="${DEPOT}/commits/main">journal des modifications</a>.</p>

      <h2>Vos données</h2>
      <p>Pas de compte, pas de cookie, pas de mesure d'audience, pas de publicité. Les candidats que vous suivez et la date de votre dernière visite sont stockés uniquement dans ce navigateur. Rien n'est envoyé à un serveur. <a href="#/suivis">Voir ou effacer mes données</a>.</p>

      <h2>Mentions légales</h2>
      <p>Relevé est un projet personnel, non commercial et indépendant de tout parti et de tout candidat. Hébergement : GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis (GitHub Pages). Contact : <a href="${DEPOT}/issues">via le dépôt du projet</a>.</p>
      <p>Code et données sous licence ouverte ; voir le dépôt. Les citations de candidats et de médias restent la propriété de leurs auteurs et sont limitées à de courtes citations.</p>
    </section>`;
}

function vueSuivis() {
  const suivis = stockage.suivis.map((id) => donnees.candidatsParId[id]).filter(Boolean);
  return `
    <section class="texte">
      <h1>Mes suivis et mes données</h1>
      <p class="chapeau">Tout ce qui suit est stocké dans ce navigateur, sur cet appareil. Rien n'est envoyé ailleurs.</p>
      <h2>Candidats suivis</h2>
      ${suivis.length
        ? `<ul class="liste">${suivis.map((c) => `<li class="ligne"><a class="ligne-lien" href="#/candidat/${c.id}"><span class="ligne-nom">${echapper(nomComplet(c))}</span></a>${boutonSuivi(c)}</li>`).join("")}</ul>`
        : `<p class="vide">Vous ne suivez aucun candidat : le relevé porte sur tous.</p>`}
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
  const vues = { releve: vueReleve, candidats: vueCandidats, calendrier: vueCalendrier, veille: vueVeille, methode: vueMethode, suivis: vueSuivis };
  const main = document.getElementById("contenu");
  main.innerHTML = route === "candidat" ? vueCandidat(param) : (vues[route] || vueReleve)();
  const onglet = route === "candidat" ? "candidats" : route;
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
    stockage.periode = null;
    stockage.ordre = null;
    document.getElementById("message-donnees").textContent = "Vos données ont été effacées de cet appareil.";
    setTimeout(afficher, 1200);
  }
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
