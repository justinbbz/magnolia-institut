/* Magnolia institut — fichier d'agenda (.ics) et lien Google Agenda pour un rendez-vous. Partagé par la réservation et la page de remerciement.
   Les heures du rendez-vous sont des heures de Paris, converties en UTC quel que soit le fuseau du navigateur. */
(() => {
  'use strict';
  const FUSEAU = 'Europe/Paris';
  const partsParis = ts => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: FUSEAU, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  };
  const tzOffsetMs = ts => { const p = partsParis(ts); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000; };
  function parisToUtc(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = timeStr.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    let utc = guess - tzOffsetMs(guess);
    const off2 = tzOffsetMs(utc); if (off2 !== tzOffsetMs(guess)) utc = guess - off2;
    return utc;
  }
  const icsDate = ts => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  /* r = { ref, date, heure, duree, services:[{nom, detail}] } ; reg = contenu de data/reglages.json */
  function evenement(r, reg) {
    const debut = parisToUtc(r.date, r.heure), fin = debut + r.duree * 60000;
    const titre = 'Magnolia institut : ' + r.services.map(s => s.nom).join(', ');
    const adresse = r.rueConnue && r.lieu ? r.lieu : [reg.nom, reg.adresse.rue, `${reg.adresse.codePostal} ${reg.adresse.ville}`].filter(Boolean).join(', ');
    const details = `Rendez-vous chez Magnolia institut.\n${r.services.map(s => '• ' + s.nom + (s.detail ? ' (' + s.detail + ')' : '')).join('\n')}\nUne question ou un empêchement : ${reg.telephone}.`;
    return { debut, fin, titre, adresse, details };
  }
  function contenuIcs(r, reg) {
    const e = evenement(r, reg), fold = l => l.replace(/(.{70})/g, '$1\r\n ');
    const t = s => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Magnolia institut//Reservation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + (r.ref || 'rdv-' + e.debut) + '@magnolia-institut', 'DTSTAMP:' + icsDate(Date.now()), 'DTSTART:' + icsDate(e.debut), 'DTEND:' + icsDate(e.fin),
      fold('SUMMARY:' + t(e.titre)), fold('LOCATION:' + t(e.adresse)), fold('DESCRIPTION:' + t(e.details)),
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Rendez-vous Magnolia institut', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }
  function lienGoogle(r, reg) {
    const e = evenement(r, reg);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.titre) + '&dates=' + icsDate(e.debut) + '/' + icsDate(e.fin) + '&details=' + encodeURIComponent(e.details) + '&location=' + encodeURIComponent(e.adresse);
  }
  function telecharger(r, reg) {
    const blob = new Blob([contenuIcs(r, reg)], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'magnolia-institut-rendez-vous.ics';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  window.MagnoliaAgenda = { parisToUtc, partsParis, evenement, contenuIcs, lienGoogle, telecharger };
})();
