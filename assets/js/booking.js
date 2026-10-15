/* Magnolia institut — réservation en ligne : prestations → date et heure → coordonnées → paiement.
   - DEMO_MODE (config.js) : créneaux d'exemple et paiement simulé, rien n'est enregistré, rien n'est prélevé.
   - Sinon : appelle les fonctions /api (disponibilités lues dans Google Agenda, paiement Stripe, voir README).
   Le serveur recalcule toujours les prix et revérifie le créneau : le navigateur n'est jamais cru sur parole. */
(() => {
  'use strict';

  const CFG = window.MAGNOLIA || {};
  const DEMO = CFG.DEMO_MODE !== false;
  const API = (CFG.API_BASE || '').replace(/\/$/, '') + '/api';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const NB = '\u00a0';
  const TEL = '+33609875341', TEL_AFFICHE = '06 09 87 53 41';
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const NOMS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const FUSEAU = 'Europe/Paris';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const nombre = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
  const eur = n => nombre(n) + NB + '€';
  const duree = m => { const h = Math.floor(m / 60), r = m % 60; return !h ? m + NB + 'min' : r ? h + NB + 'h' + NB + pad(r) : h + NB + 'h'; };
  const heureFr = t => t.replace(':', 'h');

  /* ---------- Dates (chaînes AAAA-MM-JJ ; heures de Paris, jamais celles du navigateur) ---------- */
  const dow = s => new Date(s + 'T12:00:00Z').getUTCDay();
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ymd = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
  const partsParis = (ts = Date.now()) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: FUSEAU, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  };
  const todayParis = () => { const p = partsParis(); return ymd(p.y, p.mo - 1, p.d); };
  const nowMinutesParis = () => { const p = partsParis(); return p.h * 60 + p.mi; };
  const dateLongue = s => NOMS_JOURS[dow(s)] + ' ' + Number(s.slice(8)) + ' ' + MOIS[Number(s.slice(5, 7)) - 1];
  const dateLongueMaj = s => { const t = dateLongue(s); return t.charAt(0).toUpperCase() + t.slice(1); };
  const minutesDe = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hhmm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

  /* ---------- État ---------- */
  const S = {
    cat: null, reg: null, services: new Map(), familles: [],
    cart: [], step: 1, family: '', query: '',
    month: null, avail: {}, loading: false, error: '',
    date: '', time: '',
    client: { prenom: '', nom: '', email: '', telephone: '', message: '' },
    paiement: 'acompte', consent: false,
    submitting: false, done: null, reprise: '', openedAt: 0, sim: false, hp: ''
  };
  const STORE = 'magnolia_resa_v1';
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify({ cart: S.cart, date: S.date, time: S.time, client: S.client, paiement: S.paiement, reprise: S.reprise, step: S.step })); } catch (e) { /* navigation privée : on ignore */ } };
  const restore = () => { try { const o = JSON.parse(sessionStorage.getItem(STORE) || 'null'); if (o) { S.cart = Array.isArray(o.cart) ? o.cart : []; S.date = o.date || ''; S.time = o.time || ''; Object.assign(S.client, o.client || {}); S.paiement = o.paiement || 'acompte'; S.reprise = o.reprise || ''; S.step = o.step || 1; } } catch (e) { /* ignore */ } };

  /* ---------- Données ---------- */
  let dataPromise = null;
  function ensureData() {
    if (!dataPromise) {
      dataPromise = Promise.all([fetch('data/catalogue.json').then(r => r.json()), fetch('data/reglages.json').then(r => r.json())]).then(([cat, reg]) => {
        S.cat = cat; S.reg = reg;
        S.familles = [];
        cat.familles.forEach(f => S.familles.push(f));
        S.familles.forEach(f => f.categories.forEach(c => c.services.forEach(s => S.services.set(s.id, { ...s, familleId: f.id, categorie: c.titre }))));
        S.cart = S.cart.filter(id => S.services.has(id) && S.services.get(id).enLigne !== false);
        S.family = S.family || S.familles[0].id;
        return true;
      }).catch(e => { dataPromise = null; throw e; });
    }
    return dataPromise;
  }
  /* Modes de paiement autorisés (data/reglages.json → reservation.paiements) : acompte ou paiement de la totalité. */
  const modes = () => (S.reg && S.reg.reservation.paiements && S.reg.reservation.paiements.length ? S.reg.reservation.paiements : ['acompte', 'total', 'surplace']);
  const modeParDefaut = () => (modes().includes('acompte') ? 'acompte' : modes().includes('total') ? 'total' : modes()[0]);

  const items = () => S.cart.map(id => S.services.get(id)).filter(Boolean);
  function totals() {
    const l = items();
    const min = l.reduce((n, s) => n + (s.prix || 0), 0);
    const max = l.reduce((n, s) => n + (s.prixMax || s.prix || 0), 0);
    return { count: l.length, duree: l.reduce((n, s) => n + s.duree, 0), min, max, range: max > min };
  }
  const prixTxt = t => (t.range ? 'dès' + NB : '') + eur(t.min);
  function depositCents(totalEuros) {
    const r = S.reg.reservation, total = Math.round(totalEuros * 100);
    return Math.min(total, Math.max(Math.round(r.acompteMinimumEuros * 100), Math.round(total * r.acomptePourcent / 100)));
  }
  const surPlaceOk = () => modes().includes('surplace') && totals().max <= S.reg.reservation.paiementSurPlaceJusquaEuros;
  function aPayer() {
    const t = totals(), tc = Math.round(t.min * 100);
    if (!modes().includes(S.paiement) || (S.paiement === 'surplace' && !surPlaceOk())) S.paiement = modeParDefaut();
    if (S.paiement === 'surplace') return { maintenant: 0, reste: tc };
    if (S.paiement === 'total') return { maintenant: tc, reste: 0 };
    const d = depositCents(t.min); return { maintenant: d, reste: tc - d };
  }

  /* ---------- Disponibilités ---------- */
  const availCache = new Map();
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function demoJour(date, dureeMin) {
    // jours de démonstration : mêmes créneaux pour la même date, quelques journées complètes, quelques plages occupées
    const r = S.reg.reservation, h = S.reg.horaires[JOURS[dow(date)]] || [];
    if (!h.length) return [];
    const today = todayParis(); if (date < today || date > addDays(today, r.horizonJours)) return [];
    const seed = hash(date);
    if (seed % 9 === 0) return [];
    const busy = [];
    const n = 2 + (seed % 3);
    for (let i = 0; i < n; i++) { const st = 570 + ((hash(date + i) % 28) * 15); busy.push([st, st + 45 + (hash(date + 'd' + i) % 6) * 15]); }
    const out = [], min = date === today ? nowMinutesParis() + r.delaiMinimumHeures * 60 : 0;
    h.forEach(([o, f]) => {
      for (let t = minutesDe(o); t + dureeMin <= minutesDe(f); t += r.pasCreneauMinutes) {
        if (t < min) continue;
        if (busy.some(([a, b]) => t < b && t + dureeMin > a)) continue;
        out.push(hhmm(t));
      }
    });
    return out;
  }
  async function fetchAvail(y, m) {
    const d = totals().duree, key = d + '|' + y + '-' + m;
    const hit = availCache.get(key); if (hit && Date.now() - hit.t < 45000) return hit.v;
    const today = todayParis();
    const first = ymd(y, m, 1), last = ymd(y, m, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
    const du = first < today ? today : first, au = last;
    let jours = {};
    if (DEMO) {
      await new Promise(r => setTimeout(r, 450));
      for (let c = du; c <= au; c = addDays(c, 1)) { const s = demoJour(c, d); if (s.length) jours[c] = s; }
    } else {
      const r = await fetch(`${API}/disponibilites?duree=${d}&du=${du}&au=${au}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('http ' + r.status);
      jours = (await r.json()).jours || {};
    }
    availCache.set(key, { t: Date.now(), v: jours });
    return jours;
  }

  /* ---------- Agenda du client (.ics, Google Agenda) : voir agenda.js ---------- */
  const lienGoogle = r => window.MagnoliaAgenda.lienGoogle(r, S.reg);
  const telechargerIcs = r => window.MagnoliaAgenda.telecharger(r, S.reg);

  /* ---------- Éléments de l'interface ---------- */
  const dlg = $('#booking');
  let built = false, trigger = null;
  const live = msg => { const l = $('#bkLive'); if (l) { l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 60); } };
  const STEPS = [['1', 'Prestations'], ['2', 'Date et heure'], ['3', 'Coordonnées'], ['4', 'Paiement']];

  function build() {
    if (built) return; built = true;
    dlg.setAttribute('data-lenis-prevent', '');
    dlg.innerHTML = `
<div class="bk">
  <header class="bk__head">
    <p class="bk__brand"><span class="bk__mono" aria-hidden="true">M</span><span class="script">Magnolia</span></p>
    <ol class="bk__steps" id="bkSteps" aria-label="Étapes de la réservation">${STEPS.map(([n, t]) => `<li data-step="${n}"><span class="bk__n" aria-hidden="true">${n}</span><span class="bk__t">${t}</span></li>`).join('')}</ol>
    <button class="bk__close" type="button" id="bkClose" aria-label="Fermer la réservation"><svg aria-hidden="true"><use href="#i-close"/></svg></button>
  </header>
  ${DEMO ? `<p class="bk__demo" role="note"><strong>Mode démonstration.</strong> Aucun rendez-vous n'est enregistré et aucun paiement n'est prélevé.</p>` : ''}
  <div class="bk__body">
    <main class="bk__main" id="bkMain"></main>
    <aside class="bk__aside" id="bkAside" aria-label="Récapitulatif de votre réservation"></aside>
  </div>
  <div class="sr-only" id="bkLive" role="status" aria-live="polite"></div>
</div>`;
    $('#bkClose').addEventListener('click', () => closeDialog());
    dlg.addEventListener('click', e => { if (e.target === dlg && !S.submitting) closeDialog(); });
    dlg.addEventListener('cancel', e => { if (S.submitting) e.preventDefault(); });
    dlg.addEventListener('close', () => { document.documentElement.dispatchEvent(new CustomEvent('magnolia:dialog', { detail: false })); if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true }); updatePill(); });
    // un seul gestionnaire d'événements pour toute la fenêtre
    dlg.addEventListener('click', onClick); dlg.addEventListener('change', onChange); dlg.addEventListener('input', onInput); dlg.addEventListener('keydown', onKey); dlg.addEventListener('submit', e => e.preventDefault());
  }

  async function openDialog(opts = {}) {
    build(); trigger = opts.trigger || document.activeElement;
    try { await ensureData(); } catch (e) { alert('La réservation en ligne est momentanément indisponible. Appelez le ' + TEL_AFFICHE + '.'); return; }
    if (opts.family && S.familles.some(f => f.id === opts.family)) S.family = opts.family;
    if (opts.service && S.services.has(opts.service) && !S.cart.includes(opts.service)) S.cart.push(opts.service);
    if (opts.step) S.step = opts.step;
    if (S.done) { S.done = null; S.step = 1; }
    if (!S.openedAt) S.openedAt = Date.now();
    const hasSel = S.cart.length > 0;
    if (!hasSel) S.step = 1;
    if (S.step > 2 && !(S.date && S.time)) S.step = hasSel ? 2 : 1;
    if (!dlg.open) { dlg.showModal(); document.documentElement.dispatchEvent(new CustomEvent('magnolia:dialog', { detail: true })); }
    render(true);
  }
  function closeDialog() { if (dlg.open) dlg.close(); }

  /* ---------- Rendu ---------- */
  function render(focusTitle) {
    const stepsEl = $('#bkSteps');
    $$('li', stepsEl).forEach(li => { const n = +li.dataset.step; li.classList.toggle('is-current', n === S.step && !S.done); li.classList.toggle('is-done', n < S.step || !!S.done); if (n === S.step && !S.done) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    const main = $('#bkMain');
    if (S.done) main.innerHTML = vueConfirmation();
    else if (S.sim) main.innerHTML = vueSimulation();
    else if (S.step === 1) main.innerHTML = vuePrestations();
    else if (S.step === 2) main.innerHTML = vueDate();
    else if (S.step === 3) main.innerHTML = vueCoordonnees();
    else main.innerHTML = vueRecap();
    $('#bkAside').innerHTML = S.done ? vueAsideDone() : vueAside();
    dlg.classList.toggle('is-done', !!S.done);
    if (S.step === 1 && !S.done) renderListe();
    if (S.step === 2 && !S.done && !S.sim) chargerMois();
    syncRows(); updatePill(); save();
    if (focusTitle) {
      const h = $('#bk-title'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      $('#bkMain').scrollTop = 0; const body = $('.bk__body'); if (body) body.scrollTop = 0;
      live(S.done ? (S.done.demo ? 'Simulation terminée' : 'Rendez-vous confirmé') : 'Étape ' + S.step + ' sur 4 : ' + STEPS[S.step - 1][1]);
    }
  }

  /* Étape 1 — prestations */
  function vuePrestations() {
    const chips = [`<button type="button" class="chip${S.family === 'tout' ? ' is-on' : ''}" data-family="tout" aria-pressed="${S.family === 'tout'}">Tout</button>`]
      .concat(S.familles.map(f => `<button type="button" class="chip${S.family === f.id ? ' is-on' : ''}" data-family="${f.id}" aria-pressed="${S.family === f.id}">${esc(f.nom)}</button>`)).join('');
    return `<h2 class="bk__title" id="bk-title">Choisissez vos soins</h2>
<p class="bk__lead">Un ou plusieurs soins, dans le même rendez-vous. Les durées indiquées sont celles du rendez-vous.</p>
<div class="bk__search"><label for="bkSearch" class="sr-only">Rechercher un soin</label><input id="bkSearch" type="search" placeholder="Rechercher : massage, visage, jambes…" value="${esc(S.query)}" autocomplete="off" enterkeyhint="search"></div>
<div class="chips" role="group" aria-label="Familles de soins">${chips}</div>
<div id="bkList" class="bk__list"></div>`;
  }
  function renderListe() {
    const q = norm(S.query).trim(), box = $('#bkList'); if (!box) return;
    const fams = q || S.family === 'tout' ? S.familles : S.familles.filter(f => f.id === S.family);
    const max = S.reg.reservation.maxPrestations;
    let n = 0, html = '';
    fams.forEach(f => f.categories.forEach(c => {
      const list = c.services.filter(s => !q || norm(s.nom + ' ' + (s.detail || '') + ' ' + (s.description || '') + ' ' + c.titre + ' ' + f.nom).includes(q));
      if (!list.length) return; n += list.length;
      html += `<section class="bkcat" aria-labelledby="bkc-${c.id}"><h3 id="bkc-${c.id}">${esc(c.titre)}</h3>${c.intro && !q ? `<p class="bkcat__intro">${esc(c.intro)}</p>` : ''}<ul class="svcs">${list.map(s => ligneService(s, max)).join('')}</ul></section>`;
    }));
    box.innerHTML = n ? html : `<p class="bk__empty">Aucun soin ne correspond à « ${esc(S.query)} ». Essayez un autre mot, ou appelez-nous au <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p>`;
  }
  function ligneService(s, max) {
    const on = S.cart.includes(s.id), full = !on && S.cart.length >= max;
    const prix = s.sur_devis ? 'Sur devis' : s.prixMax ? `de${NB}${nombre(s.prix)}${NB}à${NB}${eur(s.prixMax)}` : eur(s.prix);
    const meta = `<span class="svc__meta"><span class="svc__dur">${s.dureeEstimee ? '≈' + NB : ''}${duree(s.duree)}</span><span class="svc__price">${prix}${s.ancien ? `<s>${eur(s.ancien)}</s>` : ''}</span></span>`;
    const main = `<span class="svc__main"><span class="svc__name">${esc(s.nom)}${s.detail ? ` <small>${esc(s.detail)}</small>` : ''}</span>${s.description ? `<span class="svc__desc">${esc(s.description)}</span>` : ''}</span>`;
    if (s.enLigne === false) return `<li class="svc svc--call"><div class="svc__row">${main}${meta}<a class="btn btn--line btn--sm" href="tel:${TEL}">Appeler<span class="sr-only"> le ${TEL_AFFICHE} pour réserver ${esc(s.nom)}</span></a></div></li>`;
    return `<li class="svc${on ? ' is-on' : ''}${full ? ' is-off' : ''}"><label class="svc__row"><input class="svc__cb" type="checkbox" value="${esc(s.id)}"${on ? ' checked' : ''}${full ? ' disabled' : ''}><span class="svc__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>${main}${meta}</label></li>`;
  }

  /* Étape 2 — date et heure */
  function moisDepart() {
    if (S.date) return { y: +S.date.slice(0, 4), m: +S.date.slice(5, 7) - 1 };
    const t = todayParis(); return { y: +t.slice(0, 4), m: +t.slice(5, 7) - 1 };
  }
  function vueDate() {
    if (!S.month) S.month = moisDepart();
    const t = totals();
    return `<h2 class="bk__title" id="bk-title">Quand souhaitez-vous venir ?</h2>
<p class="bk__lead">Rendez-vous de <strong>${duree(t.duree)}</strong>. Seuls les horaires réellement libres sont proposés.</p>
<div class="when">
  <div class="when__cal" id="bkCal"></div>
  <div class="when__slots" id="bkSlots" aria-live="polite"></div>
</div>`;
  }
  async function chargerMois() {
    const {y, m} = S.month; S.loading = true; S.error = ''; dessinerCalendrier(); dessinerCreneaux();
    const key = y + '-' + m, token = (S._tok = (S._tok || 0) + 1);
    try {
      const jours = await fetchAvail(y, m);
      if (token !== S._tok) return;
      S.avail[key] = jours; S.loading = false;
      // si aucune date n'est choisie (ou si elle n'a plus de créneau), propose la première date libre du mois
      if (!S.date || !(S.avail[S.date.slice(0, 4) + '-' + (+S.date.slice(5, 7) - 1)] || {})[S.date]) {
        const first = Object.keys(jours).sort()[0];
        if (first && (!S.date || S.date.slice(0, 7) === first.slice(0, 7))) { S.date = first; S.time = ''; }
        else if (!first) { /* mois complet : on laisse choisir un autre mois */ }
      } else if (S.time && !(S.avail[key][S.date] || []).includes(S.time)) S.time = '';
    } catch (e) {
      if (token !== S._tok) return;
      S.loading = false; S.error = 'Impossible de charger les disponibilités pour le moment.';
    }
    dessinerCalendrier(); dessinerCreneaux(); majAside();
  }
  function dessinerCalendrier() {
    const box = $('#bkCal'); if (!box) return;
    const { y, m } = S.month, key = y + '-' + m, jours = S.avail[key] || {};
    const today = todayParis(), horizon = addDays(today, S.reg.reservation.horizonJours);
    const premierDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7, nb = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const tm = today.slice(0, 4) * 12 + (+today.slice(5, 7) - 1), cur = y * 12 + m, hm = horizon.slice(0, 4) * 12 + (+horizon.slice(5, 7) - 1);
    let cells = '', day = 1;
    const focusDate = S.date && S.date.slice(0, 7) === ymd(y, m, 1).slice(0, 7) ? S.date : (Object.keys(jours).sort()[0] || ymd(y, m, 1));
    for (let r = 0; r < 6 && day <= nb; r++) {
      cells += '<tr>';
      for (let c = 0; c < 7; c++) {
        if ((r === 0 && c < premierDow) || day > nb) { cells += '<td></td>'; continue; }
        const d = ymd(y, m, day), slots = jours[d] || [], dispo = slots.length > 0, sel = d === S.date;
        const lib = S.loading ? 'chargement' : dispo ? slots.length + (slots.length > 1 ? ' créneaux' : ' créneau') : (d < today ? 'passé' : d > horizon ? 'hors période de réservation' : dow(d) === 0 ? 'fermé' : 'complet');
        cells += `<td><button type="button" class="day${sel ? ' is-sel' : ''}${dispo ? ' is-ok' : ''}${d === today ? ' is-today' : ''}" data-date="${d}" tabindex="${d === focusDate ? 0 : -1}" ${dispo ? '' : 'aria-disabled="true"'} aria-pressed="${sel}" aria-label="${esc(dateLongue(d))} : ${lib}"><span>${day}</span></button></td>`;
        day++;
      }
      cells += '</tr>';
    }
    box.innerHTML = `<div class="cal__head"><button type="button" class="cal__nav" data-nav="-1" aria-label="Mois précédent"${cur <= tm ? ' disabled' : ''}><svg aria-hidden="true" style="transform:scaleX(-1)"><use href="#i-arrow"/></svg></button>
<p class="cal__title" id="calTitle" aria-live="polite">${MOIS[m]} ${y}</p>
<button type="button" class="cal__nav" data-nav="1" aria-label="Mois suivant"${cur >= hm ? ' disabled' : ''}><svg aria-hidden="true"><use href="#i-arrow"/></svg></button></div>
<table class="cal" role="grid" aria-labelledby="calTitle"><thead><tr>${['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map(j => `<th scope="col" abbr="${j}">${j.slice(0, 1).toUpperCase()}</th>`).join('')}</tr></thead><tbody>${cells}</tbody></table>
<p class="cal__legend"><i class="lg lg--ok"></i> Disponible <i class="lg lg--no"></i> Complet ou fermé</p>${S.loading ? '<p class="cal__load" role="status">Chargement des disponibilités…</p>' : ''}`;
  }
  function dessinerCreneaux() {
    const box = $('#bkSlots'); if (!box) return;
    if (S.error) { box.innerHTML = `<div class="bk__alert" role="alert"><p>${esc(S.error)}</p><p><button type="button" class="btn btn--line btn--sm" data-act="retry">Réessayer</button> ou appelez le <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p></div>`; return; }
    if (S.loading) { box.innerHTML = '<div class="skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>'; return; }
    const key = S.month.y + '-' + S.month.m, jours = S.avail[key] || {};
    if (!Object.keys(jours).length) { box.innerHTML = `<div class="bk__empty"><p>Aucune disponibilité ce mois-ci pour ${duree(totals().duree)}.</p><p><button type="button" class="btn btn--line btn--sm" data-nav="1"${'' }>Voir le mois suivant</button></p></div>`; return; }
    if (!S.date) { box.innerHTML = '<p class="bk__empty">Choisissez un jour dans le calendrier.</p>'; return; }
    const slots = (S.avail[S.date.slice(0, 4) + '-' + (+S.date.slice(5, 7) - 1)] || {})[S.date] || [];
    if (!slots.length) { box.innerHTML = '<p class="bk__empty">Choisissez un jour disponible dans le calendrier.</p>'; return; }
    const group = (titre, arr) => arr.length ? `<p class="slots__group">${titre}</p><div class="slots__grid">${arr.map(t => `<label class="slot"><input type="radio" name="slot" value="${t}"${t === S.time ? ' checked' : ''}><span>${heureFr(t)}</span></label>`).join('')}</div>` : '';
    box.innerHTML = `<fieldset class="slots"><legend>Horaires disponibles, ${esc(dateLongue(S.date))}</legend>${group('Matin', slots.filter(t => minutesDe(t) < 720))}${group('Après-midi', slots.filter(t => minutesDe(t) >= 720))}</fieldset>`;
  }

  /* Étape 3 — coordonnées */
  function vueCoordonnees() {
    if (!modes().includes(S.paiement) || (S.paiement === 'surplace' && !surPlaceOk())) S.paiement = modeParDefaut();
    const c = S.client, t = totals(), r = S.reg.reservation, acompte = depositCents(t.min) / 100;
    const permis = modes().filter(m => m !== 'surplace' || surPlaceOk());
    const opt = (id, titre, texte, solo) => `<label class="pay${S.paiement === id ? ' is-on' : ''}${solo ? ' pay--solo' : ''}"><input type="radio" name="paiement" value="${id}"${S.paiement === id ? ' checked' : ''}${solo ? ' disabled' : ''}><span class="pay__dot" aria-hidden="true"></span><span class="pay__txt"><strong>${titre}</strong><small>${texte}</small></span></label>`;
    const solo = permis.length === 1;
    const choix = [
      permis.includes('acompte') ? opt('acompte', `Acompte de ${r.acomptePourcent}${NB}% : ${eur(acompte)}`, `Maintenant, par carte bancaire. Le reste (${eur(Math.round((t.min - acompte) * 100) / 100)}) se règle à l'institut.`, solo) : '',
      permis.includes('total') ? opt('total', `Paiement en ligne : ${prixTxt(t)}`, 'Maintenant, par carte bancaire. Rien à régler à l\'institut.', solo) : '',
      permis.includes('surplace') ? opt('surplace', 'Régler à l\'institut', 'Aucun paiement maintenant. Disponible pour les rendez-vous de petit montant.', solo) : ''
    ].join('');
    return `<h2 class="bk__title" id="bk-title">Vos coordonnées</h2>
<p class="bk__lead">Elles servent uniquement à confirmer et à gérer votre rendez-vous.</p>
<form class="form" id="bkForm" novalidate>
  <div class="form__row">
    <div class="field"><label for="f-prenom">Prénom <span aria-hidden="true">*</span></label><input id="f-prenom" name="prenom" autocomplete="given-name" required value="${esc(c.prenom)}"><p class="field__err" id="e-prenom" hidden></p></div>
    <div class="field"><label for="f-nom">Nom <span aria-hidden="true">*</span></label><input id="f-nom" name="nom" autocomplete="family-name" required value="${esc(c.nom)}"><p class="field__err" id="e-nom" hidden></p></div>
  </div>
  <div class="form__row">
    <div class="field"><label for="f-email">E-mail <span aria-hidden="true">*</span></label><input id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(c.email)}" aria-describedby="h-email"><p class="field__hint" id="h-email">Vous y recevrez la confirmation.</p><p class="field__err" id="e-email" hidden></p></div>
    <div class="field"><label for="f-tel">Téléphone mobile <span aria-hidden="true">*</span></label><input id="f-tel" name="telephone" type="tel" autocomplete="tel" inputmode="tel" required value="${esc(c.telephone)}" aria-describedby="h-tel"><p class="field__hint" id="h-tel">Pour vous joindre en cas d'imprévu.</p><p class="field__err" id="e-tel" hidden></p></div>
  </div>
  <div class="field"><label for="f-msg">Un mot pour Magnolia <small>(facultatif)</small></label><textarea id="f-msg" name="message" rows="3" maxlength="500" placeholder="Première visite, allergies, zone sensible, envie du moment…">${esc(c.message)}</textarea></div>
  <div class="hp" aria-hidden="true"><label>Ne pas remplir<input name="site_web" tabindex="-1" autocomplete="off"></label></div>
  <fieldset class="paychoice"><legend>${solo ? 'Règlement' : 'Comment souhaitez-vous régler ?'}</legend>
    ${choix}
    ${solo && permis[0] === 'total' ? `<p class="paychoice__note">Le rendez-vous est confirmé dès le paiement.</p>` : ''}
  </fieldset>
  <div class="field field--check"><label class="check"><input type="checkbox" id="f-consent" name="consent"${S.consent ? ' checked' : ''} required aria-describedby="e-consent"><span class="check__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span><span>J'ai lu les <a href="mentions-legales.html#conditions" target="_blank" rel="noopener">conditions de réservation</a> et la <a href="mentions-legales.html#confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>, et je les accepte. <span aria-hidden="true">*</span></span></label><p class="field__err" id="e-consent" hidden></p></div>
</form>`;
  }

  /* Étape 4 — récapitulatif et paiement */
  function vueRecap() {
    const t = totals(), pay = aPayer(), e = S.client;
    const liste = items().map(s => `<li><span>${esc(s.nom)}${s.detail ? ` <small>${esc(s.detail)}</small>` : ''}</span><span>${s.sur_devis ? 'Sur devis' : eur(s.prix)}</span></li>`).join('');
    const bouton = pay.maintenant > 0 ? `<svg aria-hidden="true"><use href="#i-lock"/></svg><span>Payer ${eur(pay.maintenant / 100)} en sécurité</span>` : '<span>Confirmer mon rendez-vous</span>';
    return `<h2 class="bk__title" id="bk-title">Votre rendez-vous</h2>
<p class="bk__lead">Vérifiez les informations, puis ${pay.maintenant > 0 ? 'passez au paiement sécurisé' : 'confirmez'}.</p>
<div class="recap">
  <div class="recap__when"><svg aria-hidden="true"><use href="#i-calendar"/></svg><div><strong>${esc(dateLongueMaj(S.date))}</strong><span>à ${heureFr(S.time)} · ${duree(t.duree)}</span></div></div>
  <ul class="recap__items">${liste}</ul>
  <dl class="recap__tot">
    <div><dt>Total${t.range ? ' (à partir de)' : ''}</dt><dd>${eur(t.min)}</dd></div>
    <div class="is-strong"><dt>À régler maintenant</dt><dd>${eur(pay.maintenant / 100)}</dd></div>
    <div><dt>Reste à régler à l'institut</dt><dd>${eur(pay.reste / 100)}</dd></div>
  </dl>
  <p class="recap__who">${esc(e.prenom)} ${esc(e.nom)} · ${esc(e.email)} · ${esc(e.telephone)}</p>
  <p class="recap__policy">Annulation ou report gratuit jusqu'à ${S.reg.reservation.annulationHeures}${NB}heures avant le rendez-vous, en appelant ou en écrivant au ${TEL_AFFICHE}. Passé ce délai, le règlement versé en ligne n'est pas remboursé.</p>
  <div class="recap__err" id="bkErr" role="alert" hidden></div>
  <button class="btn btn--gold btn--lg" type="button" id="bkPay" data-act="pay">${bouton}</button>
  ${pay.maintenant > 0 ? '<p class="recap__secure"><svg aria-hidden="true"><use href="#i-lock"/></svg> Paiement sécurisé par Stripe. Vos données bancaires ne passent jamais par ce site.</p>' : ''}
  <p class="recap__back"><button type="button" class="link-btn" data-act="back">← Modifier mes informations</button></p>
</div>`;
  }

  /* Simulation du paiement (mode démonstration uniquement) */
  function vueSimulation() {
    const pay = aPayer();
    return `<h2 class="bk__title" id="bk-title">Paiement sécurisé</h2>
<div class="sim"><p class="sim__badge">Simulation</p>
<p>En production, vous seriez redirigé vers la page de paiement sécurisée de Stripe pour régler <strong>${eur(pay.maintenant / 100)}</strong> par carte bancaire. Ici, rien n'est demandé ni prélevé.</p>
<div class="sim__card" aria-hidden="true"><i></i><i></i><i></i></div>
<div class="sim__actions"><button class="btn btn--gold btn--lg" type="button" data-act="sim-ok">Simuler un paiement réussi</button><button class="btn btn--line btn--lg" type="button" data-act="sim-back">Retour</button></div></div>`;
  }

  /* Confirmation */
  function vueConfirmation() {
    const d = S.done, r = d.rdv;
    const lines = r.services.map(s => `<li>${esc(s.nom)}${s.detail ? ` <small>${esc(s.detail)}</small>` : ''}</li>`).join('');
    return `<div class="done" tabindex="-1"><div class="done__icon" aria-hidden="true"><svg><use href="#i-check"/></svg></div>
<h2 class="bk__title" id="bk-title">${d.demo ? 'Simulation terminée' : 'Rendez-vous confirmé'}</h2>
<p class="bk__lead">${d.demo ? 'Dans la vraie version, ce rendez-vous apparaîtrait aussitôt dans l\'agenda de Magnolia et vous recevriez un e-mail de confirmation.' : `Merci ${esc(S.client.prenom)} ! Un e-mail de confirmation vous est envoyé à ${esc(S.client.email)}.`}</p>
<div class="recap"><div class="recap__when"><svg aria-hidden="true"><use href="#i-calendar"/></svg><div><strong>${esc(dateLongueMaj(r.date))}</strong><span>à ${heureFr(r.heure)} · ${duree(r.duree)}</span></div></div>
<ul class="recap__items recap__items--plain">${lines}</ul>
<p class="recap__who"><svg aria-hidden="true" class="inl"><use href="#i-pin"/></svg> ${r.rueConnue ? esc(r.lieu) : `${esc(S.reg.adresse.ville)} (${esc(S.reg.adresse.codePostal)}) · l\'adresse exacte vous est envoyée dans l\'e-mail de confirmation`}</p></div>
<div class="done__actions"><button class="btn btn--dark" type="button" data-act="ics"><span>Ajouter à mon agenda (.ics)</span></button><a class="btn btn--line" target="_blank" rel="noopener" href="${esc(lienGoogle(r))}"><span>Google Agenda</span></a></div>
<p class="done__tel">Un empêchement ? Appelez-nous au <a href="tel:${TEL}">${TEL_AFFICHE}</a>.</p><p class="done__close"><button type="button" class="link-btn" data-act="close">Fermer</button></p></div>`;
  }

  /* Colonne de droite : récapitulatif vivant */
  function vueAside() {
    const t = totals(), l = items(), desk = matchMedia('(min-width: 981px)').matches;
    const rows = l.map(s => `<li><span class="sum__name">${esc(s.nom)}${s.detail ? ` <small>${esc(s.detail)}</small>` : ''}</span><span class="sum__price">${s.sur_devis ? 'Sur devis' : eur(s.prix)}</span><button type="button" class="sum__rm" data-remove="${esc(s.id)}" aria-label="Retirer ${esc(s.nom)}"><svg aria-hidden="true"><use href="#i-close"/></svg></button></li>`).join('');
    const quand = S.date ? `<p class="sum__when"><svg aria-hidden="true"><use href="#i-calendar"/></svg>${esc(dateLongueMaj(S.date))}${S.time ? ' · ' + heureFr(S.time) : ''}</p>` : '';
    const ok = peutContinuer();
    const lib = ['Choisir la date', 'Mes coordonnées', 'Récapitulatif', ''][S.step - 1];
    return `<div class="sum">
<h3 class="sum__h">Votre sélection</h3>
${l.length ? `<details class="sum__list"${desk ? ' open' : ''}><summary><span>${t.count} soin${t.count > 1 ? 's' : ''}</span><span>${duree(t.duree)}</span></summary><ul>${rows}</ul></details>` : '<p class="sum__empty">Aucun soin choisi pour le moment.</p>'}
${quand}
<dl class="sum__tot"><div><dt>Durée</dt><dd>${l.length ? duree(t.duree) : '—'}</dd></div><div class="is-big"><dt>Total${t.range ? ' dès' : ''}</dt><dd>${l.length ? eur(t.min) : '—'}</dd></div></dl>
${S.step < 4 ? `<button type="button" class="btn btn--gold sum__go" data-act="next"${ok ? '' : ' aria-disabled="true"'}><span>${lib}</span><svg aria-hidden="true"><use href="#i-arrow"/></svg></button>` : ''}
${S.step > 1 ? '<button type="button" class="link-btn link-btn--light" data-act="prev">← Retour</button>' : ''}
<p class="sum__help">Une question ? <a href="tel:${TEL}">${TEL_AFFICHE}</a></p>
${t.duree > S.reg.reservation.dureeMaxMinutes ? `<p class="sum__warn" role="alert">Cette sélection dépasse ${duree(S.reg.reservation.dureeMaxMinutes)} : réservez en deux rendez-vous ou appelez-nous.</p>` : ''}
</div>`;
  }
  function vueAsideDone() { return `<div class="sum sum--done"><h3 class="sum__h">À bientôt</h3><p class="sum__empty">${DEMO ? 'Ceci était une démonstration.' : 'Votre créneau est réservé.'}</p><p class="sum__help"><a href="tel:${TEL}">${TEL_AFFICHE}</a></p></div>`; }
  function majAside() { const a = $('#bkAside'); if (a && !S.done) a.innerHTML = vueAside(); }
  function peutContinuer() {
    const t = totals();
    if (S.step === 1) return t.count > 0 && t.duree <= S.reg.reservation.dureeMaxMinutes;
    if (S.step === 2) return !!(S.date && S.time);
    return true;
  }

  /* ---------- Actions ---------- */
  function toggleService(id, force) {
    const s = S.services.get(id); if (!s || s.enLigne === false) return false;
    const i = S.cart.indexOf(id), want = force === undefined ? i < 0 : force;
    if (want && i < 0) { if (S.cart.length >= S.reg.reservation.maxPrestations) { toast('Vous pouvez choisir jusqu\'à ' + S.reg.reservation.maxPrestations + ' soins par rendez-vous.'); return false; } S.cart.push(id); }
    if (!want && i >= 0) S.cart.splice(i, 1);
    S.date = S.cart.length ? S.date : ''; S.time = ''; // la durée change : on redemande l'horaire
    save(); syncRows(); updatePill();
    return want;
  }
  function syncRows() {
    $$('.row__add').forEach(b => { const on = S.cart.includes(b.dataset.serviceId); b.setAttribute('aria-pressed', String(on)); const use = b.querySelector('use'); if (use) use.setAttribute('href', on ? '#i-check' : '#i-plus'); });
  }

  function validerFormulaire() {
    const f = $('#bkForm'); if (!f) return true;
    const v = n => f.elements[n].value.trim();
    S.client = { prenom: v('prenom'), nom: v('nom'), email: v('email'), telephone: v('telephone'), message: v('message') };
    S.consent = f.elements.consent.checked;
    S.hp = (f.elements.site_web && f.elements.site_web.value) || '';
    S.paiement = (f.querySelector('input[name="paiement"]:checked') || {}).value || S.paiement;
    if (!modes().includes(S.paiement)) S.paiement = modeParDefaut();
    const errs = {};
    if (S.client.prenom.length < 2) errs.prenom = 'Indiquez votre prénom.';
    if (S.client.nom.length < 2) errs.nom = 'Indiquez votre nom.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.client.email)) errs.email = 'Indiquez une adresse e-mail valide, par exemple prenom@exemple.fr.';
    const digits = S.client.telephone.replace(/[^\d+]/g, '');
    if (!/^(\+|00)?\d{9,15}$/.test(digits)) errs.tel = 'Indiquez un numéro de téléphone valide, par exemple 06 12 34 56 78.';
    if (!S.consent) errs.consent = 'Cochez cette case pour continuer.';
    const map = { prenom: 'f-prenom', nom: 'f-nom', email: 'f-email', tel: 'f-tel', consent: 'f-consent' };
    let first = null;
    Object.keys(map).forEach(k => {
      const input = $('#' + map[k]), err = $('#e-' + k);
      if (errs[k]) { err.textContent = errs[k]; err.hidden = false; input.setAttribute('aria-invalid', 'true'); const ids = (input.getAttribute('aria-describedby') || '').split(' ').filter(x => x && x !== 'e-' + k); ids.push('e-' + k); input.setAttribute('aria-describedby', ids.join(' ')); if (!first) first = input; }
      else { err.hidden = true; input.removeAttribute('aria-invalid'); }
    });
    if (first) { first.focus(); live('Le formulaire contient des erreurs : ' + Object.values(errs).join(' ')); return false; }
    return true;
  }

  async function suivant() {
    if (S.step === 3) { if (!validerFormulaire()) return; }
    else if (!peutContinuer()) {
      toast(S.step === 1 ? (totals().count ? 'Cette sélection est trop longue pour un seul rendez-vous.' : 'Choisissez au moins un soin pour continuer.') : 'Choisissez un jour puis un horaire pour continuer.');
      return;
    }
    S.step = Math.min(4, S.step + 1); render(true);
  }

  async function payer() {
    if (S.submitting) return;
    const err = $('#bkErr'), btn = $('#bkPay'), pay = aPayer();
    err.hidden = true;
    if (DEMO) { S.sim = pay.maintenant > 0; if (!S.sim) return finir({ demo: true }); render(true); return; }
    S.submitting = true; btn.disabled = true; btn.classList.add('is-busy'); live('Envoi en cours…');
    const payload = { services: S.cart.slice(), debut: S.date + 'T' + S.time, paiement: S.paiement, consentement: true, client: S.client, hp: S.hp, ouvert: Date.now() - S.openedAt, reprise: S.reprise || undefined };
    try {
      const r = await fetch(API + '/reserver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.url) { S.reprise = data.session || ''; save(); window.location.href = data.url; return; }
      if (r.ok && data.ok) { S.submitting = false; return finir({ demo: false, rdv: data.rdv }); }
      S.submitting = false; btn.disabled = false; btn.classList.remove('is-busy');
      if (r.status === 409) { S.time = ''; S.step = 2; availCache.clear(); render(true); toast('Ce créneau vient d\'être pris. Choisissez un autre horaire.'); return; }
      const msgs = { 429: 'Trop de tentatives. Réessayez dans quelques minutes ou appelez-nous.', 501: 'La réservation en ligne n\'est pas encore activée. Appelez-nous pour réserver.', 422: data.message || 'Certaines informations sont invalides.' };
      throw new Error(msgs[r.status] || data.message || 'Une erreur est survenue. Réessayez ou appelez-nous.');
    } catch (e) {
      S.submitting = false; btn.disabled = false; btn.classList.remove('is-busy');
      err.innerHTML = esc(e.message || 'Connexion impossible.') + ` <a href="tel:${TEL}">${TEL_AFFICHE}</a>`; err.hidden = false; err.focus && err.focus();
    }
  }

  function finir({ demo, rdv }) {
    const t = totals();
    const r = rdv || { date: S.date, heure: S.time, duree: t.duree, services: items().map(s => ({ nom: s.nom, detail: s.detail })), ref: 'DEMO-' + Date.now().toString(36).toUpperCase() };
    S.done = { demo, rdv: r }; S.sim = false;
    if (!demo) { S.cart = []; S.date = ''; S.time = ''; S.reprise = ''; S.step = 1; }
    render(true); save();
  }
  function reset() { S.cart = []; S.date = ''; S.time = ''; S.step = 1; S.done = null; S.sim = false; S.reprise = ''; save(); }

  /* ---------- Événements ---------- */
  function onClick(e) {
    const t = e.target;
    const chip = t.closest('[data-family]'); if (chip && $('#bkMain').contains(chip)) { S.family = chip.dataset.family; S.query = ''; const s = $('#bkSearch'); if (s) s.value = ''; $$('.chip').forEach(c => { const on = c === chip; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); }); renderListe(); return; }
    const rm = t.closest('[data-remove]'); if (rm) { toggleService(rm.dataset.remove, false); if (S.cart.length === 0 && S.step > 1) S.step = 1; render(); return; }
    const day = t.closest('.day'); if (day) { if (day.getAttribute('aria-disabled') === 'true') { toast('Ce jour n\'est pas disponible.'); return; } S.date = day.dataset.date; S.time = ''; dessinerCalendrier(); dessinerCreneaux(); majAside(); save(); const first = $('#bkSlots input'); if (first && matchMedia('(max-width: 980px)').matches) $('#bkSlots').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const nav = t.closest('[data-nav]'); if (nav && !nav.disabled) { const d = +nav.dataset.nav; let { y, m } = S.month; m += d; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.month = { y, m }; chargerMois(); return; }
    const act = t.closest('[data-act]'); if (!act) return;
    switch (act.dataset.act) {
      case 'next': suivant(); break;
      case 'prev': case 'back': S.step = Math.max(1, S.step - 1); S.sim = false; render(true); break;
      case 'pay': payer(); break;
      case 'retry': chargerMois(); break;
      case 'sim-ok': finir({ demo: true }); break;
      case 'sim-back': S.sim = false; render(true); break;
      case 'ics': telechargerIcs(S.done.rdv); break;
      case 'close': closeDialog(); if (S.done) reset(); break;
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.classList.contains('svc__cb')) { const on = toggleService(t.value, t.checked); const li = t.closest('.svc'); li.classList.toggle('is-on', on); if (t.checked !== on) t.checked = on; renderListeEtat(); majAside(); return; }
    if (t.name === 'slot') { S.time = t.value; majAside(); save(); live('Horaire choisi : ' + heureFr(t.value)); return; }
    if (t.name === 'paiement') { S.paiement = t.value; $$('.pay').forEach(p => p.classList.toggle('is-on', p.contains(t))); save(); return; }
    if (t.id === 'f-consent') S.consent = t.checked;
  }
  function renderListeEtat() { // met à jour l'état « complet » des cases sans tout redessiner
    const max = S.reg.reservation.maxPrestations;
    $$('.svc__cb').forEach(cb => { const li = cb.closest('.svc'), on = S.cart.includes(cb.value), full = !on && S.cart.length >= max; cb.disabled = full; li.classList.toggle('is-off', full); });
  }
  let st;
  function onInput(e) {
    const t = e.target;
    if (t.getAttribute && t.getAttribute('aria-invalid') === 'true') { // efface l'erreur dès que l'on corrige le champ
      t.removeAttribute('aria-invalid');
      const key = { 'f-prenom': 'prenom', 'f-nom': 'nom', 'f-email': 'email', 'f-tel': 'tel' }[t.id], err = key && $('#e-' + key); if (err) err.hidden = true;
    }
    if (e.target.id === 'bkSearch') { clearTimeout(st); st = setTimeout(() => { S.query = e.target.value; renderListe(); }, 120); } }
  function onKey(e) {
    const day = e.target.closest && e.target.closest('.day');
    if (day) {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step !== undefined) { e.preventDefault(); const d = addDays(day.dataset.date, step), btn = $('.day[data-date="' + d + '"]'); if (btn) { $$('.day').forEach(b => (b.tabIndex = -1)); btn.tabIndex = 0; btn.focus(); } else { const [y, m] = d.split('-').map(Number); S.month = { y, m: m - 1 }; chargerMois().then(() => { const b = $('.day[data-date="' + d + '"]'); if (b) { $$('.day').forEach(x => (x.tabIndex = -1)); b.tabIndex = 0; b.focus(); } }); } }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const row = [...day.closest('tr').querySelectorAll('.day')]; const b = e.key === 'Home' ? row[0] : row[row.length - 1]; if (b) { $$('.day').forEach(x => (x.tabIndex = -1)); b.tabIndex = 0; b.focus(); } }
    }
    if (e.key === 'Enter' && e.target.id === 'bkSearch') e.preventDefault();
    if (e.key === 'Enter' && e.target.closest && e.target.closest('#bkForm') && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); suivant(); }
  }

  /* ---------- Bulle « ma sélection » et message flottant ---------- */
  let pill, toastEl, toastT;
  function updatePill() {
    if (!S.reg) return;
    if (!pill) {
      pill = document.createElement('div'); pill.className = 'cartpill'; pill.setAttribute('role', 'region'); pill.setAttribute('aria-label', 'Votre sélection');
      pill.innerHTML = '<p><strong id="cpN"></strong><span id="cpT"></span></p><button class="btn btn--gold btn--sm" type="button" id="cpGo"><span>Réserver</span></button>';
      document.body.appendChild(pill); $('#cpGo', pill).addEventListener('click', e => openDialog({ trigger: e.currentTarget }));
    }
    const t = totals(), show = t.count > 0 && !dlg.open && !S.done;
    pill.classList.toggle('is-on', show);
    $('#cpN', pill).textContent = t.count + ' soin' + (t.count > 1 ? 's' : '');
    $('#cpT', pill).textContent = ' · ' + duree(t.duree) + ' · ' + prixTxt(t);
  }
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
    (dlg.open ? dlg : document.body).appendChild(toastEl);
    toastEl.textContent = msg; toastEl.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('is-on'), 3600);
  }

  /* ---------- Interface publique ---------- */
  window.MagnoliaBooking = {
    open: openDialog,
    toggle: async id => { await ensureData(); const on = toggleService(id); const s = S.services.get(id); if (s && on !== undefined) toast((on ? 'Ajouté : ' : 'Retiré : ') + s.nom); return on; },
    has: id => S.cart.includes(id),
    count: () => S.cart.length,
    ready: ensureData
  };

  restore();
  const idle = window.requestIdleCallback || (f => setTimeout(f, 600));
  window.addEventListener('load', () => idle(() => ensureData().then(() => { syncRows(); updatePill(); }).catch(() => {})));
  // retour depuis la page de paiement Stripe sans payer : on rouvre le récapitulatif
  if (/[?&]paiement=annule/.test(location.search)) { history.replaceState(null, '', location.pathname + location.hash); ensureData().then(() => { if (S.cart.length && S.date && S.time) { S.step = 4; openDialog({ step: 4 }); toast('Paiement annulé : vous pouvez réessayer.'); } }); }
})();
