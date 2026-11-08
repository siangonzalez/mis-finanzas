/**
 * Mis finanzas · Gmail y Google Sheets
 *
 * Corre dentro de TU cuenta de Google (script.google.com) y solo responde a la
 * app cuando la app presenta la clave secreta.
 *  - Gmail: busca las alertas de los bancos de abajo y devuelve su texto, y
 *    los extractos que llegan como adjunto (PDF o Word), para leerlos en la app.
 *  - Deudas: guarda las deudas y sus pagos en la hoja "Mis finanzas – Deudas"
 *    de tu Drive, para que el iPhone, el computador y el tablero de Claude
 *    vean lo mismo.
 *  - Sincronización: en la pestaña "datos" de esa misma hoja guarda tus
 *    movimientos, la bandeja, el presupuesto, las reglas y las tarjetas, para
 *    que todos tus dispositivos tengan lo mismo.
 *  - Recordatorios: si ejecutas activarRecordatorios, te escribe cada mañana
 *    cuando una tarjeta, crédito o deuda está por vencer o se venció.
 * Solo te envía correos a ti (los recordatorios) y no comparte nada.
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
// Extractos por respuesta (cada uno puede pesar un par de MB) y tamaño máximo de cada adjunto.
var MAX_EXTRACTOS = 6;
var MAX_ADJUNTO = 8 * 1024 * 1024;
var SHEET_NAME = 'Mis finanzas – Deudas';
var HEADERS = {
  deudas: ['id', 'nombre', 'direccion', 'palabras', 'cuota', 'dia', 'tasas'],
  prestamos: ['deuda', 'fecha', 'monto', 'nota'],
  pagos: ['id', 'deuda', 'fecha', 'monto', 'nota', 'origen', 'artefactoId', 'creado'],
  // Un registro de la app por fila: tabla, id, cuándo cambió (según el
  // dispositivo), cuándo llegó aquí (según el servidor) y el registro en JSON.
  datos: ['tabla', 'clave', 'actualizado', 'servidor', 'json'],
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
      case 'extractos':
        return json(Object.assign({ ok: true }, extractos(Number(body.since) || Date.now() - 45 * 86400000, body.seen || [])));
      case 'debts.get':
        return json({ ok: true, debts: leerDeudas(), sheetUrl: libro().getUrl() });
      case 'debts.put':
        lock.waitLock(20000);
        guardarDeuda(body.debt);
        return json({ ok: true });
      case 'debts.addPayment':
        lock.waitLock(20000);
        return json({ ok: true, added: agregarPago(body.debtId, body.payment) });
      case 'data.sync':
        lock.waitLock(30000);
        return json(Object.assign({ ok: true }, sincronizar(body.since, body.changes || [])));
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

/** Para probar desde el editor que el script encuentra tus extractos del último mes. */
function probarExtractos() {
  var r = extractos(Date.now() - 31 * 86400000, []);
  Logger.log('Encontré ' + r.statements.length + ' extractos' + (r.more ? ' (y hay más)' : '') + '.');
  r.statements.forEach(function (s) {
    Logger.log(s.subject + ' · ' + s.files.map(function (f) { return f.name; }).join(', '));
  });
}

// Correos con un PDF o Word adjunto que hablan de extracto o estado de cuenta.
// Devuelve los archivos en base64; la app los lee y pide la contraseña si la tienen.
function extractos(since, seen) {
  var vistos = {};
  seen.forEach(function (id) { vistos[id] = true; });
  var query = 'has:attachment (filename:pdf OR filename:docx) (extracto OR "estado de cuenta" OR "estados de cuenta")' +
    ' after:' + Math.floor(since / 1000) + ' -in:sent -in:spam -in:trash';
  var threads = GmailApp.search(query, 0, 50);
  var out = [];
  var more = false;

  for (var i = 0; i < threads.length && !more; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var m = messages[j];
      if (m.getDate().getTime() < since || vistos[m.getId()]) continue;
      var files = m.getAttachments({ includeInlineImages: false }).filter(function (a) {
        return /\.(pdf|docx)$/i.test(a.getName()) && a.getSize() <= MAX_ADJUNTO;
      });
      if (!files.length) continue;
      if (out.length >= MAX_EXTRACTOS) {
        more = true;
        break;
      }
      out.push({
        id: m.getId(),
        date: m.getDate().toISOString(),
        from: m.getFrom(),
        subject: m.getSubject(),
        files: files.map(function (a) {
          return { name: a.getName(), mime: a.getContentType(), data: Utilities.base64Encode(a.getBytes()) };
        }),
      });
    }
  }
  return { statements: out, more: more };
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
      // Que Sheets no convierta ids ni JSON en fechas o números.
      if (name === 'datos') sh.getRange('B:B').setNumberFormat('@');
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

// ── Sincronización entre dispositivos ────────────────────────────────────

// Guarda los cambios que manda un dispositivo (gana el más reciente) y le
// devuelve todo lo que llegó desde su última sincronización.
function sincronizar(since, changes) {
  var sh = libro().getSheetByName('datos');
  var values = sh.getDataRange().getValues();
  var index = {};
  for (var i = 1; i < values.length; i++) index[values[i][0] + '|' + values[i][1]] = i;

  var now = Date.now();
  var touched = false;
  changes.forEach(function (c) {
    if (!c || !c.table || !c.rec || c.rec.id === undefined) return;
    var row = [c.table, String(c.rec.id), Number(c.rec.updatedAt) || 0, now, JSON.stringify(c.rec)];
    var at = index[row[0] + '|' + row[1]];
    if (at === undefined) {
      values.push(row);
      index[row[0] + '|' + row[1]] = values.length - 1;
      touched = true;
    } else if (Number(values[at][2]) <= row[2]) {
      values[at] = row;
      touched = true;
    }
  });
  if (touched) sh.getRange(1, 1, values.length, HEADERS.datos.length).setValues(values);

  var out = [];
  for (var j = 1; j < values.length; j++) {
    if (Number(values[j][3]) > (Number(since) || 0)) out.push({ table: values[j][0], rec: JSON.parse(values[j][4]) });
  }
  return { now: now, changes: out };
}

// ── Recordatorios de pagos por correo ────────────────────────────────────
// Todos los días (7 a. m.) revisa tarjetas, créditos y deudas, y te escribe
// solo si algo vence en 3 días, mañana u hoy, o si se venció sin pagar
// (cada 3 días). Lo que ya pagaste no se avisa: usa los pagos que llegaron en
// tus alertas y el "Ya pagué" que marques en la app.

var APP_URL = 'https://siangonzalez.github.io/mis-finanzas/';
var ZONA = 'America/Bogota';

/** Ejecútala una vez: programa el correo diario y te manda uno de prueba. */
function activarRecordatorios() {
  desactivarRecordatorios();
  ScriptApp.newTrigger('revisarPagos').timeBased().everyDays(1).atHour(7).inTimezone(ZONA).create();
  var lista = obligacionesDeHoy();
  enviarCorreo(lista, true);
  Logger.log('Recordatorios activados. Te llegará un correo cada mañana cuando haya algo por pagar.');
}

/** Para dejar de recibir los correos. */
function desactivarRecordatorios() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarPagos') ScriptApp.deleteTrigger(t);
  });
}

/** Muestra en el registro lo que vence, sin mandar correos. */
function verRecordatorios() {
  obligacionesDeHoy().forEach(function (o) {
    Logger.log(o.titulo + ' · ' + pesos(o.monto) + ' · ' + cuando(o.dias) + (o.nota ? ' · ' + o.nota : ''));
  });
}

function revisarPagos() {
  var hoy = hoyISO();
  var props = PropertiesService.getScriptProperties();
  var enviados = JSON.parse(props.getProperty('AVISOS') || '{}');
  var avisar = obligacionesDeHoy().filter(function (o) {
    if (!(o.dias <= 3)) return false;
    var ultimo = enviados[o.clave];
    if (o.dias >= 0) return (o.dias === 3 || o.dias === 1 || o.dias === 0) && ultimo !== hoy;
    return !ultimo || diasEntre(ultimo, hoy) >= 3; // vencido: cada 3 días
  });
  if (!avisar.length) return;
  enviarCorreo(avisar, false);
  avisar.forEach(function (o) { enviados[o.clave] = hoy; });
  // Se olvidan los avisos de hace más de 60 días.
  Object.keys(enviados).forEach(function (k) { if (diasEntre(enviados[k], hoy) > 60) delete enviados[k]; });
  props.setProperty('AVISOS', JSON.stringify(enviados));
}

function obligacionesDeHoy() {
  return obligaciones(leerTabla('cards'), leerTabla('inbox'), leerDeudas(), hoyISO());
}

// Lo que tienes por pagar, con los días que faltan (negativo = vencido).
function obligaciones(cards, inbox, debts, hoy) {
  var out = [];
  cards.forEach(function (c) {
    if (!c.dueDate || !(c.minPayment > 0) || !(c.totalDebt >= 1000)) return;
    var prestamo = c.kind === 'prestamo';
    var nombre = (prestamo ? 'Cuota crédito ' : 'Tarjeta ') + c.bank + ' *' + c.last4;
    var pagado = pagadoDesde(c, inbox, c.cutDate);
    if (pagado < c.minPayment * 0.98) {
      out.push({
        clave: c.id + '|' + c.dueDate, titulo: nombre, monto: c.minPayment - pagado, vence: c.dueDate,
        dias: diasEntre(hoy, c.dueDate),
        nota: prestamo ? 'cuota del mes' : (pagado > 0 ? 'te falta para el mínimo' : 'pago mínimo'),
      });
    } else if (prestamo && hoy >= c.dueDate) {
      // La cuota del crédito es el mismo día cada mes: si ya pagaste esta, sigue la próxima.
      var proxima = sumarMes(c.dueDate);
      if (pagadoDesde(c, inbox, c.dueDate) < c.minPayment * 0.98) {
        out.push({ clave: c.id + '|' + proxima, titulo: nombre, monto: c.minPayment, vence: proxima, dias: diasEntre(hoy, proxima), nota: 'cuota del mes (estimada)' });
      }
    }
  });
  debts.forEach(function (d) {
    if (d.direction !== 'debo' || !(d.installment > 0)) return;
    var c = cuotas(d, hoy);
    if (c.atrasadas.length) {
      out.push({
        clave: d.id + '|atrasadas|' + c.atrasadas.length, titulo: 'Cuotas atrasadas con ' + d.name,
        monto: d.installment * c.atrasadas.length, vence: c.atrasadas[0], dias: diasEntre(hoy, c.atrasadas[0]),
        nota: c.atrasadas.length + (c.atrasadas.length === 1 ? ' cuota' : ' cuotas'),
      });
    }
    if (c.proxima) out.push({ clave: d.id + '|' + c.proxima, titulo: 'Cuota de ' + d.name, monto: d.installment, vence: c.proxima, dias: diasEntre(hoy, c.proxima), nota: '' });
  });
  return out.sort(function (a, b) { return a.dias - b.dias; });
}

// Pagos a ese banco después de una fecha, sin contar comprobantes repetidos
// (mismo criterio que la app, src/lib/cards.ts).
var PAGOS_A = {
  Tuya: /FINANCIAMIENTO\s+TUY|\bTUYA\s+S\.?\s?A\b|PAGO A LA TARJETA TUYA|TARJETA\s+(CARULLA|[EÉ]XITO)/i,
  Davivienda: /BANCO DAVIVIENDA|DAVIVIENDA\s+(CARTERA|ZONA|CR[EÉ]DITO)/i,
  Bancolombia: /PAGO A LA TARJETA BANCOLOMBIA|ABONO TARJETA|T\.?\s?CR[EÉ]D/i,
};

function pagadoDesde(c, inbox, desde) {
  var re = PAGOS_A[c.bank];
  var total = 0;
  if (re) {
    inbox.forEach(function (i) {
      if (i.kind === 'gasto' && i.status !== 'ignorado' && i.status !== 'duplicado' && i.bank !== c.bank && i.date > desde && re.test(i.merchant || '')) total += i.amount;
    });
  }
  if (c.manualPayment && c.manualPayment.date > desde) total += c.manualPayment.amount;
  return total;
}

// Cuotas vencidas sin pagar y la próxima (mismo cálculo que la app, src/lib/debt.ts).
function cuotas(d, hoy) {
  var primero = (d.disbursements || []).map(function (x) { return x.date; }).sort()[0];
  if (!primero) return { atrasadas: [], proxima: '' };
  var y = Number(primero.slice(0, 4)), m = Number(primero.slice(5, 7));
  var vencidas = [], proxima = '';
  while (!proxima) {
    m++;
    if (m > 12) { m = 1; y++; }
    var f = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d.dueDay).slice(-2);
    if (f >= hoy) proxima = f; else vencidas.push(f); // el día del vencimiento todavía no es atraso
  }
  var cubiertas = (d.payments || []).reduce(function (n, p) { return n + Math.round(p.amount / d.installment); }, 0);
  var deben = Math.max(0, vencidas.length - cubiertas);
  return { atrasadas: deben ? vencidas.slice(-deben) : [], proxima: proxima };
}

function leerTabla(nombre) {
  var sh = libro().getSheetByName('datos');
  return sh.getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] === nombre; })
    .map(function (r) { return JSON.parse(r[4]); })
    .filter(function (x) { return !x.deleted; });
}

function enviarCorreo(lista, prueba) {
  var vencidos = lista.filter(function (o) { return o.dias < 0; }).length;
  var asunto = prueba
    ? 'Mis finanzas: recordatorios activados'
    : (vencidos ? '⚠️ ' : '⏰ ') + (lista.length === 1 ? lista[0].titulo + ' · ' + cuando(lista[0].dias) : lista.length + ' pagos por atender');
  var filas = lista.map(function (o) {
    var color = o.dias < 0 ? '#c0392b' : o.dias <= 1 ? '#b9770e' : '#555';
    return '<tr><td style="padding:8px 0"><b>' + o.titulo + '</b><br><span style="color:#777;font-size:13px">' + (o.nota || '') +
      (o.dias < 0 ? ' · desde el ' : ' · vence el ') + fechaLarga(o.vence) + '</span></td><td style="padding:8px 0 8px 16px;text-align:right;white-space:nowrap"><b>' + pesos(o.monto) +
      '</b><br><span style="color:' + color + ';font-size:13px">' + cuando(o.dias) + '</span></td></tr>';
  }).join('');
  var html = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:480px">' +
    (prueba ? '<p>Listo: te escribiré cada mañana cuando algo esté por vencer o se haya vencido. Hoy tienes esto pendiente:</p>' : '') +
    (lista.length ? '<table style="width:100%;border-collapse:collapse">' + filas + '</table>' : '<p>No tienes pagos pendientes. 🎉</p>') +
    '<p style="margin-top:16px"><a href="' + APP_URL + '">Abrir Mis finanzas</a></p>' +
    '<p style="color:#999;font-size:12px">Si ya pagaste algo que no llegó por correo (por ejemplo, la tarjeta Bancolombia), márcalo con "Ya pagué" en Deudas y no te volveré a avisar.</p></div>';
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: asunto, htmlBody: html, name: 'Mis finanzas' });
}

function cuando(dias) {
  if (dias < 0) return 'venció hace ' + -dias + (dias === -1 ? ' día' : ' días');
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  return 'en ' + dias + ' días';
}

function pesos(n) {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaLarga(iso) {
  return Number(iso.slice(8, 10)) + ' ' + MESES[Number(iso.slice(5, 7)) - 1];
}

function hoyISO() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
}

function diasEntre(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

function sumarMes(iso) {
  var y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) + 1, d = Number(iso.slice(8, 10));
  if (m > 12) { m = 1; y++; }
  var ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + Math.min(d, ultimo)).slice(-2);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
