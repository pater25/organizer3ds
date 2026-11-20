var URL_SUPABASE = 'https://lrcjipumypfjbnhhgjlp.supabase.co';
var CHIAVE_SUPABASE = 'sb_publishable__kDUk8RsXBy_HQf55EF14w_VJtgGmCi';


// Pulizia di sicurezza: toglie spazi, caratteri invisibili e percorsi dopo .supabase.co
URL_SUPABASE = URL_SUPABASE.replace(/[\s\u200B-\u200D\uFEFF]/g, '').replace(/^(https?:\/\/[^\/]+).*$/, '$1');
CHIAVE_SUPABASE = CHIAVE_SUPABASE.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
var db = supabase.createClient(URL_SUPABASE, CHIAVE_SUPABASE);

var materie = ['Italiano', 'Storia', 'Inglese', 'Tedesco', 'Matematica', 'Scienze motorie', 'Religione / Alternativa', 'Informatica', 'Sistemi e Reti', 'TPSIT', 'Telecomunicazioni', 'Generale'];
var nomiTipo = { verifica: 'Verifica', interrogazione: 'Interrogazione', compito: 'Compito', evento: 'Evento' };
var nomiTipoPlurale = { verifica: 'Verifiche', interrogazione: 'Interrogazioni', compito: 'Compiti', evento: 'Eventi' };
var titoliVista = { home: 'Home', calendario: 'Calendario', lista: 'Lista', materie: 'Materie', admin: 'Admin', io: 'Io' };

var profilo = null, voci = [], risposte = [], comunicazioni = [], utenti = [];
var vista = 'home', filtroTipo = 'tutte', filtroMateria = 'tutte', mostraPassate = false;
var meseVisto = new Date(); meseVisto.setDate(1);
var giornoScelto = '', voceInModifica = null, avviata = false;

// ---------- utilita ----------
function el(id) { return document.getElementById(id); }
function crea(tag, classe, testo) {
  var e = document.createElement(tag);
  if (classe) e.className = classe;
  if (testo !== undefined) e.textContent = testo;
  return e;
}
function isoDi(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function daIso(s) { return new Date(s + 'T00:00:00'); }
function piuGiorni(s, n) { var d = daIso(s); d.setDate(d.getDate() + n); return isoDi(d); }
function dataLunga(s) { return daIso(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }); }
function dataBreve(s) { return daIso(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); }
function oggiIso() { return isoDi(new Date()); }
function sonoAdmin() { return profilo && profilo.ruolo === 'rappresentante'; }
function puoModificare(v) { return sonoAdmin() || v.autore === profilo.id; }
function nomeAutore(x) { return x.autore_info && x.autore_info.nome ? x.autore_info.nome : 'utente rimosso'; }
function errore(r) { if (r && r.error) { alert('Errore: ' + r.error.message); return true; } return false; }

// ---------- accesso ----------
async function accedi() {
  var r = await db.auth.signInWithPassword({ email: el('campoEmail').value.trim(), password: el('campoPassword').value });
  if (r.error) el('messaggioAccesso').textContent = 'Accesso non riuscito: ' + r.error.message;
}
async function registrati() {
  var nome = el('campoNome').value.trim();
  if (!nome) { el('messaggioAccesso').textContent = 'Scrivi nome e cognome per registrarti: comparirà sulle voci che aggiungi.'; return; }
  var r = await db.auth.signUp({ email: el('campoEmail').value.trim(), password: el('campoPassword').value, options: { data: { nome: nome } } });
  el('messaggioAccesso').textContent = r.error ? 'Registrazione non riuscita: ' + r.error.message : 'Controlla la tua email per confermare l’account, poi accedi.';
}
async function avvia() {
  var s = await db.auth.getSession();
  if (!s.data.session) { el('schermataAccesso').style.display = 'flex'; el('schermataApp').style.display = 'none'; return; }
  if (avviata) return;
  avviata = true;
  var p = await db.from('profili').select('*').eq('id', s.data.session.user.id).single();
  if (!p.data) { avviata = false; return; }
  profilo = p.data;
  el('schermataAccesso').style.display = 'none';
  el('schermataApp').style.display = 'block';
  el('saluto').textContent = profilo.nome + (sonoAdmin() ? ' · admin' : '');
  el('schedaAdmin').style.display = sonoAdmin() ? 'flex' : 'none';
  giornoScelto = oggiIso();
  await caricaTutto();
  ['voci', 'partecipazioni', 'comunicazioni'].forEach(function (t) {
    db.channel('canale-' + t).on('postgres_changes', { event: '*', schema: 'public', table: t }, caricaTutto).subscribe();
  });
}

// ---------- dati ----------
async function caricaTutto() {
  var a = await db.from('voci').select('*, autore_info:profili(nome)').order('data', { ascending: true });
  var b = await db.from('partecipazioni').select('*, persona:profili(nome)');
  var c = await db.from('comunicazioni').select('*, autore_info:profili(nome)').order('creata', { ascending: false });
  if (a.error) console.error(a.error);
  voci = a.data || []; risposte = b.data || []; comunicazioni = c.data || [];
  if (sonoAdmin()) { var d = await db.from('profili').select('*').order('nome'); utenti = d.data || []; }
  disegna();
}

// ---------- componenti ----------
function riga(etichetta, testo) {
  var r = crea('div', 'voce-riga');
  r.appendChild(crea('strong', '', etichetta + ': '));
  r.appendChild(document.createTextNode(testo));
  return r;
}
async function rispondi(v, scelta) {
  var mia = risposte.filter(function (x) { return x.voce_id === v.id && x.utente === profilo.id; })[0];
  var r;
  if (mia && mia.risposta === scelta) r = await db.from('partecipazioni').delete().eq('voce_id', v.id).eq('utente', profilo.id);
  else r = await db.from('partecipazioni').upsert({ voce_id: v.id, utente: profilo.id, risposta: scelta }, { onConflict: 'voce_id,utente' });
  if (!errore(r)) caricaTutto();
}
function boxPartecipazione(v) {
  var tutte = risposte.filter(function (x) { return x.voce_id === v.id; });
  var si = tutte.filter(function (x) { return x.risposta === 'ci_sono'; });
  var no = tutte.filter(function (x) { return x.risposta === 'non_ci_sono'; });
  var mia = tutte.filter(function (x) { return x.utente === profilo.id; })[0];
  var box = crea('div', 'partecipazione');
  var bt = crea('div', 'partecipazione-bottoni');
  var b1 = crea('button', 'bottone piccolo' + (mia && mia.risposta === 'ci_sono' ? ' attivo' : ''), 'Ci sono (' + si.length + ')');
  var b2 = crea('button', 'bottone piccolo' + (mia && mia.risposta === 'non_ci_sono' ? ' attivo' : ''), 'Non ci sono (' + no.length + ')');
  b1.type = 'button'; b2.type = 'button';
  b1.onclick = function () { rispondi(v, 'ci_sono'); };
  b2.onclick = function () { rispondi(v, 'non_ci_sono'); };
  bt.appendChild(b1); bt.appendChild(b2); box.appendChild(bt);
  function nomi(l) { return l.map(function (x) { return x.persona ? x.persona.nome : '?'; }).join(', '); }
  if (si.length) box.appendChild(crea('div', 'partecipazione-nomi', 'Ci sono: ' + nomi(si)));
  if (no.length) box.appendChild(crea('div', 'partecipazione-nomi', 'Non ci sono: ' + nomi(no)));
  return box;
}
function iniziali(n) { return (n || '?').split(/\s+/).map(function (x) { return x.charAt(0); }).slice(0, 2).join('').toUpperCase(); }
function cartaVoce(v, conData) {
  var c = crea('div', 'carta voce tipo-' + v.tipo);
  if (conData) {
    var bd = crea('div', 'blocco-data');
    bd.appendChild(crea('div', 'blocco-numero', String(daIso(v.data).getDate())));
    bd.appendChild(crea('div', 'blocco-mese', daIso(v.data).toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')));
    c.appendChild(bd);
  }
  var corpo = crea('div', 'voce-corpo');
  var sopra = crea('div', 'voce-sopra');
  sopra.appendChild(crea('span', 'voce-tipo', nomiTipo[v.tipo]));
  if (v.materia) sopra.appendChild(crea('span', 'voce-materia', '  ·  ' + v.materia));
  corpo.appendChild(sopra);
  corpo.appendChild(crea('div', 'voce-titolo', v.titolo));
  if (v.argomenti) corpo.appendChild(riga('Argomenti', v.argomenti));
  if (v.note) corpo.appendChild(riga('Note', v.note));
  if (v.link && /^https?:\/\//i.test(v.link)) {
    var rl = crea('div', 'voce-riga');
    var a = crea('a', '', 'Apri il link'); a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    rl.appendChild(a); corpo.appendChild(rl);
  }
  if (v.tipo === 'evento') corpo.appendChild(boxPartecipazione(v));
  var pie = crea('div', 'voce-autore');
  pie.appendChild(crea('span', 'avatar', iniziali(nomeAutore(v))));
  pie.appendChild(crea('span', '', 'Aggiunta da ' + nomeAutore(v)));
  corpo.appendChild(pie);
  var az = crea('div', 'voce-azioni');
  function azione(testo, classe, fn) { var b = crea('button', 'azione' + (classe ? ' ' + classe : ''), testo); b.type = 'button'; b.onclick = fn; az.appendChild(b); }
  azione('Calendario', '', function () { scaricaIcs(v); });
  azione('WhatsApp', '', function () { condividi(v); });
  if (puoModificare(v)) {
    azione('Modifica', '', function () { apriFinestra(v); });
    azione('Elimina', 'pericolo', async function () { if (confirm('Eliminare questa voce?')) { if (!errore(await db.from('voci').delete().eq('id', v.id))) caricaTutto(); } });
  }
  corpo.appendChild(az);
  c.appendChild(corpo);
  return c;
}
function sezione(titolo, sotto, classe) {
  var s = crea('section', 'sezione' + (classe ? ' ' + classe : ''));
  var t = crea('h2', 'sezione-titolo', titolo);
  if (sotto) t.appendChild(crea('span', 'sezione-sotto', sotto));
  s.appendChild(t);
  return s;
}
function riempi(sez, lista, vuoto, conData) {
  if (!lista.length) sez.appendChild(crea('p', 'vuoto', vuoto));
  else lista.forEach(function (v) { sez.appendChild(cartaVoce(v, conData)); });
}
function raggruppaPerData(contenitore, lista) {
  var ultima = '';
  lista.forEach(function (v) {
    if (v.data !== ultima) { contenitore.appendChild(crea('h3', 'giorno-titolo', dataLunga(v.data))); ultima = v.data; }
    contenitore.appendChild(cartaVoce(v));
  });
}

// ---------- viste ----------
function disegnaHome() {
  var c = el('vistaHome'); c.innerHTML = '';
  var oggi = oggiIso(), domani = piuGiorni(oggi, 1), fra7 = piuGiorni(oggi, 7);
  var future = voci.filter(function (v) { return v.data >= oggi; });

  var deDomani = voci.filter(function (v) { return v.data === domani; });
  var eroe = crea('div', 'eroe');
  eroe.appendChild(crea('div', 'eroe-saluto', 'Ciao ' + profilo.nome.split(' ')[0]));
  eroe.appendChild(crea('div', 'eroe-frase', deDomani.length ? 'Domani hai ' + deDomani.length + (deDomani.length === 1 ? ' cosa' : ' cose') + ' in programma' : 'Domani niente in programma'));
  if (deDomani.length) {
    var parti = [];
    ['verifica', 'interrogazione', 'compito', 'evento'].forEach(function (t) {
      var n = deDomani.filter(function (v) { return v.tipo === t; }).length;
      if (n) parti.push(n + ' ' + (n === 1 ? nomiTipo[t] : nomiTipoPlurale[t]).toLowerCase());
    });
    eroe.appendChild(crea('div', 'eroe-dettaglio', parti.join(' · ')));
    var bs = crea('button', 'bottone piccolo', 'Condividi su WhatsApp'); bs.type = 'button';
    bs.onclick = function () { condividiGiorno(domani, deDomani); };
    eroe.appendChild(bs);
  }
  c.appendChild(eroe);

  var ri = crea('div', 'riepilogo');
  ['verifica', 'interrogazione', 'compito', 'evento'].forEach(function (t) {
    var n = future.filter(function (v) { return v.tipo === t && v.data <= fra7; }).length;
    var b = crea('div', 'riepilogo-voce tipo-' + t);
    b.appendChild(crea('div', 'riepilogo-numero', String(n)));
    b.appendChild(crea('div', 'riepilogo-nome', nomiTipoPlurale[t]));
    ri.appendChild(b);
  });
  c.appendChild(ri);

  if (comunicazioni.length) {
    var sc = sezione('Comunicazioni', 'dai rappresentanti');
    comunicazioni.slice(0, 5).forEach(function (m) {
      var k = crea('div', 'carta carta-comunicazione');
      k.appendChild(crea('div', 'comunicazione-titolo', m.titolo));
      if (m.testo) k.appendChild(crea('div', 'comunicazione-testo', m.testo));
      k.appendChild(crea('div', 'voce-autore', nomeAutore(m) + ' · ' + new Date(m.creata).toLocaleDateString('it-IT')));
      if (sonoAdmin()) {
        var bd = crea('button', 'bottone piccolo pericolo', 'Elimina'); bd.type = 'button';
        bd.onclick = async function () { if (confirm('Eliminare la comunicazione?')) { if (!errore(await db.from('comunicazioni').delete().eq('id', m.id))) caricaTutto(); } };
        var az = crea('div', 'voce-azioni'); az.appendChild(bd); k.appendChild(az);
      }
      sc.appendChild(k);
    });
    c.appendChild(sc);
  }

  var sd = sezione('Domani', dataLunga(domani), 'sezione-domani');
  riempi(sd, voci.filter(function (v) { return v.data === domani; }), 'Niente in programma per domani.');
  c.appendChild(sd);
  var so = sezione('Oggi', dataLunga(oggi));
  riempi(so, voci.filter(function (v) { return v.data === oggi; }), 'Niente in programma per oggi.');
  c.appendChild(so);
  var sp = sezione('Prossimi giorni', 'fino a ' + dataBreve(fra7));
  riempi(sp, voci.filter(function (v) { return v.data > domani && v.data <= fra7; }), 'Niente nei prossimi giorni.', true);
  c.appendChild(sp);
}

function disegnaCalendario() {
  var c = el('vistaCalendario'); c.innerHTML = '';
  var testa = crea('div', 'calendario-testa');
  var bp = crea('button', 'bottone piccolo', '‹'); bp.type = 'button';
  var bn = crea('button', 'bottone piccolo', '›'); bn.type = 'button';
  var bo = crea('button', 'bottone piccolo', 'Oggi'); bo.type = 'button';
  bp.onclick = function () { meseVisto.setMonth(meseVisto.getMonth() - 1); disegnaCalendario(); };
  bn.onclick = function () { meseVisto.setMonth(meseVisto.getMonth() + 1); disegnaCalendario(); };
  bo.onclick = function () { meseVisto = new Date(); meseVisto.setDate(1); giornoScelto = oggiIso(); disegnaCalendario(); };
  testa.appendChild(bp);
  testa.appendChild(crea('div', 'calendario-mese', meseVisto.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })));
  testa.appendChild(bo); testa.appendChild(bn);
  c.appendChild(testa);

  var g = crea('div', 'calendario-griglia');
  ['L', 'M', 'M', 'G', 'V', 'S', 'D'].forEach(function (s) { g.appendChild(crea('div', 'calendario-sigla', s)); });
  var anno = meseVisto.getFullYear(), mese = meseVisto.getMonth();
  var vuote = (new Date(anno, mese, 1).getDay() + 6) % 7;
  for (var i = 0; i < vuote; i++) g.appendChild(crea('div', 'cella-vuota'));
  var giorni = new Date(anno, mese + 1, 0).getDate(), oggi = oggiIso();
  for (var n = 1; n <= giorni; n++) {
    var iso = isoDi(new Date(anno, mese, n));
    var cella = crea('button', 'cella-giorno' + (iso === oggi ? ' oggi' : '') + (iso === giornoScelto ? ' scelto' : ''));
    cella.type = 'button';
    cella.appendChild(crea('span', 'numero', String(n)));
    var pu = crea('div', 'puntini');
    var visti = {};
    voci.forEach(function (v) { if (v.data === iso && !visti[v.tipo]) { visti[v.tipo] = true; pu.appendChild(crea('span', 'puntino tipo-' + v.tipo)); } });
    cella.appendChild(pu);
    cella.onclick = (function (x) { return function () { giornoScelto = x; disegnaCalendario(); }; })(iso);
    g.appendChild(cella);
  }
  c.appendChild(g);
  var s = sezione(dataLunga(giornoScelto));
  riempi(s, voci.filter(function (v) { return v.data === giornoScelto; }), 'Niente in programma in questo giorno.');
  c.appendChild(s);
}

function disegnaLista() {
  var c = el('vistaLista'); c.innerHTML = '';
  var f = crea('div', 'filtri');
  [['tutte', 'Tutto'], ['verifica', 'Verifiche'], ['interrogazione', 'Interrogazioni'], ['compito', 'Compiti'], ['evento', 'Eventi']].forEach(function (p) {
    var b = crea('button', 'bottone piccolo' + (filtroTipo === p[0] ? ' attivo' : ''), p[1]); b.type = 'button';
    b.onclick = function () { filtroTipo = p[0]; disegnaLista(); };
    f.appendChild(b);
  });
  var sm = crea('select', 'campo'); sm.setAttribute('aria-label', 'Materia');
  var o0 = crea('option', '', 'Tutte le materie'); o0.value = 'tutte'; sm.appendChild(o0);
  materie.forEach(function (m) { var o = crea('option', '', m); o.value = m; sm.appendChild(o); });
  sm.value = filtroMateria;
  sm.onchange = function () { filtroMateria = sm.value; disegnaLista(); };
  f.appendChild(sm);
  var lp = crea('label', 'preferenza');
  var cp = crea('input'); cp.type = 'checkbox'; cp.checked = mostraPassate;
  cp.onchange = function () { mostraPassate = cp.checked; disegnaLista(); };
  lp.appendChild(cp); lp.appendChild(document.createTextNode(' Mostra anche le passate'));
  f.appendChild(lp);
  c.appendChild(f);
  var oggi = oggiIso();
  var lista = voci.filter(function (v) {
    return (mostraPassate || v.data >= oggi) && (filtroTipo === 'tutte' || v.tipo === filtroTipo) && (filtroMateria === 'tutte' || v.materia === filtroMateria);
  });
  if (!lista.length) c.appendChild(crea('p', 'vuoto', 'Nessuna voce con questi filtri.'));
  else raggruppaPerData(c, lista);
}

function materiaDi(v) { return materie.indexOf(v.materia) !== -1 ? v.materia : (v.materia ? 'Altre materie' : 'Generale'); }
function disegnaMaterie() {
  var c = el('vistaMaterie'); c.innerHTML = '';
  var oggi = oggiIso(), senza = [];
  materie.concat(['Altre materie']).forEach(function (m) {
    var lista = voci.filter(function (v) { return v.data >= oggi && materiaDi(v) === m; });
    if (!lista.length) { senza.push(m); return; }
    var s = sezione(m, lista.length + (lista.length === 1 ? ' voce' : ' voci'));
    lista.forEach(function (v) { s.appendChild(cartaVoce(v, true)); });
    c.appendChild(s);
  });
  if (senza.length) c.appendChild(crea('p', 'materia-vuote', 'Niente in programma: ' + senza.join(', ') + '.'));
}

function disegnaAdmin() {
  var c = el('vistaAdmin'); c.innerHTML = '';
  if (!sonoAdmin()) return;
  var s1 = sezione('Nuova comunicazione', 'compare in Home per tutta la classe');
  var k = crea('div', 'carta modulo');
  var ct = crea('input', 'campo'); ct.placeholder = 'Titolo'; ct.maxLength = 100;
  var cx = crea('input', 'campo'); cx.placeholder = 'Testo'; cx.maxLength = 500;
  var bp = crea('button', 'bottone principale', 'Pubblica'); bp.type = 'button';
  bp.onclick = async function () {
    if (!ct.value.trim()) { alert('Serve almeno il titolo.'); return; }
    if (!errore(await db.from('comunicazioni').insert({ titolo: ct.value.trim(), testo: cx.value.trim() || null }))) caricaTutto();
  };
  k.appendChild(ct); k.appendChild(cx); k.appendChild(bp); s1.appendChild(k); c.appendChild(s1);

  var s2 = sezione('Utenti', utenti.length + ' iscritti');
  var k2 = crea('div', 'carta');
  utenti.forEach(function (u) {
    var r = crea('div', 'riga-utente');
    r.appendChild(crea('span', 'utente-nome', u.nome));
    r.appendChild(crea('span', 'utente-ruolo', u.ruolo === 'rappresentante' ? 'admin' : 'studente'));
    if (u.id !== profilo.id) {
      var br = crea('button', 'bottone piccolo', u.ruolo === 'rappresentante' ? 'Togli admin' : 'Rendi admin'); br.type = 'button';
      br.onclick = async function () {
        var nuovo = u.ruolo === 'rappresentante' ? 'studente' : 'rappresentante';
        if (!errore(await db.rpc('imposta_ruolo', { utente: u.id, nuovo: nuovo }))) caricaTutto();
      };
      var bx = crea('button', 'bottone piccolo pericolo', 'Rimuovi'); bx.type = 'button';
      bx.onclick = async function () {
        if (confirm('Rimuovere ' + u.nome + '? Verranno eliminate anche le voci che ha inserito.')) {
          if (!errore(await db.rpc('elimina_utente', { utente: u.id }))) caricaTutto();
        }
      };
      r.appendChild(br); r.appendChild(bx);
    }
    k2.appendChild(r);
  });
  s2.appendChild(k2); c.appendChild(s2);
}

function disegnaIo() {
  var c = el('vistaIo'); c.innerHTML = '';
  var s = sezione(profilo.nome, sonoAdmin() ? 'admin della classe' : 'studente');
  var k = crea('div', 'carta');
  async function salvaPref(campi) {
    for (var x in campi) profilo[x] = campi[x];
    errore(await db.from('profili').update(campi).eq('id', profilo.id));
  }
  k.appendChild(crea('div', 'voce-titolo', 'Avvisi via email'));
  k.appendChild(crea('div', 'voce-riga', 'Ricevi una mail il giorno prima con quello che c’è in programma.'));
  var l1 = crea('label', 'preferenza');
  var cb = crea('input'); cb.type = 'checkbox'; cb.checked = !!profilo.notifica_email;
  cb.onchange = function () { salvaPref({ notifica_email: cb.checked }); };
  l1.appendChild(cb); l1.appendChild(document.createTextNode(' Attiva gli avvisi email'));
  k.appendChild(l1);

  k.appendChild(crea('div', 'voce-riga', 'A che ora (il giorno prima):'));
  var so = crea('select', 'campo'); so.setAttribute('aria-label', 'Orario avviso');
  [15, 17, 19].forEach(function (h) { var o = crea('option', '', h + ':00'); o.value = String(h); so.appendChild(o); });
  so.value = String(profilo.email_ora || 17);
  so.onchange = function () { salvaPref({ email_ora: parseInt(so.value, 10) }); };
  k.appendChild(so);

  k.appendChild(crea('div', 'voce-riga', 'Per quali voci:'));
  var scelti = (profilo.email_tipi || ['verifica', 'interrogazione', 'compito', 'evento']).slice();
  ['verifica', 'interrogazione', 'compito', 'evento'].forEach(function (t) {
    var l = crea('label', 'preferenza');
    var ck = crea('input'); ck.type = 'checkbox'; ck.checked = scelti.indexOf(t) !== -1;
    ck.onchange = function () {
      var i = scelti.indexOf(t);
      if (ck.checked && i === -1) scelti.push(t);
      if (!ck.checked && i !== -1) scelti.splice(i, 1);
      salvaPref({ email_tipi: scelti.slice() });
    };
    l.appendChild(ck); l.appendChild(document.createTextNode(' ' + nomiTipoPlurale[t]));
    k.appendChild(l);
  });
  s.appendChild(k); c.appendChild(s);
  var be = crea('button', 'bottone pericolo', 'Esci'); be.type = 'button';
  be.onclick = async function () { await db.auth.signOut(); location.reload(); };
  c.appendChild(be);
}

function disegna() {
  if (!profilo) return;
  if (vista === 'admin' && !sonoAdmin()) vista = 'home';
  el('titoloVista').textContent = titoliVista[vista];
  document.querySelectorAll('.vista').forEach(function (v) { v.className = 'vista'; });
  el('vista' + vista.charAt(0).toUpperCase() + vista.slice(1)).className = 'vista visibile';
  document.querySelectorAll('.scheda').forEach(function (b) { b.className = 'scheda' + (b.getAttribute('data-vista') === vista ? ' attiva' : ''); });
  el('bottoneNuovo').style.display = (vista === 'admin' || vista === 'io') ? 'none' : 'block';
  ({ home: disegnaHome, calendario: disegnaCalendario, lista: disegnaLista, materie: disegnaMaterie, admin: disegnaAdmin, io: disegnaIo })[vista]();
}

// ---------- finestra nuova / modifica voce ----------
function apriFinestra(v) {
  voceInModifica = v || null;
  el('titoloFinestra').textContent = v ? 'Modifica voce' : 'Nuova voce';
  el('sceltaTipo').value = v ? v.tipo : 'verifica';
  el('sceltaMateria').value = v ? (materie.indexOf(v.materia) !== -1 ? v.materia : 'Generale') : 'Italiano';
  el('campoData').value = v ? v.data : (vista === 'calendario' ? giornoScelto : piuGiorni(oggiIso(), 1));
  el('campoTitolo').value = v ? v.titolo : '';
  el('campoArgomenti').value = v && v.argomenti ? v.argomenti : '';
  el('campoLink').value = v && v.link ? v.link : '';
  el('campoNote').value = v && v.note ? v.note : '';
  el('finestra').className = 'aperta';
}
async function salvaVoce() {
  var titolo = el('campoTitolo').value.trim(), link = el('campoLink').value.trim();
  if (!titolo || !el('campoData').value) { alert('Servono almeno titolo e data.'); return; }
  if (link && !/^https?:\/\//i.test(link)) { alert('Il link deve iniziare con http:// o https://'); return; }
  var dati = {
    tipo: el('sceltaTipo').value, materia: el('sceltaMateria').value, titolo: titolo, data: el('campoData').value,
    argomenti: el('campoArgomenti').value.trim() || null, link: link || null, note: el('campoNote').value.trim() || null
  };
  var r = voceInModifica ? await db.from('voci').update(dati).eq('id', voceInModifica.id) : await db.from('voci').insert(dati);
  if (errore(r)) return;
  el('finestra').className = '';
  caricaTutto();
}

// ---------- calendario del telefono e WhatsApp ----------
function pulisci(t) { return (t || '').replace(/[\\;,]/g, ' ').replace(/\r?\n/g, ' '); }
function scaricaIcs(v) {
  var fine = piuGiorni(v.data, 1).replace(/-/g, '');
  var desc = [v.argomenti ? 'Argomenti: ' + v.argomenti : '', v.note || '', 'Aggiunta da ' + nomeAutore(v)].filter(Boolean).join(' - ');
  var testo = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Diario 3DS//IT', 'BEGIN:VEVENT',
    'UID:voce-' + v.id + '@diario3ds', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    'DTSTART;VALUE=DATE:' + v.data.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + fine,
    'SUMMARY:' + pulisci(nomiTipo[v.tipo] + (v.materia ? ' ' + v.materia : '') + ' - ' + v.titolo),
    'DESCRIPTION:' + pulisci(desc),
    'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', 'DESCRIPTION:Domani: ' + pulisci(v.titolo), 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([testo], { type: 'text/calendar' }));
  a.download = 'diario3ds-' + v.id + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
}
var emojiTipo = { verifica: '📝', interrogazione: '🎤', compito: '📚', evento: '🎉' };
function maiusc(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
function testoVoce(v, conData) {
  var r = [emojiTipo[v.tipo] + ' *' + nomiTipo[v.tipo] + (v.materia ? ' di ' + v.materia : '') + '*', '«' + v.titolo + '»'];
  if (conData) r.push('🗓️ ' + maiusc(dataLunga(v.data)));
  if (v.argomenti) r.push('📖 ' + v.argomenti);
  if (v.note) r.push('💬 ' + v.note);
  if (v.link && /^https?:\/\//i.test(v.link)) r.push('🔗 ' + v.link);
  r.push('✍️ Aggiunta da ' + nomeAutore(v));
  return r.join('\n');
}
function inviaWhatsApp(t) { window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank'); }
function condividi(v) {
  var oggi = oggiIso(), quando = v.data === oggi ? '⏰ *OGGI*\n' : (v.data === piuGiorni(oggi, 1) ? '⏰ *DOMANI*\n' : '');
  inviaWhatsApp('📒 *DIARIO 3DS*\n' + quando + '━━━━━━━━━━━━\n' + testoVoce(v, true) + '\n━━━━━━━━━━━━\n_Diario condiviso della 3DS_');
}
function condividiGiorno(iso, lista) {
  var etichetta = iso === piuGiorni(oggiIso(), 1) ? 'DOMANI' : iso === oggiIso() ? 'OGGI' : 'IN PROGRAMMA';
  var corpo = lista.map(function (v) { return testoVoce(v, false); }).join('\n\n');
  inviaWhatsApp('📒 *DIARIO 3DS*\n⏰ *' + etichetta + '* · ' + maiusc(dataLunga(iso)) + '\n━━━━━━━━━━━━\n' + corpo + '\n━━━━━━━━━━━━\n_Diario condiviso della 3DS_');
}

// ---------- avvio ----------
materie.forEach(function (m) { var o = crea('option', '', m); o.value = m; el('sceltaMateria').appendChild(o); });
el('bottoneAccedi').onclick = accedi;
el('bottoneRegistrati').onclick = registrati;
el('bottoneNuovo').onclick = function () { apriFinestra(null); };
el('bottoneAnnulla').onclick = function () { el('finestra').className = ''; };
el('bottoneSalva').onclick = salvaVoce;
document.querySelectorAll('.scheda').forEach(function (b) {
  b.onclick = function () { vista = b.getAttribute('data-vista'); disegna(); window.scrollTo(0, 0); };
});
db.auth.onAuthStateChange(function (evento) { if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'INITIAL_SESSION') avvia(); });
