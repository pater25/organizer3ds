// 1) Incolla qui i dati del tuo progetto Supabase (Project Settings -> API)
var URL_SUPABASE = 'https://lrcjipumypfjbnhhgjlp.supabase.co/rest/v1/';
var CHIAVE_SUPABASE = 'sb_publishable__kDUk8RsXBy_HQf55EF14w_VJtgGmCi';

var db = supabase.createClient(URL_SUPABASE, CHIAVE_SUPABASE);
var profilo = null, voci = [], filtro = 'tutte';
var nomiTipo = { verifica: 'Verifica', interrogazione: 'Interrogazione', compito: 'Compito', evento: 'Evento' };

function el(id) { return document.getElementById(id); }
function crea(tag, classe, testo) {
  var e = document.createElement(tag);
  if (classe) e.className = classe;
  if (testo !== undefined) e.textContent = testo;
  return e;
}
function isoDi(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function dataLunga(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------- accesso ----------
async function accedi() {
  var r = await db.auth.signInWithPassword({ email: el('campoEmail').value.trim(), password: el('campoPassword').value });
  if (r.error) el('messaggioAccesso').textContent = 'Accesso non riuscito: ' + r.error.message;
}
async function registrati() {
  var nome = el('campoNome').value.trim();
  if (!nome) { el('messaggioAccesso').textContent = 'Scrivi il tuo nome per registrarti.'; return; }
  var r = await db.auth.signUp({ email: el('campoEmail').value.trim(), password: el('campoPassword').value, options: { data: { nome: nome } } });
  el('messaggioAccesso').textContent = r.error ? 'Registrazione non riuscita: ' + r.error.message : 'Controlla la tua email per confermare l’account, poi accedi.';
}
async function avvia() {
  var s = await db.auth.getSession();
  if (!s.data.session) { el('schermataAccesso').style.display = 'flex'; el('schermataApp').style.display = 'none'; return; }
  var p = await db.from('profili').select('*').eq('id', s.data.session.user.id).single();
  profilo = p.data;
  el('schermataAccesso').style.display = 'none';
  el('schermataApp').style.display = 'block';
  el('saluto').textContent = profilo.nome + (profilo.ruolo === 'rappresentante' ? ' (rappresentante)' : '');
  el('spuntaPush').checked = profilo.notifica_push;
  el('spuntaEmail').checked = profilo.notifica_email;
  el('campoData').value = isoDi(new Date());
  await caricaVoci();
  db.channel('voci').on('postgres_changes', { event: '*', schema: 'public', table: 'voci' }, caricaVoci).subscribe();
}

// ---------- voci ----------
async function caricaVoci() {
  var r = await db.from('voci').select('*').gte('data', isoDi(new Date())).order('data', { ascending: true });
  voci = r.data || [];
  disegna();
}
function disegna() {
  var domani = new Date(); domani.setDate(domani.getDate() + 1);
  var inScadenza = voci.filter(function (v) { return v.data === isoDi(domani) && (v.tipo === 'verifica' || v.tipo === 'interrogazione'); });
  var avviso = el('avvisoDomani');
  avviso.innerHTML = '';
  if (inScadenza.length) {
    avviso.appendChild(crea('h2', '', 'Domani'));
    inScadenza.forEach(function (v) { avviso.appendChild(crea('div', '', nomiTipo[v.tipo] + (v.materia ? ' di ' + v.materia : '') + ': ' + v.titolo)); });
    avviso.style.display = 'block';
  } else { avviso.style.display = 'none'; }

  var elenco = el('elenco');
  elenco.innerHTML = '';
  var visibili = voci.filter(function (v) { return filtro === 'tutte' || v.tipo === filtro; });
  if (!visibili.length) { elenco.appendChild(crea('p', 'voce-sotto', 'Niente in programma.')); return; }
  var ultima = '';
  visibili.forEach(function (v) {
    if (v.data !== ultima) { elenco.appendChild(crea('h3', 'giorno-titolo', dataLunga(v.data))); ultima = v.data; }
    var box = crea('div', 'voce tipo-' + v.tipo);
    box.appendChild(crea('div', 'voce-titolo', nomiTipo[v.tipo] + (v.materia ? ' · ' + v.materia : '') + ' – ' + v.titolo));
    if (v.note) box.appendChild(crea('div', 'voce-sotto', v.note));
    var azioni = crea('div', 'voce-azioni');
    var bc = crea('button', 'bottone piccolo', 'Aggiungi al calendario'); bc.type = 'button'; bc.onclick = function () { scaricaIcs(v); };
    var bw = crea('button', 'bottone piccolo', 'Condividi su WhatsApp'); bw.type = 'button'; bw.onclick = function () { condividi(v); };
    azioni.appendChild(bc); azioni.appendChild(bw);
    if (v.autore === profilo.id || profilo.ruolo === 'rappresentante') {
      var be = crea('button', 'bottone piccolo', 'Elimina'); be.type = 'button';
      be.onclick = async function () { if (confirm('Eliminare questa voce?')) { await db.from('voci').delete().eq('id', v.id); caricaVoci(); } };
      azioni.appendChild(be);
    }
    box.appendChild(azioni);
    elenco.appendChild(box);
  });
}
async function aggiungi() {
  var titolo = el('campoTitolo').value.trim();
  if (!titolo || !el('campoData').value) { alert('Servono almeno titolo e data.'); return; }
  var r = await db.from('voci').insert({
    tipo: el('sceltaTipo').value, materia: el('campoMateria').value.trim() || null,
    titolo: titolo, note: el('campoNote').value.trim() || null, data: el('campoData').value
  });
  if (r.error) { alert('Errore: ' + r.error.message); return; }
  el('campoTitolo').value = ''; el('campoNote').value = '';
  caricaVoci();
}

// ---------- calendario e WhatsApp ----------
function scaricaIcs(v) {
  var inizio = v.data.replace(/-/g, '');
  var fine = new Date(v.data + 'T00:00:00'); fine.setDate(fine.getDate() + 1);
  var testo = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Diario 3DS//IT', 'BEGIN:VEVENT',
    'UID:voce-' + v.id + '@diario3ds', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    'DTSTART;VALUE=DATE:' + inizio, 'DTEND;VALUE=DATE:' + isoDi(fine).replace(/-/g, ''),
    'SUMMARY:' + nomiTipo[v.tipo] + (v.materia ? ' ' + v.materia : '') + ' - ' + v.titolo.replace(/[,;]/g, ' '),
    'DESCRIPTION:' + (v.note || '').replace(/[,;\n]/g, ' '),
    'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', 'DESCRIPTION:Domani: ' + v.titolo.replace(/[,;]/g, ' '), 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([testo], { type: 'text/calendar' }));
  a.download = 'diario3ds-' + v.id + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
}
function condividi(v) {
  var t = nomiTipo[v.tipo] + (v.materia ? ' di ' + v.materia : '') + ' – ' + v.titolo + ' (' + dataLunga(v.data) + ')';
  window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank');
}

// ---------- avvio ----------
el('bottoneAccedi').onclick = accedi;
el('bottoneRegistrati').onclick = registrati;
el('bottoneEsci').onclick = async function () { await db.auth.signOut(); location.reload(); };
el('bottoneAggiungi').onclick = aggiungi;
el('spuntaEmail').onchange = function () { db.from('profili').update({ notifica_email: el('spuntaEmail').checked }).eq('id', profilo.id); };
el('spuntaPush').onchange = function () { db.from('profili').update({ notifica_push: el('spuntaPush').checked }).eq('id', profilo.id); };
document.querySelectorAll('#filtri .bottone').forEach(function (b) {
  b.onclick = function () {
    filtro = b.getAttribute('data-filtro');
    document.querySelectorAll('#filtri .bottone').forEach(function (x) { x.className = 'bottone' + (x === b ? ' attivo' : ''); });
    disegna();
  };
});
db.auth.onAuthStateChange(function () { avvia(); });
avvia();
