/**
 * ================================================================
 *  HOJA DE SEGUIMIENTO SEMANAL — Backend Apps Script
 *  Para: Hewser Marketing
 *  Versión: 2.0 — Sheets como única BD + recordatorios puntuales
 * ================================================================
 *
 *  ARQUITECTURA
 *  ────────────
 *  • Sheets es la única fuente de verdad. NO hay storage local.
 *  • La app frontend (en GitHub Pages) llama a este Apps Script
 *    para TODO: leer hojas, guardar cambios, listar historial, enviar.
 *  • Cada vez que se actualiza una fecha de sesión, se agenda un
 *    trigger puntual que disparará EXACTAMENTE 24h antes.
 *
 *  ENDPOINTS PÚBLICOS
 *  ──────────────────
 *  GET  ?action=list                  → lista resumen de todas las hojas
 *  GET  ?action=get&weekId=X&nombre=Y → una hoja completa
 *  GET  ?action=config                → emails, frase, etc.
 *  POST {action:'save', ...}          → guarda/actualiza una hoja
 *  POST {action:'send', ...}          → marca enviada + manda correo + cancela trigger
 *  POST {action:'config', ...}        → actualiza configuración
 *
 *  INSTRUCCIONES (5 minutos)
 *  ─────────────────────────
 *  1. Crea una Google Sheet vacía. Copia su ID (de la URL, entre /d/ y /edit).
 *  2. Pega ese ID en SHEET_ID abajo.
 *  3. Ajusta DEFAULT_COACH_EMAIL.
 *  4. Ejecuta `setup()` UNA vez desde el editor (botón ▶).
 *  5. Implementar → Aplicación web → Ejecutar como "Yo" → Acceso "Cualquier persona" → COPIA URL.
 *  6. Pega esa URL en `apps-script.gs` constante BACKEND_URL del frontend
 *     (o en la pestaña Configuración de la app).
 *
 *  Listo. NO necesitas trigger diario. Los recordatorios se autoagendan.
 * ================================================================
 */

const SHEET_ID = 'PEGA_AQUI_EL_ID_DE_TU_GOOGLE_SHEET';
const TAB_HOJAS = 'Hojas';
const TAB_CONFIG = 'Config';
const DEFAULT_COACH_EMAIL = 'joaquinpardave@actioncoach.com';
const DEFAULT_FROM_NAME = 'Hoja de Seguimiento Hewser';
const APP_URL = ''; // URL de tu GitHub Pages (opcional, para los botones en correos)


/* ================================================================ */
/*  ROUTER PRINCIPAL                                                  */
/* ================================================================ */

function doGet(e) {
  try {
    const action = (e.parameter.action || 'health').toLowerCase();
    switch (action) {
      case 'health':  return json({ ok: true, version: '2.0' });
      case 'list':    return json({ ok: true, hojas: listHojas() });
      case 'get':     return json({ ok: true, hoja: getHoja(e.parameter.weekId, e.parameter.nombre) });
      case 'config':  return json({ ok: true, config: getConfig() });
      default:        return json({ ok: false, error: 'acción desconocida: ' + action });
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = (body.action || '').toLowerCase();

    switch (action) {
      case 'save':    return handleSave(body);
      case 'send':    return handleSend(body);
      case 'config':  return handleConfig(body);
      case 'delete':  return handleDelete(body);
      default:        return json({ ok: false, error: 'acción desconocida: ' + action });
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: err.toString() });
  }
}


/* ================================================================ */
/*  HANDLERS DE ACCIÓN                                                */
/* ================================================================ */

function handleSave(body) {
  const d = body.data || {};
  const weekId = body.weekId;
  if (!weekId || !d.nombre) {
    return json({ ok: false, error: 'weekId y nombre son obligatorios' });
  }

  saveRow(weekId, d);

  // Si hay fecha+hora de sesión, agendar/reagendar el recordatorio de 24h
  if (d.fecha && d.hora) {
    scheduleReminder(weekId, d.nombre, d.fecha, d.hora);
  }

  return json({ ok: true, cumplimiento: computeCumplimiento(d) });
}

function handleSend(body) {
  const d = body.data || {};
  d.enviada = true;
  d.enviadaFecha = Date.now();
  saveRow(body.weekId, d);

  // Cancelar el trigger de recordatorio (ya no se necesita)
  cancelReminder(body.weekId, d.nombre);

  // Mandar correos de confirmación
  sendConfirmationEmails(body.weekId, d, computeCumplimiento(d));

  return json({ ok: true, message: 'Hoja enviada y notificaciones disparadas' });
}

function handleConfig(body) {
  const cfg = body.config || {};
  saveConfig(cfg);
  return json({ ok: true });
}

function handleDelete(body) {
  const sheet = getSheet(TAB_HOJAS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.weekId && data[i][1] === body.nombre) {
      sheet.deleteRow(i + 1);
      cancelReminder(body.weekId, body.nombre);
      return json({ ok: true });
    }
  }
  return json({ ok: false, error: 'no encontrada' });
}


/* ================================================================ */
/*  PERSISTENCIA EN SHEETS                                            */
/* ================================================================ */

function getSheet(tabName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    if (tabName === TAB_HOJAS) {
      sheet.appendRow([
        'WeekId', 'Nombre', 'Empresa', 'Día', 'Hora', 'Fecha',
        'ValorSesión', 'AprendizajeSesión',
        'Metas (JSON)', 'Cumplimiento %',
        'Logro', 'Reto', 'AprendizajeSemana', 'MetaPróxima', 'AyudaCoach',
        'Horas', 'Motivación %', 'NegocioVa',
        'Concentración', 'Trabajado', 'Comentarios', 'FraseCoach',
        'Enviada', 'FechaEnvío', 'CreadaEn', 'ÚltimoUpdate'
      ]);
      sheet.getRange(1, 1, 1, 26).setFontWeight('bold')
        .setBackground('#1c1f27').setFontColor('#d4ff3a');
      sheet.setFrozenRows(1);
    } else if (tabName === TAB_CONFIG) {
      sheet.appendRow(['Clave', 'Valor']);
      sheet.getRange(1, 1, 1, 2).setFontWeight('bold')
        .setBackground('#1c1f27').setFontColor('#d4ff3a');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function saveRow(weekId, d) {
  const sheet = getSheet(TAB_HOJAS);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === weekId && data[i][1] === d.nombre) {
      rowIndex = i + 1;
      break;
    }
  }

  const cump = computeCumplimiento(d);
  const now = new Date();
  const createdAt = rowIndex > 0 ? data[rowIndex - 1][24] : now;

  const row = [
    weekId,
    d.nombre || '',
    d.empresa || '',
    d.dia || '',
    d.hora || '',
    d.fecha || '',
    d.valorSesion || '',
    d.aprendizajeSesion || '',
    JSON.stringify(d.metas || []),
    cump,
    d.logro || '',
    d.reto || '',
    d.aprendizajeSemana || '',
    d.metaProxima || '',
    d.ayudaCoach || '',
    d.horas || 0,
    d.motivacion || 0,
    d.negocioVa || '',
    (d.concentracion || []).join(' | '),
    (d.trabajado || []).join(' | '),
    d.comentarios || '',
    d.frase || '',
    !!d.enviada,
    d.enviadaFecha ? new Date(d.enviadaFecha) : '',
    createdAt,
    now
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function listHojas() {
  const sheet = getSheet(TAB_HOJAS);
  const data = sheet.getDataRange().getValues();
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    result.push({
      weekId: r[0],
      nombre: r[1],
      empresa: r[2],
      dia: r[3],
      hora: r[4],
      fecha: r[5],
      cumplimiento: Number(r[9]) || 0,
      horas: Number(r[15]) || 0,
      motivacion: Number(r[16]) || 0,
      concentracion: (r[18] || '').split(' | ').filter(Boolean),
      trabajado: (r[19] || '').split(' | ').filter(Boolean),
      enviada: r[22] === true || r[22] === 'TRUE',
      enviadaFecha: r[23] ? new Date(r[23]).getTime() : null,
      updatedAt: r[25] ? new Date(r[25]).getTime() : null
    });
  }
  return result;
}

function getHoja(weekId, nombre) {
  if (!weekId) return null;
  const sheet = getSheet(TAB_HOJAS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[0] === weekId && (!nombre || r[1] === nombre)) {
      let metas = [];
      try { metas = JSON.parse(r[8] || '[]'); } catch (e) {}
      return {
        weekId: r[0],
        nombre: r[1],
        empresa: r[2],
        dia: r[3],
        hora: r[4],
        fecha: r[5] instanceof Date ? Utilities.formatDate(r[5], 'GMT-6', 'yyyy-MM-dd') : r[5],
        valorSesion: r[6],
        aprendizajeSesion: r[7],
        metas: metas,
        logro: r[10], reto: r[11], aprendizajeSemana: r[12],
        metaProxima: r[13], ayudaCoach: r[14],
        horas: Number(r[15]) || 0,
        motivacion: Number(r[16]) || 0,
        negocioVa: r[17],
        concentracion: (r[18] || '').split(' | ').filter(Boolean),
        trabajado: (r[19] || '').split(' | ').filter(Boolean),
        comentarios: r[20],
        frase: r[21],
        enviada: r[22] === true || r[22] === 'TRUE',
        enviadaFecha: r[23] ? new Date(r[23]).getTime() : null
      };
    }
  }
  return null;
}


/* ================================================================ */
/*  CONFIGURACIÓN (key-value en Sheet)                                */
/* ================================================================ */

function getConfig() {
  const sheet = getSheet(TAB_CONFIG);
  const data = sheet.getDataRange().getValues();
  const cfg = {
    emailEmpresario: '',
    emailCoach: DEFAULT_COACH_EMAIL,
    nombreCoach: '',
    frase: 'Lo que no se mide, no se mejora.'
  };
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) cfg[data[i][0]] = data[i][1];
  }
  return cfg;
}

function saveConfig(cfg) {
  const sheet = getSheet(TAB_CONFIG);
  const existing = {};
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existing[data[i][0]] = i + 1;
  }
  Object.entries(cfg).forEach(([k, v]) => {
    if (existing[k]) {
      sheet.getRange(existing[k], 2).setValue(v);
    } else {
      sheet.appendRow([k, v]);
    }
  });
}


/* ================================================================ */
/*  CÁLCULOS                                                           */
/* ================================================================ */

function computeCumplimiento(d) {
  if (!d || !d.metas) return 0;
  const validas = d.metas.filter(m => m.texto && m.texto.trim());
  if (validas.length === 0) return 0;
  const cumplidas = validas.filter(m => m.cumplida === true).length;
  return Math.round((cumplidas / validas.length) * 100);
}


/* ================================================================ */
/*  RECORDATORIOS PUNTUALES (TRIGGERS DINÁMICOS)                      */
/* ================================================================ */

/**
 * Agenda un trigger ÚNICO que se disparará exactamente 24h antes
 * de la sesión. Si ya existe uno para esta hoja, lo reemplaza.
 */
function scheduleReminder(weekId, nombre, fecha, hora) {
  const sessionDate = new Date(fecha + 'T' + (hora || '17:00') + ':00');
  if (isNaN(sessionDate.getTime())) return;

  const reminderTime = new Date(sessionDate.getTime() - 24 * 60 * 60 * 1000);
  const now = new Date();

  // Si la hora de aviso ya pasó (sesión en <24h o pasada), no agendar
  if (reminderTime <= now) {
    console.log(`No se agenda recordatorio para ${nombre} ${weekId}: tiempo ya pasó.`);
    return;
  }

  // Cancelar trigger anterior si existía
  cancelReminder(weekId, nombre);

  // Crear nuevo trigger único
  const trigger = ScriptApp.newTrigger('runReminder')
    .timeBased()
    .at(reminderTime)
    .create();

  // Guardar mapping triggerId → (weekId, nombre) para que la función
  // sepa qué hoja revisar cuando se dispare
  const props = PropertiesService.getScriptProperties();
  props.setProperty('rem_' + trigger.getUniqueId(), JSON.stringify({ weekId, nombre }));

  console.log(`Recordatorio agendado: ${nombre} ${weekId} → ${reminderTime.toISOString()}`);
}

/**
 * Cancela cualquier trigger de recordatorio existente para esta hoja.
 */
function cancelReminder(weekId, nombre) {
  const props = PropertiesService.getScriptProperties();
  const allTriggers = ScriptApp.getProjectTriggers();
  allTriggers.forEach(t => {
    if (t.getHandlerFunction() !== 'runReminder') return;
    const key = 'rem_' + t.getUniqueId();
    const meta = props.getProperty(key);
    if (!meta) return;
    try {
      const m = JSON.parse(meta);
      if (m.weekId === weekId && m.nombre === nombre) {
        ScriptApp.deleteTrigger(t);
        props.deleteProperty(key);
        console.log(`Recordatorio cancelado: ${nombre} ${weekId}`);
      }
    } catch (e) {}
  });
}

/**
 * Se ejecuta cuando dispara un trigger puntual.
 * Identifica qué hoja le toca, revisa si fue enviada, y manda correo si no.
 */
function runReminder(e) {
  if (!e || !e.triggerUid) return;
  const props = PropertiesService.getScriptProperties();
  const key = 'rem_' + e.triggerUid;
  const meta = props.getProperty(key);
  if (!meta) return;

  let info;
  try { info = JSON.parse(meta); } catch (err) { return; }

  // Buscar la hoja actual
  const hoja = getHoja(info.weekId, info.nombre);
  if (!hoja) {
    props.deleteProperty(key);
    return;
  }

  // Si ya fue enviada, no mandar nada (puede haberse enviado entre la
  // agenda y la ejecución sin que se cancelara correctamente)
  if (hoja.enviada) {
    props.deleteProperty(key);
    return;
  }

  // Mandar correo al empresario + alerta al coach
  sendReminderEmails(hoja);
  props.deleteProperty(key);
  // El trigger es one-shot, no necesita borrarse manualmente, pero por seguridad:
  try { ScriptApp.deleteTrigger(e.trigger || null); } catch (err) {}
}


/* ================================================================ */
/*  CORREOS                                                            */
/* ================================================================ */

function sendConfirmationEmails(weekId, d, cump) {
  const cfg = getConfig();
  const emailCoach = cfg.emailCoach || DEFAULT_COACH_EMAIL;
  const emailEmp = cfg.emailEmpresario;

  if (emailCoach) {
    MailApp.sendEmail({
      to: emailCoach,
      subject: `✅ Hoja Semanal recibida — ${d.nombre} · ${weekId}`,
      htmlBody: buildCoachHtml(weekId, d, cump),
      name: DEFAULT_FROM_NAME
    });
  }
  if (emailEmp) {
    MailApp.sendEmail({
      to: emailEmp,
      subject: `Tu hoja semanal fue enviada a ${cfg.nombreCoach || 'tu coach'}`,
      htmlBody: buildEmpresarioConfirmHtml(weekId, d, cump),
      name: DEFAULT_FROM_NAME
    });
  }
}

function sendReminderEmails(hoja) {
  const cfg = getConfig();
  const emailEmp = cfg.emailEmpresario;
  const emailCoach = cfg.emailCoach || DEFAULT_COACH_EMAIL;
  const nombreCoach = cfg.nombreCoach || 'tu coach';

  if (emailEmp) {
    MailApp.sendEmail({
      to: emailEmp,
      subject: `⏰ Recordatorio: tu hoja semanal vence en 24h`,
      htmlBody: buildReminderHtml(hoja, nombreCoach),
      name: DEFAULT_FROM_NAME
    });
  }
  if (emailCoach) {
    MailApp.sendEmail({
      to: emailCoach,
      subject: `⚠️ ${hoja.nombre} aún no envía su hoja (sesión en 24h)`,
      htmlBody: buildCoachAlertHtml(hoja),
      name: DEFAULT_FROM_NAME
    });
  }
}


/* ================================================================ */
/*  PLANTILLAS HTML DE CORREO                                          */
/* ================================================================ */

function buildCoachHtml(weekId, d, cump) {
  const metasValidas = (d.metas || []).filter(m => m.texto && m.texto.trim());
  const metasHtml = metasValidas.map((m, i) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;width:30px;font-weight:700;color:#6b7280">${i + 1}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:600;color:#111827">${esc(m.texto)}</div>
        ${m.observaciones ? `<div style="color:#6b7280;font-size:13px;margin-top:4px">📝 ${esc(m.observaciones)}</div>` : ''}
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;width:90px;text-align:center">
        ${m.cumplida === true
          ? '<span style="background:#10b981;color:#fff;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:700">✓ Sí</span>'
          : m.cumplida === false
            ? '<span style="background:#ef4444;color:#fff;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:700">✕ No</span>'
            : '<span style="background:#6b7280;color:#fff;padding:4px 10px;border-radius:99px;font-size:12px">-</span>'}
      </td>
    </tr>
  `).join('');

  const cumpColor = cump >= 80 ? '#10b981' : cump >= 50 ? '#f59e0b' : '#ef4444';

  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#f9fafb;padding:24px">
    <div style="background:#0d0e12;color:#fff;padding:32px;border-radius:16px 16px 0 0">
      <div style="font-size:12px;letter-spacing:0.15em;color:#d4ff3a;margin-bottom:8px">HOJA SEMANAL RECIBIDA</div>
      <h1 style="margin:0;font-size:28px">${esc(d.nombre)} <span style="color:#6b7280;font-weight:400">·</span> ${esc(d.empresa)}</h1>
      <div style="color:#9aa1b3;margin-top:8px">Semana ${weekId} · Sesión: ${esc(d.dia)} ${esc(d.hora)} ${esc(d.fecha)}</div>
    </div>
    <div style="background:#fff;padding:32px;border-radius:0 0 16px 16px">
      <table style="width:100%;margin-bottom:24px">
        <tr>
          <td style="background:#f3f4f6;padding:16px;border-radius:10px;text-align:center;width:33%">
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.1em">CUMPLIMIENTO</div>
            <div style="font-size:32px;font-weight:900;color:${cumpColor}">${cump}%</div>
          </td>
          <td style="width:8px"></td>
          <td style="background:#f3f4f6;padding:16px;border-radius:10px;text-align:center;width:33%">
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.1em">MOTIVACIÓN</div>
            <div style="font-size:32px;font-weight:900;color:#111827">${d.motivacion || 0}%</div>
          </td>
          <td style="width:8px"></td>
          <td style="background:#f3f4f6;padding:16px;border-radius:10px;text-align:center;width:33%">
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.1em">HORAS</div>
            <div style="font-size:32px;font-weight:900;color:#111827">${d.horas || 0}</div>
          </td>
        </tr>
      </table>

      <h3 style="color:#111827;border-bottom:2px solid #d4ff3a;padding-bottom:8px">🎯 Metas de la semana</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        ${metasHtml || '<tr><td style="padding:16px;color:#6b7280">Sin metas registradas.</td></tr>'}
      </table>

      ${section('🏆 Principal logro', d.logro)}
      ${section('🚧 Mayor reto', d.reto)}
      ${section('📚 Aprendizajes de la semana', d.aprendizajeSemana)}
      ${section('🎯 Meta para la próxima semana', d.metaProxima)}
      ${section('🙋 Ayuda primordial que necesito', d.ayudaCoach)}

      ${d.concentracion && d.concentracion.length ? `
        <div style="margin:20px 0">
          <div style="font-size:12px;color:#6b7280;letter-spacing:0.1em;margin-bottom:8px">ME HE CONCENTRADO EN</div>
          ${d.concentracion.map(c => `<span style="display:inline-block;background:#d4ff3a;color:#0d0e12;padding:4px 12px;border-radius:99px;font-size:13px;font-weight:600;margin:3px">${esc(c)}</span>`).join('')}
        </div>` : ''}

      ${d.trabajado && d.trabajado.length ? `
        <div style="margin:20px 0">
          <div style="font-size:12px;color:#6b7280;letter-spacing:0.1em;margin-bottom:8px">TAMBIÉN HE TRABAJADO EN</div>
          ${d.trabajado.map(c => `<span style="display:inline-block;background:#e5e7eb;color:#111827;padding:4px 12px;border-radius:99px;font-size:13px;font-weight:600;margin:3px">${esc(c)}</span>`).join('')}
        </div>` : ''}

      ${section('💬 Comentarios adicionales', d.comentarios)}

      ${APP_URL ? `<div style="text-align:center;margin-top:32px">
        <a href="${APP_URL}" style="background:#d4ff3a;color:#0d0e12;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">Abrir hoja en la app →</a>
      </div>` : ''}
    </div>
  </div>`;
}

function buildEmpresarioConfirmHtml(weekId, d, cump) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#d4ff3a,#7aff9d);padding:32px;border-radius:16px;text-align:center">
      <div style="font-size:48px;margin-bottom:8px">✅</div>
      <h1 style="margin:0;color:#0d0e12;font-size:24px">Tu hoja fue enviada</h1>
      <div style="color:#0d0e12;margin-top:8px;opacity:0.7">Semana ${weekId}</div>
    </div>
    <div style="background:#fff;padding:24px;border-radius:16px;margin-top:16px;border:1px solid #e5e7eb">
      <p style="margin:0;color:#111827">Hola ${esc(d.nombre)},</p>
      <p style="color:#374151;line-height:1.6">Tu coach ya recibió tu hoja semanal. Aquí van los datos clave:</p>
      <ul style="color:#374151;line-height:1.8;padding-left:20px">
        <li><strong>Cumplimiento:</strong> ${cump}%</li>
        <li><strong>Motivación:</strong> ${d.motivacion || 0}%</li>
        <li><strong>Horas EN tu negocio:</strong> ${d.horas || 0}</li>
        <li><strong>Sesión:</strong> ${esc(d.dia)} ${esc(d.hora)} – ${esc(d.fecha)}</li>
      </ul>
      <p style="color:#6b7280;font-size:13px;margin-top:24px">Nos vemos en la próxima sesión. ¡A darle!</p>
    </div>
  </div>`;
}

function buildReminderHtml(hoja, nombreCoach) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fef3c7;border:2px solid #f59e0b;padding:32px;border-radius:16px;text-align:center">
      <div style="font-size:48px;margin-bottom:8px">⏰</div>
      <h1 style="margin:0;color:#92400e;font-size:24px">Recordatorio: tu hoja semanal</h1>
      <p style="color:#78350f;margin-top:12px;font-size:16px">
        Tu sesión con ${esc(nombreCoach)} es en <strong>24 horas</strong> y aún no has enviado tu Hoja de Seguimiento.
      </p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:16px;margin-top:16px;border:1px solid #e5e7eb">
      <p style="margin:0;color:#111827">Hola ${esc(hoja.nombre)},</p>
      <p style="color:#374151;line-height:1.6">
        Sesión programada: <strong>${esc(hoja.dia)} ${esc(hoja.hora)} — ${esc(hoja.fecha)}</strong><br>
        Recuerda: la regla es enviar la hoja 24 horas antes para que tu coach pueda revisarla y preparar la sesión.
      </p>
      ${APP_URL ? `<div style="text-align:center;margin-top:20px">
        <a href="${APP_URL}" style="background:#d4ff3a;color:#0d0e12;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">Completar mi hoja →</a>
      </div>` : ''}
    </div>
  </div>`;
}

function buildCoachAlertHtml(hoja) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fff;padding:24px;border-radius:16px;border:1px solid #e5e7eb">
      <h2 style="color:#111827;margin-top:0">Hoja pendiente</h2>
      <p style="color:#374151;line-height:1.6">
        <strong>${esc(hoja.nombre)}</strong> (${esc(hoja.empresa)}) tiene sesión en
        <strong>24 horas</strong> y todavía no ha enviado su Hoja de Seguimiento.
      </p>
      <p style="color:#6b7280;font-size:13px">Sesión: ${esc(hoja.dia)} ${esc(hoja.hora)} — ${esc(hoja.fecha)}</p>
    </div>
  </div>`;
}

function section(title, content) {
  if (!content) return '';
  return `
  <div style="margin-bottom:18px">
    <div style="font-size:12px;color:#6b7280;letter-spacing:0.1em;margin-bottom:6px;font-weight:700">${title.toUpperCase()}</div>
    <div style="background:#f9fafb;padding:14px 16px;border-radius:8px;color:#111827;line-height:1.5;border-left:3px solid #d4ff3a">${esc(content)}</div>
  </div>`;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}


/* ================================================================ */
/*  UTILIDADES                                                         */
/* ================================================================ */

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ================================================================ */
/*  SETUP INICIAL — correr UNA vez manualmente                        */
/* ================================================================ */

function setup() {
  getSheet(TAB_HOJAS);
  getSheet(TAB_CONFIG);
  saveConfig({
    emailCoach: DEFAULT_COACH_EMAIL,
    nombreCoach: 'Coach',
    frase: 'Lo que no se mide, no se mejora.'
  });
  Logger.log('Setup OK. Sheet con pestañas "Hojas" y "Config" lista.');
  Logger.log('Siguiente paso: Implementar → Aplicación web (acceso "Cualquiera").');
}

/**
 * Diagnóstico: ver triggers activos y a qué hoja apuntan.
 */
function listarRecordatoriosAgendados() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runReminder');
  Logger.log(`${triggers.length} recordatorios agendados:`);
  triggers.forEach(t => {
    const meta = props.getProperty('rem_' + t.getUniqueId());
    Logger.log(`  - ${meta || '(sin metadata)'}`);
  });
}

/**
 * Limpieza: borra TODOS los triggers de recordatorio y sus metadatos.
 * Úsala si algo se descuadra.
 */
function limpiarRecordatorios() {
  const props = PropertiesService.getScriptProperties();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runReminder')
    .forEach(t => {
      props.deleteProperty('rem_' + t.getUniqueId());
      ScriptApp.deleteTrigger(t);
    });
  Logger.log('Todos los recordatorios eliminados.');
}
