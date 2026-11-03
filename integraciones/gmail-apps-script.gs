/**
 * Mis finanzas · Gmail y Google Sheets
 *
 * Corre dentro de TU cuenta de Google (script.google.com) y solo responde a la
 * app cuando la app presenta la clave secreta.
 *  - Gmail: busca las alertas de los bancos de abajo y devuelve su texto.
 *  - Deudas: guarda las deudas y sus pagos en la hoja "Mis finanzas – Deudas"
 *    de tu Drive, para que el iPhone, el computador y el tablero de Claude
 *    vean lo mismo.
 * No envía correos ni comparte nada.
 *
 * Instalación: ver integraciones/README.md
 */

// Remitentes de alertas. Agrega aquí otros bancos si te llegan alertas por correo.
var SENDERS = [
  'notificacionesbancolombia.com',
  'nequi.com.co',
  'achcolombia.com.co',
  'pagosenlinea@davivienda.com',
];

var MAX_MESSAGES = 300;
var SHEET_NAME = 'Mis finanzas – Deudas';
var HEADERS = {
  deudas: ['id', 'nombre', 'direccion', 'palabras', 'cuota', 'dia', 'tasas'],
  prestamos: ['deuda', 'fecha', 'monto', 'nota'],
  pagos: ['id', 'deuda', 'fecha', 'monto', 'nota', 'origen', 'artefactoId', 'creado'],
};

/** Ejecútala una vez: crea la clave secreta y la muestra en el registro. */
function crearClave() {
  var props = PropertiesService.getScriptProperties();
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('TOKEN', token);
  Logger.log('Tu clave secreta (cópiala en la app, en Ajustes → Gmail):\n' + token);
}

/** Ejecútala una vez: crea (o encuentra) la hoja de deudas y muestra su enlace. */
function configurarHoja() {
  var book = libro();
  Logger.log('Hoja de deudas lista: ' + book.getUrl());
}

/** Para probar desde el editor que el script sí encuentra tus alertas. */
function probar() {
  var msgs = buscar(Date.now() - 7 * 86400000);
  Logger.log('Encontré ' + msgs.length + ' alertas en los últimos 7 días.');
  if (msgs.length) Logger.log(msgs[0].subject + ' · ' + msgs[0].text.slice(0, 200));
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || body.token !== token) return json({ ok: false, error: 'Clave incorrecta.' });

    switch (body.action || 'gmail') {
      case 'gmail':
        var since = Number(body.since) || Date.now() - 60 * 86400000;
        return json({ ok: true, messages: buscar(since) });
      case 'debts.get':
        return json({ ok: true, debts: leerDeudas(), sheetUrl: libro().getUrl() });
      case 'debts.put':
        lock.waitLock(20000);
        guardarDeuda(body.debt);
        return json({ ok: true });
      case 'debts.addPayment':
        lock.waitLock(20000);
        return json({ ok: true, added: agregarPago(body.debtId, body.payment) });
      default:
        return json({ ok: false, error: 'Acción desconocida: ' + body.action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function doGet() {
  return json({ ok: false, error: 'Usa la app para consultar este script.' });
}

// ── Gmail ────────────────────────────────────────────────────────────────

function buscar(since) {
  var desde = Math.floor(since / 1000);
  var query = 'from:(' + SENDERS.join(' OR ') + ') after:' + desde + ' -in:spam -in:trash';
  var threads = GmailApp.search(query, 0, 100);
  var out = [];

  for (var i = 0; i < threads.length && out.length < MAX_MESSAGES; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var m = messages[j];
      if (m.getDate().getTime() < since) continue;
      var text = m.getPlainBody()
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\[\]\([^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 1500);
      out.push({
        id: m.getId(),
        date: m.getDate().toISOString(),
        from: m.getFrom(),
        subject: m.getSubject(),
        text: text,
      });
    }
  }
  return out;
}

// ── Hoja de deudas ───────────────────────────────────────────────────────

function libro() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var book = null;
  if (id) {
    try { book = SpreadsheetApp.openById(id); } catch (e) { book = null; }
  }
  if (!book) {
    book = SpreadsheetApp.create(SHEET_NAME);
    props.setProperty('SHEET_ID', book.getId());
  }
  Object.keys(HEADERS).forEach(function (name) {
    var sh = book.getSheetByName(name) || book.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS[name]);
      sh.setFrozenRows(1);
    }
  });
  var extra = book.getSheetByName('Hoja 1') || book.getSheetByName('Sheet1');
  if (extra && book.getSheets().length > 1) book.deleteSheet(extra);
  return book;
}

function filas(name) {
  var sh = libro().getSheetByName(name);
  var values = sh.getDataRange().getValues();
  var head = values.shift();
  return values.map(function (row) {
    var o = {};
    head.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

function fecha(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}

function leerDeudas() {
  var prestamos = filas('prestamos');
  var pagos = filas('pagos');
  return filas('deudas').filter(function (d) { return d.id; }).map(function (d) {
    return {
      id: String(d.id),
      name: String(d.nombre),
      direction: d.direccion === 'me-deben' ? 'me-deben' : 'debo',
      keywords: String(d.palabras || '').split(',').map(function (s) { return s.trim(); }).filter(String),
      installment: Number(d.cuota) || 0,
      dueDay: Number(d.dia) || 25,
      rates: JSON.parse(d.tasas || '[]'),
      disbursements: prestamos.filter(function (p) { return String(p.deuda) === String(d.id); }).map(function (p) {
        return { date: fecha(p.fecha), amount: Number(p.monto), note: String(p.nota || '') };
      }),
      payments: pagos.filter(function (p) { return String(p.deuda) === String(d.id); }).map(function (p) {
        return { id: String(p.id), date: fecha(p.fecha), amount: Number(p.monto), note: String(p.nota || ''), source: String(p.origen || '') };
      }),
    };
  });
}

// Reemplaza los datos de la deuda y sus préstamos; los pagos se agregan sin
// borrar los que ya estén en la hoja.
function guardarDeuda(d) {
  if (!d || !d.id) throw new Error('Falta la deuda.');
  var book = libro();
  var deudas = book.getSheetByName('deudas');
  var row = [d.id, d.name, d.direction, (d.keywords || []).join(', '), d.installment, d.dueDay, JSON.stringify(d.rates || [])];
  var ids = deudas.getRange(1, 1, deudas.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
  var at = ids.indexOf(String(d.id));
  if (at > 0) deudas.getRange(at + 1, 1, 1, row.length).setValues([row]);
  else deudas.appendRow(row);

  var prestamos = book.getSheetByName('prestamos');
  var keep = prestamos.getDataRange().getValues().filter(function (r, i) { return i === 0 || String(r[0]) !== String(d.id); });
  (d.disbursements || []).forEach(function (p) { keep.push([d.id, p.date, p.amount, p.note || '']); });
  prestamos.clearContents();
  prestamos.getRange(1, 1, keep.length, 4).setValues(keep);

  (d.payments || []).forEach(function (p) { agregarPago(d.id, p); });
}

// Devuelve true si el pago era nuevo. Se identifica por su id: dos cuotas del
// mismo valor pagadas el mismo día son dos pagos distintos.
function agregarPago(debtId, p) {
  if (!p || !p.date || !p.amount) return false;
  var sh = libro().getSheetByName('pagos');
  var dup = p.id && filas('pagos').some(function (r) {
    return String(r.deuda) === String(debtId) && String(r.id) === String(p.id);
  });
  if (dup) return false;
  var id = p.id || 'app-' + Date.now();
  sh.appendRow([id, debtId, p.date, p.amount, p.note || '', p.source || 'app', p.artifactId || '', new Date().toISOString()]);
  return true;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
