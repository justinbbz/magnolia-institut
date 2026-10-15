/* Magnolia institut — réglages du navigateur (le reste est dans data/reglages.json et data/catalogue.json).
   Avant la mise en ligne :
   1. DEMO_MODE → false (le bandeau « démonstration » disparaît, les vraies fonctions /api sont appelées : voir BRANCHEMENT.md) ;
   2. retirer <meta name="robots" content="noindex"> dans les pages et mettre « Allow: / » dans robots.txt.
*/
window.MAGNOLIA = {
  /* true : simulation complète (créneaux d'exemple, paiement simulé). Aucun rendez-vous n'est enregistré, aucun paiement n'est prélevé. */
  DEMO_MODE: true,

  /* Adresse des fonctions serveur. Vide = même domaine (Cloudflare Pages Functions, dossier functions/). */
  API_BASE: "",

  /* Film d'ouverture : images lues au défilement (scripts/fabriquer-film.sh ; le nombre d'images est dans hero-seq.js). */
  HERO: {
    frames: (window.MAGNOLIA_FILM && window.MAGNOLIA_FILM.frames) || 140,
    ordinateur: "assets/frames/",
    mobile: "assets/frames-m/"
  },

  VERSION: "1"
};
