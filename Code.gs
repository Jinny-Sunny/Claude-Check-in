/**
 * Team Log In — ตัวรับข้อมูลฝั่ง Google Sheet (Google Apps Script)
 * ใช้กับ Sheet ที่มีแท็บ Roster / Attendance / Settings อยู่แล้ว
 *
 * วิธีใช้ (ดูรายละเอียดใน README.md)
 * 1) เปิด Google Sheet > ส่วนขยาย (Extensions) > Apps Script
 * 2) ลบโค้ดเดิมทั้งหมด วางโค้ดไฟล์นี้แทน แล้วกดบันทึก
 * 3) เลือกฟังก์ชัน setup แล้วกด Run หนึ่งครั้ง (อนุญาตสิทธิ์ตามที่ Google ถาม)
 * 4) Deploy > New deployment > Web app
 *      Execute as: Me   |   Who has access: Anyone
 * 5) คัดลอก Web app URL (ลงท้ายด้วย /exec) ไปใส่ใน config.js ของหน้าเว็บ
 */

// ถ้าต้องการกันคนอื่นยิงข้อมูลมั่ว ให้ตั้งรหัสตรงนี้ และใส่รหัสเดียวกันใน config.js (KEY)
// หมายเหตุ: รหัสนี้จะมองเห็นได้ในซอร์สของหน้าเว็บ จึงเป็นแค่การกันขั้นพื้นฐาน
const API_KEY = '';

// เวอร์ชันของโค้ดนี้ หน้าเว็บจะแสดงและเตือนถ้ายังใช้เวอร์ชันเก่า
const SCRIPT_VERSION = '1.4.0';

// ชื่อแท็บใน Sheet
const SHEET_ROSTER = 'Roster';
const SHEET_LOG = 'Attendance';
const SHEET_SETTINGS = 'Settings';

// หัวคอลัมน์ที่โค้ดนี้ใช้ (ค้นหาจากชื่อหัวคอลัมน์ ย้ายตำแหน่งคอลัมน์ได้)
const R = { id: 'id', name: 'ชื่อ-นามสกุล', org: 'หน่วยงาน', en: 'ชื่อภาษาอังกฤษ', nick: 'ชื่อเล่น' };
const L = {
  date: 'วันที่', id: 'id', name: 'ชื่อ-นามสกุล', org: 'หน่วยงาน', time: 'เวลาเช็คอิน',
  status: 'สถานะ', lateMin: 'สาย (นาที)', stamp: 'บันทึกเมื่อ (ISO)',
  method: 'วิธีเช็คชื่อ', distance: 'ระยะห่าง (ม.)'
};

// ความคลาดเคลื่อนของ GPS ที่ยอมรับได้มากสุด (เมตร) ตอนสแกน QR
const MAX_GPS_ACCURACY = 150;
const STATUS_TH = { present: 'มาตรงเวลา', late: 'มาสาย', leave: 'ลา', absent: 'ขาด' };
const STATUS_FROM_TEXT = {
  'present': 'present', 'มาตรงเวลา': 'present', 'มา': 'present', 'ตรงเวลา': 'present',
  'late': 'late', 'มาสาย': 'late', 'สาย': 'late',
  'leave': 'leave', 'ลา': 'leave',
  'absent': 'absent', 'ขาด': 'absent'
};

/* ------------------------------------------------------------------ */
/* ตั้งค่าครั้งแรก — กด Run ฟังก์ชันนี้หนึ่งครั้ง (ไม่ลบข้อมูลเดิม)            */
/* ------------------------------------------------------------------ */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const roster = sheet_(ss, SHEET_ROSTER, [R.id, R.name, R.org, R.en]);
  ensureHeaders_(roster, [R.id, R.name, R.org, R.en, R.nick]);

  const log = sheet_(ss, SHEET_LOG, [L.date, L.id, L.name, L.org, L.time, L.status, L.lateMin, L.stamp]);
  const h = ensureHeaders_(log, [L.date, L.id, L.name, L.org, L.time, L.status, L.lateMin, L.stamp, L.method, L.distance]);
  // เก็บวันที่ เวลา และ id เป็นข้อความ เพื่อไม่ให้ Sheets แปลงรูปแบบเอง
  [L.date, L.id, L.time].forEach(function (k) {
    log.getRange(1, h[k] + 1, log.getMaxRows(), 1).setNumberFormat('@');
  });

  const st = sheet_(ss, SHEET_SETTINGS, ['key', 'value']);
  const cur = readKV_(st);
  const defaults = { start: '09:00', grace: 0, lat: '', lng: '', radius: 300 };
  Object.keys(defaults).forEach(function (k) { if (!(k in cur)) writeKV_(st, k, defaults[k]); });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
function doGet(e) {
  try {
    checkKey_(e.parameter.key);
    const action = e.parameter.action || 'load';
    if (action === 'load') return json_(Object.assign({ ok: true }, load_()));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse(e.postData.contents || '{}');
    checkKey_(body.key);
    if (body.action === 'scan') return json_(Object.assign({ ok: true }, scan_(body)));
    if (body.action === 'mark') saveMarks_(String(body.date), body.marks || {});
    else if (body.action === 'roster') saveRoster_(body.members || [], body.settings);
    else throw new Error('unknown action');
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ------------------------------------------------------------------ */
/* อ่านข้อมูล                                                           */
/* ------------------------------------------------------------------ */
function load_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  const roster = [];
  const rs = ss.getSheetByName(SHEET_ROSTER);
  if (rs && rs.getLastRow() > 1) {
    const h = headers_(rs);
    rs.getRange(2, 1, rs.getLastRow() - 1, rs.getLastColumn()).getValues().forEach(function (r) {
      const name = cell_(r, h, R.name);
      if (!name) return;
      roster.push({ id: cell_(r, h, R.id) || newId_(), name: name, nick: cell_(r, h, R.nick), org: cell_(r, h, R.org), en: cell_(r, h, R.en) });
    });
  }

  const days = {};
  const ls = ss.getSheetByName(SHEET_LOG);
  if (ls && ls.getLastRow() > 1) {
    const h = headers_(ls);
    ls.getRange(2, 1, ls.getLastRow() - 1, ls.getLastColumn()).getValues().forEach(function (r) {
      const date = asDate_(r[h[L.date]], tz), id = cell_(r, h, L.id);
      const code = STATUS_FROM_TEXT[cell_(r, h, L.status).toLowerCase()] || '';
      if (!date || !id || !code) return;
      (days[date] = days[date] || {})[id] = { s: code, t: asTime_(r[h[L.time]], tz), n: cell_(r, h, L.name) };
    });
  }
  return { version: SCRIPT_VERSION, roster: roster, settings: readSettings_(ss), days: days };
}

function readSettings_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const s = { start: '09:00', grace: 0, lat: null, lng: null, radius: 300 };
  const sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) return s;
  const kv = readKV_(sh);
  if (kv.start !== undefined) s.start = asTime_(kv.start, tz) || '09:00';
  if (kv.grace !== undefined) s.grace = Number(kv.grace) || 0;
  const lat = parseFloat(kv.lat), lng = parseFloat(kv.lng), radius = parseFloat(kv.radius);
  if (isFinite(lat) && isFinite(lng)) { s.lat = lat; s.lng = lng; }
  if (isFinite(radius) && radius > 0) s.radius = radius;
  if (kv.title) s.title = String(kv.title);
  return s;
}

/* ------------------------------------------------------------------ */
/* สแกน QR: ตรวจวันที่ ตำแหน่ง และใช้เวลาของเซิร์ฟเวอร์                    */
/* ------------------------------------------------------------------ */
function scan_(b) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  if (String(b.date) !== today) throw new Error('QR นี้หมดอายุแล้ว กรุณาสแกน QR ของวันนี้');

  const data = load_();
  const member = data.roster.filter(function (m) { return m.id === String(b.id); })[0];
  if (!member) throw new Error('ไม่พบรายชื่อนี้ แจ้งผู้ดูแลให้เพิ่มรายชื่อ');

  const st = data.settings;
  if (st.lat == null || st.lng == null) throw new Error('ผู้ดูแลยังไม่ได้ตั้งตำแหน่งบริษัท');
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.acc);
  if (!isFinite(lat) || !isFinite(lng)) throw new Error('ไม่ได้รับตำแหน่งจากมือถือ');
  if (isFinite(acc) && acc > Math.max(MAX_GPS_ACCURACY, st.radius * 0.5)) throw new Error('ตำแหน่งยังไม่แม่นยำพอ ลองใหม่อีกครั้ง');
  const distance = Math.round(distance_(lat, lng, st.lat, st.lng));
  if (distance > st.radius) throw new Error('คุณอยู่ห่างจากบริษัท ' + distance + ' เมตร ต้องอยู่ในระยะ ' + st.radius + ' เมตร');

  const existing = (data.days[today] || {})[member.id];
  if (existing && (existing.s === 'present' || existing.s === 'late')) {
    return { status: existing.s, time: existing.t, distance: distance, already: true };
  }
  const time = Utilities.formatDate(now, tz, 'HH:mm');
  const status = toMin_(time) > toMin_(st.start) + Number(st.grace || 0) ? 'late' : 'present';
  const marks = {};
  marks[member.id] = { s: status, t: time, n: member.name, o: member.org || '' };
  saveMarks_(today, marks, 'สแกน QR', distance);
  return { status: status, time: time, distance: distance, already: false };
}

/* ------------------------------------------------------------------ */
/* เขียนข้อมูล                                                          */
/* ------------------------------------------------------------------ */
function saveMarks_(date, marks, method, distance) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('bad date');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const sh = sheet_(ss, SHEET_LOG, [L.date, L.id, L.name, L.org, L.time, L.status, L.lateMin, L.stamp]);
  const h = ensureHeaders_(sh, [L.date, L.id, L.name, L.org, L.time, L.status, L.lateMin, L.stamp, L.method, L.distance]);
  const width = sh.getLastColumn();
  const start = toMin_(readSettings_(ss).start);

  const index = {};
  const last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, width).getValues().forEach(function (r, i) {
      index[asDate_(r[h[L.date]], tz) + '|' + String(r[h[L.id]]).trim()] = i + 2;
    });
  }
  const stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  const toDelete = [];
  Object.keys(marks).forEach(function (id) {
    const m = marks[id] || {};
    const row = index[date + '|' + id];
    if (!m.s) { if (row) toDelete.push(row); return; }
    const lateMin = m.s === 'late' && m.t ? Math.max(0, toMin_(m.t) - start) : '';
    const values = {};
    values[L.date] = date; values[L.id] = id; values[L.name] = m.n || ''; values[L.org] = m.o || '';
    values[L.time] = m.t || ''; values[L.status] = STATUS_TH[m.s] || m.s; values[L.lateMin] = lateMin;
    values[L.stamp] = stamp; values[L.method] = method || 'ผู้ดูแล'; values[L.distance] = distance == null ? '' : distance;

    let target = row;
    if (!target) { target = sh.getLastRow() + 1; index[date + '|' + id] = target; }
    const cur = row ? sh.getRange(target, 1, 1, width).getValues()[0] : new Array(width).fill('');
    Object.keys(values).forEach(function (k) { if (h[k] !== undefined) cur[h[k]] = values[k]; });
    if (!row) [L.date, L.id, L.time].forEach(function (k) { sh.getRange(target, h[k] + 1).setNumberFormat('@'); });
    sh.getRange(target, 1, 1, width).setValues([cur]);
  });
  toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function saveRoster_(members, settings) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = sheet_(ss, SHEET_ROSTER, [R.id, R.name, R.org, R.en]);
  const h = ensureHeaders_(sh, [R.id, R.name, R.org, R.en, R.nick]);
  const width = sh.getLastColumn();
  const rows = members
    .filter(function (m) { return m && String(m.name || '').trim(); })
    .map(function (m) {
      const r = new Array(width).fill('');
      r[h[R.id]] = String(m.id || newId_());
      r[h[R.name]] = String(m.name).trim();
      r[h[R.org]] = String(m.org || '');
      r[h[R.en]] = String(m.en || '');
      r[h[R.nick]] = String(m.nick || '');
      return r;
    });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, width).clearContent();
  if (rows.length) {
    sh.getRange(2, h[R.id] + 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, width).setValues(rows);
  }

  if (settings) {
    const st = sheet_(ss, SHEET_SETTINGS, ['key', 'value']);
    writeKV_(st, 'start', String(settings.start || '09:00'), true);
    writeKV_(st, 'grace', Number(settings.grace) || 0);
    writeKV_(st, 'lat', settings.lat == null ? '' : Number(settings.lat));
    writeKV_(st, 'lng', settings.lng == null ? '' : Number(settings.lng));
    writeKV_(st, 'radius', Number(settings.radius) || 300);
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function headers_(sh) {
  const map = {};
  const w = sh.getLastColumn();
  if (!w) return map;
  sh.getRange(1, 1, 1, w).getValues()[0].forEach(function (v, i) {
    const k = String(v || '').trim();
    if (k && map[k] === undefined) map[k] = i;
  });
  return map;
}
/** เพิ่มหัวคอลัมน์ที่ยังไม่มีไว้ท้ายตาราง แล้วคืนตำแหน่งคอลัมน์ทั้งหมด */
function ensureHeaders_(sh, names) {
  let h = headers_(sh);
  names.forEach(function (n) {
    if (h[n] === undefined) {
      const col = sh.getLastColumn() + 1;
      sh.getRange(1, col).setValue(n).setFontWeight('bold');
      h[n] = col - 1;
    }
  });
  return h;
}
function cell_(row, h, name) { return h[name] === undefined ? '' : String(row[h[name]] == null ? '' : row[h[name]]).trim(); }
function readKV_(sh) {
  const kv = {};
  if (sh.getLastRow() < 2) return kv;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    const k = String(r[0] || '').trim();
    if (k) kv[k] = r[1];
  });
  return kv;
}
function writeKV_(sh, key, value, asText) {
  const last = sh.getLastRow();
  let row = 0;
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]).trim() === key) row = i + 2; });
  }
  if (!row) { row = sh.getLastRow() + 1; sh.getRange(row, 1).setValue(key); }
  if (asText) sh.getRange(row, 2).setNumberFormat('@');
  sh.getRange(row, 2).setValue(value);
}
function toMin_(hm) { const p = String(hm).split(':'); return Number(p[0]) * 60 + Number(p[1]); }
function distance_(lat1, lng1, lat2, lng2) {
  const Rm = 6371000, r = function (x) { return x * Math.PI / 180; };
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * Rm * Math.asin(Math.sqrt(a));
}
function asDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // 20/10/2026
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s.slice(0, 10);
}
function asTime_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
  const m = String(v || '').trim().match(/(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}
function checkKey_(key) {
  if (API_KEY && key !== API_KEY) throw new Error('รหัส KEY ไม่ถูกต้อง');
}
function newId_() {
  return 'm' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
