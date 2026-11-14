/**
 * เว็บเช็คชื่อทีม 9 โมง — ตัวรับข้อมูลฝั่ง Google Sheet (Google Apps Script)
 *
 * วิธีใช้ (ดูรายละเอียดใน README.md)
 * 1) เปิด Google Sheet ใหม่ > ส่วนขยาย (Extensions) > Apps Script
 * 2) วางโค้ดไฟล์นี้ทั้งหมดแทนโค้ดเดิม แล้วกดบันทึก
 * 3) เลือกฟังก์ชัน setup แล้วกด Run หนึ่งครั้ง (อนุญาตสิทธิ์ตามที่ Google ถาม)
 * 4) Deploy > New deployment > Web app
 *      Execute as: Me   |   Who has access: Anyone
 * 5) คัดลอก Web app URL ไปใส่ใน config.js ของหน้าเว็บ
 */

// ถ้าต้องการกันคนอื่นยิงข้อมูลมั่ว ให้ตั้งรหัสตรงนี้ และใส่รหัสเดียวกันใน config.js (KEY)
// หมายเหตุ: รหัสนี้จะมองเห็นได้ในซอร์สของหน้าเว็บ จึงเป็นแค่การกันขั้นพื้นฐาน
const API_KEY = '';

const SHEET_ROSTER = 'รายชื่อ';
const SHEET_LOG = 'เช็คชื่อ';
const SHEET_SETTINGS = 'ตั้งค่า';

const ROSTER_HEADERS = ['รหัส', 'ชื่อ-นามสกุล', 'ชื่อเล่น', 'บริษัท/หน่วยงาน'];
const LOG_HEADERS = ['วันที่', 'รหัส', 'ชื่อ-นามสกุล', 'บริษัท/หน่วยงาน', 'สถานะ', 'เวลาเข้า', 'บันทึกเมื่อ', 'status_code', 'วิธีเช็คชื่อ', 'ระยะห่าง (ม.)'];
// ตำแหน่งที่ยอมให้คลาดเคลื่อนได้มากสุด (เมตร) ตอนสแกน QR
const MAX_GPS_ACCURACY = 150;
const STATUS_TH = { present: 'มาตรงเวลา', late: 'มาสาย', leave: 'ลา', absent: 'ขาด' };

// รายชื่อเริ่มต้น 22 คน (ใช้ตอนรัน setup ครั้งแรกเท่านั้น)
const SEED_ROSTER = [
  ['m01', 'ภณธกร วงศ์เจริญ', '', 'เบทาโกร'],
  ['m02', 'วิภาดา พลาธนพร', '', 'Foodle Noodle Co., Ltd'],
  ['m03', 'สิริวรรณ รอดศิริ', '', 'Foodle Noodle Co., Ltd'],
  ['m04', 'วิศรุต สุดสัตย์', '', 'Foodle Noodle Co., Ltd'],
  ['m05', 'กิตติธัช ธูปถมพงศ์', '', 'Foodle Noodle Co., Ltd'],
  ['m06', 'วราภรณ์ หวานล้ำ', '', 'บริษัท โอชาฟูดแพ็ค จำกัด'],
  ['m07', 'ณัฏชา แสวงหอม', '', 'บริษัท โอชาฟูดแพ็ค จำกัด'],
  ['m08', 'นรพนธ์ จิรัฐิติกาลพงศ์', '', 'บริษัท ซีเอ็ม พรีเมี่ยม ไรซ์ จำกัด'],
  ['m09', 'คงติภูมิ มณีโชค', '', 'บริษัท ซีเอ็ม พรีเมี่ยม ไรซ์ จำกัด'],
  ['m10', 'จิดาภา ทองเกิด', '', 'เทพผดุงพรมะพร้าว จำกัด'],
  ['m11', 'สุชาดา เอี่ยมสำอางค์', '', 'เทพผดุงพรมะพร้าว จำกัด'],
  ['m12', 'พิชญา พิสุทธิ์พิเชฎฐ์', '', 'เทพผดุงพรมะพร้าว จำกัด'],
  ['m13', 'วันทนา จุตาลานนท์', '', 'เทพผดุงพรมะพร้าว จำกัด'],
  ['m14', 'ธนวรรณ ตั้งตรงพานิช', '', 'บริษัท โอชาฟูดแพ็ค จำกัด'],
  ['m15', 'ระวีวรรณ การภักดี', '', 'บริษัท โอชาฟูดแพ็ค จำกัด'],
  ['m16', 'คณาธิป จำนงค์', '', 'บริษัท ลาโต้ ฟู้ดแอนด์ดริ้งส์ จำกัด'],
  ['m17', 'พรพิมล ผลเพิ่ม', '', 'บริษัท ลาโต้ ฟู้ดแอนด์ดริ้งส์ จำกัด'],
  ['m18', 'รัตติยากร ฉายหิรัญ', '', 'บริษัท สยาม คอนซูมเมอร์ โปรดักส์ จำกัด'],
  ['m19', 'วิชยุตม์ กีรติธนาภรณ์', '', 'บริษัท เมอร์เดียนท์ จำกัด'],
  ['m20', 'จิตรา คำแหง', '', 'บริษัท โอชาฟูดแพ็ค จำกัด'],
  ['m21', 'อรณิชา ครองศักดิ์ศิริ', '', 'บริษัท โอชาฟูดแพ็ค จำกัด'],
  ['m22', 'นัทธมน พุทธพรม', '', 'บริษัท โอชาฟูดแพ็ค จำกัด'],
];

/* ------------------------------------------------------------------ */
/* ตั้งค่าชีตครั้งแรก — กด Run ฟังก์ชันนี้หนึ่งครั้ง                         */
/* ------------------------------------------------------------------ */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const roster = getOrCreate_(ss, SHEET_ROSTER, ROSTER_HEADERS);
  if (roster.getLastRow() < 2) {
    roster.getRange(2, 1, SEED_ROSTER.length, ROSTER_HEADERS.length).setValues(SEED_ROSTER);
  }
  roster.autoResizeColumns(1, ROSTER_HEADERS.length);

  const log = getOrCreate_(ss, SHEET_LOG, LOG_HEADERS);
  // เก็บวันที่และเวลาเป็นข้อความ เพื่อไม่ให้ Sheets แปลงรูปแบบเอง
  log.getRange('A:A').setNumberFormat('@');
  log.getRange('F:F').setNumberFormat('@');
  log.getRange('B:B').setNumberFormat('@');

  const settings = getOrCreate_(ss, SHEET_SETTINGS, ['ค่า', 'ข้อมูล']);
  if (settings.getLastRow() < 2) {
    settings.getRange('B2').setNumberFormat('@');
    settings.getRange(2, 1, 5, 2).setValues([
      ['เวลาเริ่มเรียน', '09:00'], ['ผ่อนผัน (นาที)', 0],
      ['ละติจูดบริษัท', ''], ['ลองจิจูดบริษัท', ''], ['รัศมีที่เช็คชื่อได้ (เมตร)', 300]
    ]);
  }

  const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
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
/* อ่าน / เขียนข้อมูล                                                    */
/* ------------------------------------------------------------------ */
function load_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  const roster = [];
  const rs = ss.getSheetByName(SHEET_ROSTER);
  if (rs && rs.getLastRow() > 1) {
    rs.getRange(2, 1, rs.getLastRow() - 1, 4).getValues().forEach(function (r) {
      const name = String(r[1] || '').trim();
      if (!name) return;
      roster.push({ id: String(r[0] || '').trim() || newId_(), name: name, nick: String(r[2] || '').trim(), org: String(r[3] || '').trim() });
    });
  }

  const settings = readSettings_(ss);

  const days = {};
  const ls = ss.getSheetByName(SHEET_LOG);
  if (ls && ls.getLastRow() > 1) {
    ls.getRange(2, 1, ls.getLastRow() - 1, LOG_HEADERS.length).getValues().forEach(function (r) {
      const date = asDate_(r[0], tz), id = String(r[1] || '').trim(), code = String(r[7] || '').trim();
      if (!date || !id || !code) return;
      (days[date] = days[date] || {})[id] = { s: code, t: asTime_(r[5], tz), n: String(r[2] || '') };
    });
  }
  return { roster: roster, settings: settings, days: days };
}

function readSettings_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const settings = { start: '09:00', grace: 0, lat: null, lng: null, radius: 300 };
  const sh = ss.getSheetByName(SHEET_SETTINGS);
  if (sh && sh.getLastRow() >= 3) {
    const v = sh.getRange('B2:B6').getValues();
    settings.start = asTime_(v[0][0], tz) || '09:00';
    settings.grace = Number(v[1][0]) || 0;
    const lat = parseFloat(v[2][0]), lng = parseFloat(v[3][0]), radius = parseFloat(v[4][0]);
    if (isFinite(lat) && isFinite(lng)) { settings.lat = lat; settings.lng = lng; }
    if (isFinite(radius) && radius > 0) settings.radius = radius;
  }
  return settings;
}

/** น้องสแกน QR แล้วกดเช็คชื่อ: ตรวจวันที่ ตำแหน่ง และให้เวลาจากเซิร์ฟเวอร์ */
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
  const late = toMin_(time) > toMin_(st.start) + Number(st.grace || 0);
  const status = late ? 'late' : 'present';
  const marks = {};
  marks[member.id] = { s: status, t: time, n: member.name, o: member.org || '' };
  saveMarks_(today, marks, 'สแกน QR', distance);
  return { status: status, time: time, distance: distance, already: false };
}
function toMin_(hm) { const p = String(hm).split(':'); return Number(p[0]) * 60 + Number(p[1]); }
function distance_(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = function (x) { return x * Math.PI / 180; };
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function saveMarks_(date, marks, method, distance) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('bad date');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const sh = getOrCreate_(ss, SHEET_LOG, LOG_HEADERS);
  const last = sh.getLastRow();
  const index = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r, i) {
      index[asDate_(r[0], tz) + '|' + String(r[1]).trim()] = i + 2;
    });
  }
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const toDelete = [];
  Object.keys(marks).forEach(function (id) {
    const m = marks[id] || {};
    const row = index[date + '|' + id];
    if (!m.s) { if (row) toDelete.push(row); return; }
    const values = [[date, id, m.n || '', m.o || '', STATUS_TH[m.s] || m.s, m.t || '', stamp, m.s, method || 'ผู้ดูแล', distance == null ? '' : distance]];
    if (row) sh.getRange(row, 1, 1, LOG_HEADERS.length).setValues(values);
    else {
      const r = sh.getLastRow() + 1;
      sh.getRange(r, 1, 1, LOG_HEADERS.length).setNumberFormat('@').setValues(values);
      index[date + '|' + id] = r;
    }
  });
  toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function saveRoster_(members, settings) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate_(ss, SHEET_ROSTER, ROSTER_HEADERS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, ROSTER_HEADERS.length).clearContent();
  const rows = members
    .filter(function (m) { return m && String(m.name || '').trim(); })
    .map(function (m) { return [String(m.id || newId_()), String(m.name).trim(), String(m.nick || ''), String(m.org || '')]; });
  if (rows.length) sh.getRange(2, 1, rows.length, ROSTER_HEADERS.length).setValues(rows);

  if (settings) {
    const st = getOrCreate_(ss, SHEET_SETTINGS, ['ค่า', 'ข้อมูล']);
    st.getRange('B2').setNumberFormat('@');
    st.getRange(2, 1, 5, 2).setValues([
      ['เวลาเริ่มเรียน', String(settings.start || '09:00')],
      ['ผ่อนผัน (นาที)', Number(settings.grace) || 0],
      ['ละติจูดบริษัท', settings.lat == null ? '' : Number(settings.lat)],
      ['ลองจิจูดบริษัท', settings.lng == null ? '' : Number(settings.lng)],
      ['รัศมีที่เช็คชื่อได้ (เมตร)', Number(settings.radius) || 300]
    ]);
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function getOrCreate_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#dcefe9');
    sh.setFrozenRows(1);
  }
  return sh;
}
function asDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v || '').trim();
}
function asTime_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
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
