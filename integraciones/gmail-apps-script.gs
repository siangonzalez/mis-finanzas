/**
 * Mis finanzas · lector de alertas bancarias de Gmail
 *
 * Corre dentro de TU cuenta de Google (script.google.com). Busca solo los
 * correos de alertas de los bancos de abajo y le devuelve el texto a la app
 * cuando la app presenta la clave secreta. No guarda nada ni envía correos.
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

/** Ejecútala una vez: crea la clave secreta y la muestra en el registro. */
function crearClave() {
  var props = PropertiesService.getScriptProperties();
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('TOKEN', token);
  Logger.log('Tu clave secreta (cópiala en la app, en Ajustes → Gmail):\n' + token);
}

/** Para probar desde el editor que el script sí encuentra tus alertas. */
function probar() {
  var msgs = buscar(Date.now() - 7 * 86400000);
  Logger.log('Encontré ' + msgs.length + ' alertas en los últimos 7 días.');
  if (msgs.length) Logger.log(msgs[0].subject + ' · ' + msgs[0].text.slice(0, 200));
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || body.token !== token) return json({ ok: false, error: 'Clave incorrecta.' });

    var since = Number(body.since) || Date.now() - 60 * 86400000;
    return json({ ok: true, messages: buscar(since) });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: false, error: 'Usa la app para consultar este script.' });
}

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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
