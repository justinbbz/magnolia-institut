/* Magnolia institut — page de remerciement après le paiement Stripe.
   Lit ?session_id=…, interroge /api/statut (qui confirme le rendez-vous dans l'agenda si besoin), affiche le résumé. */
(() => {
  'use strict';
  const CFG = window.MAGNOLIA || {};
  const API = (CFG.API_BASE || '').replace(/\/$/, '') + '/api';
  const box = document.getElementById('etat');
  const NB = ' ';
  const TEL = '+33609875341', TEL_AFFICHE = '06 09 87 53 41';
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const eur = c => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace('.', ',')) + NB + '€';
  const duree = m => { const h = Math.floor(m / 60), r = m % 60; return !h ? m + NB + 'min' : r ? h + NB + 'h' + NB + pad(r) : h + NB + 'h'; };
  const dateLongue = s => { const d = new Date(s + 'T12:00:00Z'); const t = JOURS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MOIS[d.getUTCMonth()]; return t.charAt(0).toUpperCase() + t.slice(1); };

  const id = new URLSearchParams(location.search).get('session_id') || '';
  const vue = (titre, corps, eyebrow = 'Votre rendez-vous') => { box.innerHTML = `<p class="eyebrow">${eyebrow}</p><h1>${titre}</h1>${corps}`; const h = box.querySelector('h1'); h.tabIndex = -1; h.focus({ preventScroll: true }); };

  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) {
    vue('Aucun paiement à vérifier', `<p>Cette page s'affiche après un paiement en ligne. <a href="index.html">Retourner au site</a>, ou appelez-nous au <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p>`);
    return;
  }
  try { sessionStorage.removeItem('magnolia_resa_v1'); } catch (e) { /* ignore */ }

  let reg = null, essais = 0;
  const affiche = rdv => {
    const lignes = rdv.services.map(s => `<li>${esc(s.nom)}${s.detail ? ` <small>${esc(s.detail)}</small>` : ''}</li>`).join('');
    const paiement = rdv.reste > 0 ? `Acompte réglé : <strong>${eur(rdv.paye)}</strong>. Reste à régler à l'institut : <strong>${eur(rdv.reste)}</strong>.` : `Réglé en ligne : <strong>${eur(rdv.paye)}</strong>. Rien à régler à l'institut.`;
    vue('Rendez-vous confirmé', `
      <p class="bk__lead">Merci${rdv.prenom ? ' ' + esc(rdv.prenom) : ''} ! Un e-mail de confirmation vous est envoyé${rdv.email ? ' à ' + esc(rdv.email) : ''}.</p>
      <div class="recap">
        <div class="recap__when"><svg aria-hidden="true"><use href="#i-calendar"/></svg><div><strong>${esc(dateLongue(rdv.date))}</strong><span>à ${esc(rdv.heure.replace(':', 'h'))} · ${duree(rdv.duree)}</span></div></div>
        <ul class="recap__items recap__items--plain">${lignes}</ul>
        <p>${paiement}</p>
        <p class="recap__who"><svg aria-hidden="true" class="inl"><use href="#i-pin"/></svg> ${rdv.rueConnue ? esc(rdv.lieu) : `${esc(reg.adresse.ville)} (${esc(reg.adresse.codePostal)}) · adresse exacte dans l'e-mail de confirmation`} · Réf. ${esc(rdv.ref || '')}</p>
      </div>
      <div class="done__actions" style="justify-content:flex-start">
        <button class="btn btn--dark" type="button" id="ics"><span>Ajouter à mon agenda (.ics)</span></button>
        <a class="btn btn--line" target="_blank" rel="noopener" href="${esc(window.MagnoliaAgenda.lienGoogle(rdv, reg))}"><span>Google Agenda</span></a>
      </div>
      <p class="done__tel" style="text-align:left">Annulation ou report gratuit jusqu'à ${reg.reservation.annulationHeures}${NB}heures avant : appelez-nous au <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p>`);
    document.getElementById('ics').addEventListener('click', () => window.MagnoliaAgenda.telecharger(rdv, reg));
  };

  async function verifier() {
    try {
      const r = await fetch(`${API}/statut?session_id=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.etat === 'confirme' && d.rdv) return affiche(d.rdv);
      if (r.ok && d.etat === 'expire') return vue('Session de paiement expirée', `<p>Le paiement n'a pas été effectué et le créneau a été libéré. <a href="index.html#reserver">Choisir un nouveau créneau</a>.</p>`);
      if (r.ok && d.etat === 'perdu') return vue('Paiement reçu : un instant', `<p>Nous avons bien reçu votre paiement, mais votre créneau doit être vérifié par Magnolia, qui vous contacte très vite. Vous pouvez aussi nous appeler au <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p>`);
      if (r.ok && ++essais < 12) return setTimeout(verifier, 2500);
      throw new Error(d.message || 'statut');
    } catch (e) {
      vue('Nous n\'avons pas pu vérifier votre rendez-vous', `<p>Si votre paiement a abouti, vous allez recevoir un e-mail de confirmation. En cas de doute, appelez-nous au <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p>`);
    }
  }
  fetch('data/reglages.json').then(r => r.json()).then(r => { reg = r; verifier(); }).catch(() => vue('Une erreur est survenue', `<p>Appelez-nous au <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p>`));
})();
