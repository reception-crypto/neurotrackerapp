require('dotenv').config();

const express = require('express');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const basicAuth = require('basic-auth');
const PDFDocument = require('pdfkit');
const { createIdentityStore, supportId } = require('./identity_store');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST ||
  (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
const identitySecret = process.env.IDENTITY_SECRET || 'development-only-identity-secret-change-me';
const adminUser = process.env.ADMIN_USER || process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-admin-password';
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const csvPath = path.join(dataDir, 'symptom_entries.csv');
const identityStore = createIdentityStore({ dataDir, secret: identitySecret });

const csvColumns = ['ReceivedAt','Date','Time','Patient','Track','Disorder','Symptom','Score','WellnessPercent','SubmissionId','PatientId'];

if (process.env.NODE_ENV === 'production' &&
    (identitySecret.startsWith('development-only') ||
     identitySecret.startsWith('change-this') ||
     identitySecret.startsWith('replace-with') ||
     identitySecret.length < 32 ||
     adminPassword.startsWith('change-this') ||
     adminPassword.startsWith('replace-with') ||
     adminPassword.length < 16)) {
  throw new Error(
    'IDENTITY_SECRET and ADMIN_PASSWORD must be configured for production.',
  );
}

function ensureCsvFile() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, csvColumns.join(',') + '\n', 'utf8');
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function looksLikeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function looksLikeTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T/.test(String(value || ''));
}

function looksLikeTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function validScore(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 10;
}

function validSubmittedScore(value) {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10;
}

function validWellness(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function validSubmittedWellness(value) {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 10 &&
    value <= 100 &&
    value % 10 === 0;
}

function validClinicalLabel(value, maximumLength = 160) {
  const text = String(value || '');
  return text.trim().length > 0 &&
    text.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(text);
}

function normalisedRecord(receivedAt, date, time, patient, track, disorder, symptom, score, wellness, submissionId = '', patientId = '') {
  if (!looksLikeDate(date) || !patient || !disorder || !symptom || !validScore(score)) return null;
  return {
    ReceivedAt: receivedAt || `${date}T${time || '00:00'}:00`,
    Date: date,
    Time: time || '',
    Patient: patient,
    Track: track || 'Primary',
    Disorder: disorder,
    Symptom: symptom,
    Score: String(Number(score)),
    WellnessPercent: validWellness(wellness) ? String(Number(wellness)) : '',
    SubmissionId: String(submissionId || ''),
    PatientId: String(patientId || ''),
  };
}

function expandLegacyWideRow(values, hasReceivedAt = false) {
  const offset = hasReceivedAt ? 1 : 0;
  const receivedAt = hasReceivedAt ? values[0] : '';
  const date = values[offset];
  const time = values[offset + 1];
  const patient = values[offset + 2];
  const disorder = values[offset + 3];
  const wellness = values[offset + 10];
  const records = [];
  for (const [symptomIndex, scoreIndex] of [[4,5],[6,7],[8,9]]) {
    const record = normalisedRecord(
      receivedAt,
      date,
      time,
      patient,
      'Primary',
      disorder,
      values[offset + symptomIndex],
      values[offset + scoreIndex],
      wellness,
    );
    if (record) records.push(record);
  }
  return records;
}

function normaliseCsvRows(parsed) {
  if (!parsed.length) return [];
  const headers = parsed[0].map(h => String(h || '').trim());
  const dataRows = parsed.slice(1);
  const normalised = [];

  const headerIndex = Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), i]));
  const isNormalHeader = headers.includes('Symptom') && headers.includes('Score');
  const isWideHeader = headers.some(h => /^Symptom_?1$/i.test(h)) || headers.includes('Symptom1');

  for (const values of dataRows) {
    if (!values.some(v => String(v || '').trim())) continue;

    // Current schema with stable submission and patient identifiers.
    if (values.length === 11 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 11));
      if (record) normalised.push(record);
      continue;
    }

    // Previous server schema without identifiers.
    if (values.length === 9 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      const record = normalisedRecord(...values.slice(0, 9));
      if (record) normalised.push(record);
      continue;
    }

    // Local app schema: Date,Time,Patient,Track,Disorder,Symptom,Score,WellnessPercent
    if (values.length === 8 && looksLikeDate(values[0])) {
      const record = normalisedRecord('', ...values);
      if (record) normalised.push(record);
      continue;
    }

    // Older wide schemas, with or without ReceivedAt.
    if (values.length >= 12 && looksLikeTimestamp(values[0]) && looksLikeDate(values[1])) {
      normalised.push(...expandLegacyWideRow(values, true));
      continue;
    }
    if (values.length >= 11 && looksLikeDate(values[0])) {
      normalised.push(...expandLegacyWideRow(values, false));
      continue;
    }

    // Header-driven fallback for consistently formatted files.
    if (isNormalHeader) {
      const get = name => values[headerIndex[name.toLowerCase()]] || '';
      const record = normalisedRecord(
        get('ReceivedAt'), get('Date'), get('Time'), get('Patient'), get('Track'),
        get('Disorder'), get('Symptom'), get('Score'), get('WellnessPercent'),
        get('SubmissionId'), get('PatientId'),
      );
      if (record) normalised.push(record);
      continue;
    }
    if (isWideHeader) {
      const hasReceived = headers[0] === 'ReceivedAt';
      normalised.push(...expandLegacyWideRow(values, hasReceived));
    }
  }

  return normalised;
}

function serialiseNormalisedRows(rows) {
  const lines = [csvColumns.join(',')];
  for (const row of rows) {
    lines.push(csvColumns.map(column => escapeCsv(row[column] || '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function repairCsvIfNeeded() {
  ensureCsvFile();
  const original = fs.readFileSync(csvPath, 'utf8');
  const parsed = parseCsv(original);
  if (!parsed.length) return;
  const headers = parsed[0].map(h => String(h || '').trim());
  const rows = normaliseCsvRows(parsed);
  const repaired = serialiseNormalisedRows(rows);
  const canonicalHeader = csvColumns.join(',');
  const needsRepair = headers.join(',') !== canonicalHeader || original !== repaired;
  if (!needsRepair) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dataDir, `symptom_entries.backup-${stamp}.csv`);
  fs.copyFileSync(csvPath, backupPath);
  fs.writeFileSync(csvPath, repaired, 'utf8');
  console.log(`NeuroSol CSV normalised: ${rows.length} rows. Backup: ${backupPath}`);
}

function readRows() {
  ensureCsvFile();
  const parsed = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const rows = normaliseCsvRows(parsed);
  return rows.map(row => ({
    ...row,
    ScoreNumber: Number(row.Score),
    WellnessNumber: Number(row.WellnessPercent || 0),
  })).filter(row => Number.isFinite(row.ScoreNumber));
}

function bearerToken(req) {
  const header = String(req.header('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requireDeviceIdentity(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const identity = identityStore.authenticate(bearerToken(req));
  if (identity) {
    req.deviceIdentity = identity;
    return next();
  }
  return res.status(401).json({
    error: 'This device is not enrolled or its access has been revoked.',
    code: 'device_not_authorised',
  });
}

function adminCsrfToken() {
  return crypto
    .createHmac('sha256', identitySecret)
    .update(`admin-enrolments:${adminUser}`)
    .digest('hex');
}

function validAdminCsrf(value) {
  const supplied = Buffer.from(String(value || ''), 'utf8');
  const expected = Buffer.from(adminCsrfToken(), 'utf8');
  return supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

function requireAdminCsrf(req, res, next) {
  if (!validAdminCsrf(req.body?.csrfToken)) {
    return res.status(403).send('The form expired or could not be verified.');
  }
  next();
}

function requireAdmin(req, res, next) {
  const user = basicAuth(req);
  if (!user || user.name !== adminUser || user.pass !== adminPassword) {
    res.set('WWW-Authenticate', 'Basic realm="NeuroSol Admin"');
    return res.status(401).send('Authentication required.');
  }
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  next();
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function patientKey(row) {
  const patientId = String(row?.PatientId || '').trim();
  if (patientId) return patientId;
  const legacyName = String(row?.Patient || '').trim();
  return legacyName ? `legacy:${legacyName}` : '';
}

function patientDirectory(rows) {
  const directory = new Map();
  for (const row of rows) {
    const key = patientKey(row);
    const displayName = String(row.Patient || '').trim() || 'Unnamed patient';
    if (!key) continue;
    const timestamp = row.ReceivedAt || `${row.Date || ''}T${row.Time || ''}`;
    const current = directory.get(key);
    if (!current || timestamp >= current.latestTimestamp) {
      const isLegacy = key.startsWith('legacy:');
      const shortId = isLegacy ? 'Legacy record' : supportId(key);
      directory.set(key, {
        patientId: key,
        displayName,
        latestTimestamp: timestamp,
        supportId: shortId,
        label: isLegacy ? `${displayName} (legacy record)` : `${displayName} (${shortId})`,
      });
    }
  }
  return directory;
}

function resolvePatientKey(rows, requestedPatientId, legacyName = '') {
  const directory = patientDirectory(rows);
  const requested = String(requestedPatientId || '').trim();
  if (requested && directory.has(requested)) return requested;
  const oldName = String(legacyName || '').trim();
  if (oldName) {
    const match = [...directory.values()].find(patient => patient.displayName === oldName);
    if (match) return match.patientId;
  }
  return [...directory.keys()][0] || '';
}

function unique(rows, key) { return [...new Set(rows.map(r => r[key]).filter(Boolean))].sort(); }
function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0; }
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a,b)=>a-b), m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}
function round1(n) { return Math.round(n * 10) / 10; }
function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v-m)**2)));
}
function isoWeekStart(dateText) {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0,10);
}
function periodKey(dateText, aggregation) {
  if (aggregation === 'daily') return dateText;
  if (aggregation === 'weekly') return isoWeekStart(dateText);
  const d = new Date(`${dateText}T00:00:00`);
  if (aggregation === 'monthly') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  const start = new Date(d.getFullYear(),0,1);
  const day = Math.floor((d-start)/86400000);
  const fortnight = Math.floor(day/14)*14;
  start.setDate(start.getDate()+fortnight);
  return start.toISOString().slice(0,10);
}
function dateLabel(dateText, aggregation) {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  if (aggregation === 'monthly') return d.toLocaleDateString('en-AU',{month:'short',year:'numeric'});
  return d.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
}

function utcDateFromIso(dateText) {
  if (!looksLikeDate(dateText)) return null;
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function addIsoDays(dateText, amount) {
  const date = utcDateFromIso(dateText);
  if (!date) return dateText;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function todayIso(timeZone = process.env.APP_TIME_ZONE || 'Australia/Brisbane') {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function metricLabel(metric) {
  if (metric === 'wellness') return 'Wellness';
  if (metric === 'symptom') return 'Average symptom score';
  if (metric.startsWith('symptom:')) return metric.slice('symptom:'.length);
  return 'Metric';
}

function buildCalendarDays(rows, metric, requestedDays = 30, endDate = todayIso()) {
  const range = [30, 60, 90].includes(Number(requestedDays)) ? Number(requestedDays) : 30;
  const safeEndDate = utcDateFromIso(endDate) ? endDate : todayIso();
  const startDate = addIsoDays(safeEndDate, -(range - 1));
  const symptomMetric = metric.startsWith('symptom:') ? metric.slice('symptom:'.length) : '';
  const wellnessMetric = metric === 'wellness';
  const buckets = new Map();

  for (const row of rows) {
    if (!utcDateFromIso(row.Date)) continue;
    if (!buckets.has(row.Date)) buckets.set(row.Date, { values: [], seen: new Set() });
    const bucket = buckets.get(row.Date);

    if (wellnessMetric) {
      const value = Number(row.WellnessPercent);
      if (row.WellnessPercent === '' || !Number.isFinite(value)) continue;
      const submissionKey = row.SubmissionId || row.ReceivedAt || `${row.Date}|${row.Time}|${value}`;
      if (bucket.seen.has(submissionKey)) continue;
      bucket.seen.add(submissionKey);
      bucket.values.push(value);
      continue;
    }

    if (symptomMetric && row.Symptom !== symptomMetric) continue;
    if (Number.isFinite(row.ScoreNumber)) bucket.values.push(row.ScoreNumber);
  }

  const days = [];
  for (let index = 0; index < range; index++) {
    const date = addIsoDays(startDate, index);
    const values = buckets.get(date)?.values || [];
    days.push({
      date,
      recorded: values.length > 0,
      value: values.length ? round1(mean(values)) : null,
    });
  }

  return {
    days,
    range,
    startDate,
    endDate: safeEndDate,
    isWellness: wellnessMetric,
    label: metricLabel(metric),
  };
}

function calendarDateLabel(dateText, includeYear = false) {
  const date = utcDateFromIso(dateText);
  if (!date) return dateText;
  return date.toLocaleDateString('en-AU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

function renderMetricCalendar(rows, metric, requestedDays = 30, endDate = todayIso()) {
  const calendar = buildCalendarDays(rows, metric, requestedDays, endDate);
  const firstDate = utcDateFromIso(calendar.startDate);
  const firstColumn = firstDate ? ((firstDate.getUTCDay() + 6) % 7) + 1 : 1;
  const maxValue = calendar.isWellness ? 100 : 10;
  const colourClass = calendar.isWellness ? 'wellness' : 'symptom';
  const unit = calendar.isWellness ? '%' : '/10';
  const weekdayHeaders = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .map(day => `<div class="calendar-weekday">${day}</div>`).join('');

  const dayCards = calendar.days.map((day, index) => {
    const date = utcDateFromIso(day.date);
    const dayNumber = date?.getUTCDate() || '';
    const showMonth = index === 0 || dayNumber === 1;
    const month = date ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()] : '';
    const dateText = showMonth ? `${dayNumber} ${month}` : String(dayNumber);
    const valueText = day.recorded ? `${day.value}${unit}` : 'No entry';
    const title = `${calendarDateLabel(day.date, true)} — ${calendar.label}: ${valueText}`;
    const full = day.recorded && day.value >= maxValue;
    const classes = [
      'calendar-day',
      colourClass,
      day.recorded ? 'recorded' : 'no-entry',
      full ? 'full' : '',
    ].filter(Boolean).join(' ');
    const firstStyle = index === 0 ? ` style="grid-column-start:${firstColumn}"` : '';
    const markerSize = day.recorded && day.value > 0 && !full
      ? Math.round(6 + (Math.min(maxValue, day.value) / maxValue) * 32)
      : 0;
    const marker = markerSize
      ? `<span class="calendar-dot" style="width:${markerSize}px;height:${markerSize}px"></span>`
      : '';

    return `<div class="${classes}"${firstStyle} title="${html(title)}" aria-label="${html(title)}">
      <span class="calendar-date">${html(dateText)}</span>${marker}
    </div>`;
  }).join('');

  const legend = calendar.isWellness
    ? `<span><i class="calendar-key missing"></i>No entry</span>
       <span><i class="calendar-key dot wellness small"></i>30%</span>
       <span><i class="calendar-key dot wellness medium"></i>60%</span>
       <span><i class="calendar-key full wellness"></i>100%</span>`
    : `<span><i class="calendar-key zero"></i>0 recorded</span>
       <span><i class="calendar-key dot symptom small"></i>3/10</span>
       <span><i class="calendar-key dot symptom medium"></i>6/10</span>
       <span><i class="calendar-key full symptom"></i>10/10</span>
       <span><i class="calendar-key missing"></i>No entry</span>`;

  return `<div class="calendar-view" data-calendar-days="${calendar.range}">
    <div class="calendar-range">${html(calendarDateLabel(calendar.startDate, true))} – ${html(calendarDateLabel(calendar.endDate, true))}</div>
    <div class="calendar-scroll"><div class="calendar-frame">
      <div class="calendar-weekdays">${weekdayHeaders}</div>
      <div class="calendar-grid">${dayCards}</div>
    </div></div>
    <div class="calendar-legend">${legend}</div>
  </div>`;
}

function patientSeries(
  rows,
  disorder,
  metric,
  aggregation='weekly',
  selectedPatients=[],
  patientNames=null,
) {
  const symptomMetric = metric.startsWith('symptom:') ? metric.slice('symptom:'.length) : '';
  const directory = patientNames || patientDirectory(rows);
  const filtered = rows.filter(r =>
    (!disorder || r.Disorder === disorder) &&
    (!selectedPatients.length || selectedPatients.includes(patientKey(r))) &&
    (!symptomMetric || r.Symptom === symptomMetric)
  );
  const byPatient = new Map();
  for (const r of filtered) {
    const patient = patientKey(r);
    if (!patient || !r.Date) continue;
    const key = periodKey(r.Date, aggregation);
    if (!byPatient.has(patient)) byPatient.set(patient, new Map());
    const period = byPatient.get(patient);
    if (!period.has(key)) period.set(key, { scores: [], wellness: [], wellnessSeen: new Set() });
    const bucket = period.get(key);
    if (Number.isFinite(r.ScoreNumber)) bucket.scores.push(r.ScoreNumber);
    const wellnessKey = r.SubmissionId || `${r.Date}|${r.Time}|${r.WellnessNumber}`;
    if (r.WellnessNumber > 0 && !bucket.wellnessSeen.has(wellnessKey)) {
      bucket.wellnessSeen.add(wellnessKey);
      bucket.wellness.push(r.WellnessNumber);
    }
  }
  return [...byPatient.entries()].map(([patient, periods]) => ({
    patient,
    label: directory.get(patient)?.label || patient,
    series: [...periods.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,b]) => ({
      date,
      value: round1(metric === 'wellness' ? mean(b.wellness) : mean(b.scores))
    })).filter(p=>Number.isFinite(p.value))
  })).filter(p=>p.series.length);
}

function cohortSeries(series, metric) {
  const dates = [...new Set(series.flatMap(p=>p.series.map(x=>x.date)))].sort();
  const maxY = metric === 'wellness' ? 100 : 10;
  return dates.map(date => {
    const values = series.map(p=>p.series.find(x=>x.date===date)?.value).filter(Number.isFinite);
    const avg = mean(values), sd = stddev(values);
    return { date, average:round1(avg), median:round1(median(values)), lower:round1(Math.max(0,avg-sd)), upper:round1(Math.min(maxY,avg+sd)), count:values.length };
  }).filter(x=>x.count);
}

function classifyPatientTrend(p, metric) {
  if (p.series.length < 2) return 'Insufficient data';
  const first = mean(p.series.slice(0,Math.min(3,p.series.length)).map(x=>x.value));
  const last = mean(p.series.slice(-Math.min(3,p.series.length)).map(x=>x.value));
  const delta = last-first;
  const threshold = metric === 'wellness' ? 8 : 0.8;
  if (metric === 'wellness') return delta > threshold ? 'Improving' : delta < -threshold ? 'Deteriorating' : 'Stable';
  return delta < -threshold ? 'Improving' : delta > threshold ? 'Deteriorating' : 'Stable';
}

function svgChart(series, metric, aggregation, mode='summary', selectedPatient='') {
  const width=1120, height=540, left=74, right=28, top=42, bottom=64;
  const maxY = metric==='wellness'?100:10;
  const allDates=[...new Set(series.flatMap(p=>p.series.map(x=>x.date)))].sort();
  if (!allDates.length) return '<p class="empty">No matching data.</p>';
  const index=new Map(allDates.map((d,i)=>[d,i]));
  const x=d=>left+((index.get(d)||0)/Math.max(1,allDates.length-1))*(width-left-right);
  const y=v=>height-bottom-(v/maxY)*(height-top-bottom);
  const ticks=metric==='wellness'?[0,20,40,60,80,100]:[0,2,4,6,8,10];
  const summary=cohortSeries(series,metric);
  const grid=ticks.map(t=>`<line x1="${left}" x2="${width-right}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e7eb"/><text x="${left-14}" y="${y(t)+4}" text-anchor="end" class="axis">${t}${metric==='wellness'?'%':''}</text>`).join('');
  const step=Math.max(1,Math.ceil(allDates.length/9));
  const labels=allDates.map((d,i)=>(i%step===0||i===allDates.length-1)?`<text x="${x(d)}" y="${height-24}" text-anchor="middle" class="axis">${html(dateLabel(d,aggregation))}</text>`:'').join('');
  const palette=['#2563eb','#059669','#dc2626','#7c3aed','#d97706','#0891b2','#be123c','#4f46e5','#16a34a','#9333ea'];
  let lines='';
  if (mode==='summary') {
    lines=series.map(p=>{
      const pts=p.series.map(q=>`${x(q.date)},${y(q.value)}`).join(' ');
      return `<polyline class="patient-faint" points="${pts}"><title>${html(p.label || p.patient)}</title></polyline>`;
    }).join('');
    const upper=summary.map(q=>`${x(q.date)},${y(q.upper)}`).join(' ');
    const lower=[...summary].reverse().map(q=>`${x(q.date)},${y(q.lower)}`).join(' ');
    lines+=`<polygon points="${upper} ${lower}" fill="#93c5fd" opacity="0.28"/>`;
    lines+=`<polyline class="cohort" points="${summary.map(q=>`${x(q.date)},${y(q.average)}`).join(' ')}"/>`;
    lines+=`<polyline class="median" points="${summary.map(q=>`${x(q.date)},${y(q.median)}`).join(' ')}"/>`;
    lines+=summary.map(q=>`<circle cx="${x(q.date)}" cy="${y(q.average)}" r="4" fill="#1d4ed8"><title>${html(dateLabel(q.date,aggregation))}: mean ${q.average}${metric==='wellness'?'%':''}; median ${q.median}; n=${q.count}</title></circle>`).join('');
  } else {
    lines=series.map((p,i)=>{
      const active=!selectedPatient||selectedPatient===p.patient;
      const pts=p.series.map(q=>`${x(q.date)},${y(q.value)}`).join(' ');
      return `<polyline fill="none" stroke="${palette[i%palette.length]}" stroke-width="${active?3:1.2}" stroke-opacity="${active?0.95:0.18}" points="${pts}"><title>${html(p.label || p.patient)}</title></polyline>`;
    }).join('');
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">
    <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="#ffffff"/>
    ${grid}<line x1="${left}" x2="${left}" y1="${top}" y2="${height-bottom}" stroke="#9ca3af"/><line x1="${left}" x2="${width-right}" y1="${height-bottom}" y2="${height-bottom}" stroke="#9ca3af"/>
    ${lines}${labels}
    <text x="18" y="${top-12}" class="axis-title">${metric==='wellness'?'Wellness':'Symptom score'}</text>
  </svg>`;
}

function pageShell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>
  :root{--bg:#f3f4f6;--panel:#fff;--ink:#111827;--muted:#6b7280;--blue:#2563eb;--line:#e5e7eb;--danger:#b91c1c;--good:#047857}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif}header{background:#111827;color:#fff;padding:20px 30px;display:flex;justify-content:space-between;align-items:center}header h1{font-size:24px;margin:0}nav a{color:#bfdbfe;margin-left:18px;text-decoration:none;font-weight:600}main{max-width:1500px;margin:auto;padding:24px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}.toolbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;align-items:end}.field label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}select,input,button,.button{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#111827;font-size:14px}button,.button{background:var(--blue);color:white;border:none;font-weight:700;cursor:pointer;text-decoration:none;text-align:center;display:inline-block}.button.secondary{background:#374151}.button.danger,button.danger{background:var(--danger)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}.stat .label{font-size:12px;text-transform:uppercase;color:var(--muted);font-weight:700}.stat .value{font-size:27px;font-weight:800;margin-top:5px}.notice{border:2px solid #2563eb;background:#eff6ff;border-radius:12px;padding:18px;margin-bottom:20px}.code{font:800 28px Consolas,monospace;letter-spacing:.08em;margin:10px 0}.inline-form{display:inline}.inline-form button{width:auto;padding:7px 10px}.chart{width:100%;min-height:420px}.axis{font-size:12px;fill:#4b5563}.axis-title{font-size:13px;fill:#374151;font-weight:700}.patient-faint{fill:none;stroke:#64748b;stroke-width:1;stroke-opacity:.16}.cohort{fill:none;stroke:#1d4ed8;stroke-width:4}.median{fill:none;stroke:#7c3aed;stroke-width:2;stroke-dasharray:7 5}.legend{display:flex;gap:20px;flex-wrap:wrap;color:var(--muted);font-size:13px}.swatch{display:inline-block;width:24px;height:4px;margin-right:7px;vertical-align:middle}.table-wrap{overflow:auto;max-height:480px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#f8fafc;color:#475569}.flag{color:var(--danger);font-weight:700}.good{color:var(--good);font-weight:700}.muted{color:var(--muted)}.empty{padding:70px;text-align:center;color:var(--muted)}.patient-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:210px;overflow:auto;padding:8px;border:1px solid var(--line);border-radius:9px}.patient-list label{font-size:13px}.patient-list input{width:auto;margin-right:7px}.calendar-range{color:var(--muted);font-size:13px;margin:-4px 0 16px}.calendar-scroll{overflow-x:auto;padding-bottom:4px}.calendar-frame{min-width:560px;max-width:560px}.calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(66px,1fr));gap:8px}.calendar-weekdays{margin-bottom:8px}.calendar-weekday{text-align:center;color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.calendar-day{position:relative;aspect-ratio:1;min-height:66px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;display:grid;place-items:center;overflow:hidden}.calendar-day.no-entry{border-style:dashed;background:#f8fafc;color:#94a3b8}.calendar-day.full.symptom{background:#dc2626;border-color:#dc2626;color:#fff}.calendar-day.full.wellness{background:#059669;border-color:#059669;color:#fff}.calendar-date{position:absolute;top:7px;left:8px;z-index:2;font-size:11px;font-weight:800}.calendar-dot{display:block;border-radius:50%}.calendar-day.symptom .calendar-dot{background:#dc2626}.calendar-day.wellness .calendar-dot{background:#059669}.calendar-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;color:var(--muted);font-size:12px;margin-top:16px}.calendar-legend span{display:flex;align-items:center;gap:7px}.calendar-key{display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;position:relative}.calendar-key.dot::after{content:"";display:block;border-radius:50%}.calendar-key.dot.symptom::after{background:#dc2626}.calendar-key.dot.wellness::after{background:#059669}.calendar-key.dot.small::after{width:10px;height:10px}.calendar-key.dot.medium::after{width:17px;height:17px}.calendar-key.full.symptom{background:#dc2626;border-color:#dc2626}.calendar-key.full.wellness{background:#059669;border-color:#059669}.calendar-key.missing{border-style:dashed;background:#f8fafc}@media(max-width:700px){
    main{padding:12px}
    header{padding:14px 12px;display:block;text-align:center}
    header h1{font-size:20px;margin-bottom:12px}
    nav{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%}
    nav a{margin:0;padding:10px 8px;border:1px solid #334155;border-radius:8px;text-align:center;font-size:13px;line-height:1.2}
    .chart{min-height:300px}
    .toolbar{grid-template-columns:1fr}
    .panel{padding:14px}
    .calendar-scroll{overflow:visible}
    .calendar-frame{min-width:0}
    .calendar-weekdays,.calendar-grid{grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
    .calendar-weekdays{margin-bottom:4px}
    .calendar-day{min-height:0;border-radius:7px}
    .calendar-date{top:4px;left:5px;font-size:9px}
    .calendar-dot{transform:scale(.75)}
  }
  </style></head><body><header><h1>NeuroSol Clinician Portal</h1><nav><a href="/admin">Patient review</a><a href="/admin/population">Population analytics</a><a href="/admin/enrolments">Enrolments</a><a href="/admin/export.csv">CSV export</a></nav></header><main>${body}</main></body></html>`;
}

repairCsvIfNeeded();
app.use(express.json({limit:'256kb'}));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.get('/health',(req,res)=>res.json({ok:true,storage:'csv'}));

const enrolmentAttempts = new Map();
function limitEnrolmentAttempts(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  const attempts = (enrolmentAttempts.get(key) || []).filter(value => value > windowStart);
  enrolmentAttempts.set(key, attempts);
  if (attempts.length >= 10) {
    res.set('Retry-After', '900');
    res.set('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Too many enrolment attempts.' });
  }
  req.enrolmentAttemptKey = key;
  next();
}

function recordFailedEnrolment(req) {
  const key = req.enrolmentAttemptKey ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown';
  const attempts = enrolmentAttempts.get(key) || [];
  attempts.push(Date.now());
  enrolmentAttempts.set(key, attempts);
}

app.post('/api/enrol',limitEnrolmentAttempts,(req,res)=>{
  res.set('Cache-Control', 'no-store');
  const result = identityStore.redeemEnrolmentCode(req.body?.code, {
    expectedPatientId: req.body?.expectedPatientId,
  });
  if (result.status === 'ok') {
    return res.status(200).json({
      patientId: result.patientId,
      displayName: result.displayName,
      supportId: result.supportId,
      accessToken: result.accessToken,
    });
  }
  recordFailedEnrolment(req);
  if (result.status === 'patient_mismatch') {
    return res.status(409).json({
      error: 'The enrolment code belongs to a different clinic record.',
      code: 'enrolment_patient_mismatch',
    });
  }
  if (result.status === 'expired' || result.status === 'used') {
    return res.status(410).json({
      error: 'The enrolment code has expired or has already been used.',
      code: 'enrolment_code_unavailable',
    });
  }
  return res.status(404).json({
    error: 'The enrolment code is invalid.',
    code: 'enrolment_code_invalid',
  });
});

app.post('/api/symptom-entry',requireDeviceIdentity,(req,res)=>{
  const b=req.body||{}, wellness=b.wellnessPercent??b.wellness_score??b.wellness??'';
  const submissionId=typeof b.submissionId==='string'?b.submissionId.trim():'';
  const patientId=typeof b.patientId==='string'?b.patientId.trim():'';
  const rawPatientName=b.patientName??b.fullName;
  const patientName=typeof rawPatientName==='string'?rawPatientName.trim():'';
  if (!validClinicalLabel(submissionId,160) ||
      !validClinicalLabel(patientId,120) ||
      !validClinicalLabel(patientName) ||
      !utcDateFromIso(b.date) || !looksLikeTime(b.time) ||
      !validSubmittedWellness(wellness)) {
    return res.status(400).json({error:'Invalid or incomplete submission.'});
  }
  if (req.deviceIdentity.patientId !== patientId) {
    return res.status(403).json({
      error: 'The submitted PatientId does not match this device enrolment.',
      code: 'patient_identity_mismatch',
    });
  }
  const rawRecords=Array.isArray(b.records)&&b.records.length?b.records:[
    {track:'Primary',disorder:b.disorder,symptom:b.symptom1,score:b.score1},
    {track:'Primary',disorder:b.disorder,symptom:b.symptom2,score:b.score2},
    {track:'Primary',disorder:b.disorder,symptom:b.symptom3,score:b.score3}
  ];
  const records=rawRecords.map(record=>({
    track:typeof record?.track==='string'?record.track.trim():'',
    disorder:typeof record?.disorder==='string'?record.disorder.trim():'',
    symptom:typeof record?.symptom==='string'?record.symptom.trim():'',
    score:record?.score,
  }));
  if (![3,6].includes(records.length) || records.some(r =>
    !['Primary','Second'].includes(r.track) ||
    !validClinicalLabel(r.disorder,120) ||
    !validClinicalLabel(r.symptom,120) ||
    !validSubmittedScore(r.score)
  )) {
    return res.status(400).json({error:'Exactly three valid symptom scores per disorder are required.'});
  }
  const tracks=new Set(records.map(record=>record.track));
  if (!tracks.has('Primary') ||
      (records.length===3 && tracks.size!==1) ||
      (records.length===6 && (tracks.size!==2 || !tracks.has('Second')))) {
    return res.status(400).json({error:'Primary and second symptom tracks are invalid.'});
  }
  const disorderCounts=records.reduce((counts,r)=>{
    const key=`${r.track}|${r.disorder}`;
    counts[key]=(counts[key]||0)+1;
    return counts;
  },{});
  if (Object.values(disorderCounts).some(count=>count!==3) || Object.keys(disorderCounts).length!==records.length/3) {
    return res.status(400).json({error:'Each tracked disorder must contain exactly three symptom scores.'});
  }
  const duplicateSymptoms=records.some((record,index)=>records.some((other,otherIndex)=>
    otherIndex<index &&
    other.track===record.track &&
    other.disorder===record.disorder &&
    other.symptom===record.symptom
  ));
  if (duplicateSymptoms) {
    return res.status(400).json({error:'Each tracked symptom must be unique.'});
  }
  const existingRows=readRows();
  const submissionRows=existingRows.filter(row=>row.SubmissionId===submissionId);
  if (submissionRows.length) {
    const exactRetry=submissionRows.every(row=>
      patientKey(row)===patientId && row.Date===b.date
    );
    if (exactRetry) {
      return res.status(200).json({ok:true,duplicate:true,submissionId});
    }
    return res.status(409).json({
      error:'The submission identifier is already associated with another entry.',
      code:'submission_id_conflict',
    });
  }
  const dailySubmission=existingRows.find(row=>
    patientKey(row)===patientId && row.Date===b.date
  );
  if (dailySubmission) {
    return res.status(409).json({
      error:'A check-in has already been accepted for this patient and date.',
      code:'daily_submission_exists',
      date:b.date,
      existingSubmissionId:dailySubmission.SubmissionId||undefined,
    });
  }
  const receivedAt=new Date().toISOString();
  const lines=records.map(r=>[receivedAt,b.date,b.time,patientName,r.track,r.disorder,r.symptom,r.score,wellness,submissionId,patientId].map(escapeCsv).join(',')+'\n');
  fs.appendFileSync(csvPath,lines.join(''),'utf8');
  identityStore.updatePatientDisplayName(patientId, patientName);
  res.status(201).json({ok:true,duplicate:false,submissionId,rows:lines.length});
});

function enrolmentPatients(rows) {
  const directory = patientDirectory(rows);
  const store = identityStore.snapshot();
  const patientIds = new Set(Object.keys(store.patients));
  for (const patientId of directory.keys()) {
    if (!patientId.startsWith('legacy:')) patientIds.add(patientId);
  }
  return [...patientIds].map(patientId => {
    const fromData = directory.get(patientId);
    const fromStore = store.patients[patientId];
    const activeDevices = Object.values(store.devices).filter(
      device => device.patientId === patientId && !device.revokedAt,
    ).length;
    return {
      patientId,
      displayName: fromData?.displayName || fromStore?.displayName || 'Unnamed patient',
      supportId: supportId(patientId),
      activeDevices,
    };
  }).sort((a,b)=>a.displayName.localeCompare(b.displayName));
}

function enrolmentPage({ issued = null, error = '' } = {}) {
  const patients = enrolmentPatients(readRows());
  const csrfToken = adminCsrfToken();
  const notice = issued ? `<div class="notice">
    <strong>One-time enrolment code for ${html(issued.displayName)}</strong>
    <div class="code">${html(issued.code)}</div>
    <div>Support ID: ${html(issued.supportId)} · Expires: ${html(new Date(issued.expiresAt).toLocaleString('en-AU'))}</div>
    <p><strong>Copy this code now.</strong> It is not stored in readable form and cannot be shown again.</p>
  </div>` : '';
  const errorNotice = error ? `<div class="notice" style="border-color:#b91c1c;background:#fef2f2"><strong>${html(error)}</strong></div>` : '';
  const patientRows = patients.map(patient => `<tr>
    <td>${html(patient.displayName)}</td>
    <td>${html(patient.supportId)}</td>
    <td>${patient.activeDevices}</td>
    <td>
      <form class="inline-form" method="post" action="/admin/enrolments/issue">
        <input type="hidden" name="csrfToken" value="${csrfToken}">
        <input type="hidden" name="patientId" value="${html(patient.patientId)}">
        <input type="hidden" name="displayName" value="${html(patient.displayName)}">
        <button type="submit">New device code</button>
      </form>
      <form class="inline-form" method="post" action="/admin/enrolments/revoke" onsubmit="return confirm('Revoke every enrolled device for this patient?')">
        <input type="hidden" name="csrfToken" value="${csrfToken}">
        <input type="hidden" name="patientId" value="${html(patient.patientId)}">
        <button class="danger" type="submit">Revoke devices</button>
      </form>
    </td>
  </tr>`).join('');
  const body = `${notice}${errorNotice}
  <section class="panel"><h2>Issue a code for a new patient</h2>
    <p class="muted">Give the code only to the intended patient. Codes expire after seven days and work once.</p>
    <form class="toolbar" method="post" action="/admin/enrolments/issue" autocomplete="off">
      <input type="hidden" name="csrfToken" value="${csrfToken}">
      <div class="field"><label>Patient display name</label><input name="displayName" required maxlength="160"></div>
      <div class="field"><label>&nbsp;</label><button type="submit">Create enrolment code</button></div>
    </form>
  </section>
  <section class="panel"><h2>Existing clinic identities</h2>
    <p class="muted">Use “New device code” after a reinstall or phone change so the PatientId remains stable.</p>
    <div class="table-wrap"><table><thead><tr><th>Latest name</th><th>Support ID</th><th>Active devices</th><th>Actions</th></tr></thead>
    <tbody>${patientRows || '<tr><td colspan="4">No patient identities yet.</td></tr>'}</tbody></table></div>
  </section>`;
  return pageShell('Clinic enrolments', body);
}

app.get('/admin/export.csv',requireAdmin,(req,res)=>res.download(csvPath,'neurosol_symptom_entries.csv'));

app.get('/admin/enrolments',requireAdmin,(req,res)=>{
  res.send(enrolmentPage());
});

app.post('/admin/enrolments/issue',requireAdmin,requireAdminCsrf,(req,res)=>{
  try {
    const issued = identityStore.issueEnrolmentCode({
      patientId: String(req.body.patientId || '').trim(),
      displayName: String(req.body.displayName || '').trim(),
    });
    res.status(201).send(enrolmentPage({ issued }));
  } catch (error) {
    res.status(400).send(enrolmentPage({ error: error.message }));
  }
});

app.post('/admin/enrolments/revoke',requireAdmin,requireAdminCsrf,(req,res)=>{
  const patientId = String(req.body.patientId || '').trim();
  const revoked = identityStore.revokePatientDevices(patientId);
  res.send(enrolmentPage({
    error: revoked
      ? `${revoked} device enrolment(s) were revoked.`
      : 'No active devices were found for that patient.',
  }));
});

app.get('/admin/report.pdf',requireAdmin,(req,res)=>{
  const allRows=readRows();
  const requestedId=String(req.query.patientId||'').trim();
  const selectedId=requestedId
    ? resolvePatientKey(allRows,requestedId,req.query.patient)
    : req.query.patient
    ? resolvePatientKey(allRows,'',req.query.patient)
    : '';
  const directory=patientDirectory(allRows);
  const selectedPatient=directory.get(selectedId);
  const rows=allRows.filter(r=>
    (!selectedId||patientKey(r)===selectedId)&&
    (!req.query.disorder||r.Disorder===req.query.disorder)
  );
  const doc=new PDFDocument({margin:48});
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="neurosol-clinical-report.pdf"');doc.pipe(res);
  doc.fontSize(20).text('NeuroSol Clinical Report');doc.moveDown();
  doc.fontSize(11).text(`Patient: ${selectedPatient?.displayName||'Cohort'}`);
  if (selectedPatient) doc.text(`Support ID: ${selectedPatient.supportId}`);
  doc.text(`Disorder: ${req.query.disorder||'All'}`);doc.text(`Generated: ${new Date().toLocaleString('en-AU')}`);doc.moveDown();
  const dates=unique(rows,'Date');doc.text(`Date range: ${dates[0]||'-'} to ${dates[dates.length-1]||'-'}`);doc.text(`Submission rows: ${rows.length}`);doc.moveDown();
  unique(rows,'Symptom').forEach(sym=>{const vals=rows.filter(r=>r.Symptom===sym).map(r=>r.ScoreNumber);doc.text(`${sym}: mean ${round1(mean(vals))}/10, range ${Math.min(...vals)}–${Math.max(...vals)}`)});
  const wellness=[...new Map(rows.filter(r=>r.WellnessNumber>0).map(r=>[`${patientKey(r)}|${r.Date}`,r.WellnessNumber])).values()];doc.moveDown().text(`Average wellness: ${round1(mean(wellness))}%`);
  doc.end();
});

app.get('/admin',requireAdmin,(req,res)=>{
  const rows=readRows(), directory=patientDirectory(rows), disorders=unique(rows,'Disorder');
  const patients=[...directory.values()].sort((a,b)=>a.label.localeCompare(b.label));
  const patientId=resolvePatientKey(rows,req.query.patientId,req.query.patient);
  const selectedPatient=directory.get(patientId);
  const disorder=req.query.disorder||'';
  const aggregation=['daily','weekly','fortnightly','monthly'].includes(req.query.aggregation)?req.query.aggregation:'weekly';
  const calendarDays=[30,60,90].includes(Number(req.query.calendarDays))?Number(req.query.calendarDays):30;
  const requestedMetric=String(req.query.metric||'wellness');
  const metric=requestedMetric==='symptom'||requestedMetric==='wellness'||requestedMetric.startsWith('symptom:')?requestedMetric:'wellness';
  const filtered=rows.filter(r=>(!patientId||patientKey(r)===patientId)&&(!disorder||r.Disorder===disorder));
  const series=patientSeries(filtered,disorder,metric,aggregation,patientId?[patientId]:[],directory);
  const dates=unique(filtered,'Date'), symptoms=unique(filtered,'Symptom');
  const avgSym=round1(mean(filtered.map(r=>r.ScoreNumber)));
  const wellness=[...new Map(filtered.filter(r=>r.WellnessNumber>0).map(r=>[`${patientKey(r)}|${r.Date}`,r.WellnessNumber])).values()];
  const latest=[...filtered].sort((a,b)=>`${b.Date}${b.Time}`.localeCompare(`${a.Date}${a.Time}`)).slice(0,120);
  const options=(items,selected,all=false)=>(all?'<option value="">All</option>':'')+items.map(x=>`<option value="${html(x)}" ${x===selected?'selected':''}>${html(x)}</option>`).join('');
  const patientOptions=patients.map(patient=>`<option value="${html(patient.patientId)}" ${patient.patientId===patientId?'selected':''}>${html(patient.label)}</option>`).join('');
  const body=`<div class="cards"><div class="stat"><div class="label">Patient</div><div class="value" style="font-size:19px">${html(selectedPatient?.displayName||'-')}</div></div><div class="stat"><div class="label">Support ID</div><div class="value" style="font-size:19px">${html(selectedPatient?.supportId||'-')}</div></div><div class="stat"><div class="label">Reporting days</div><div class="value">${dates.length}</div></div><div class="stat"><div class="label">Average wellness</div><div class="value">${round1(mean(wellness))}%</div></div><div class="stat"><div class="label">Average symptom</div><div class="value">${avgSym}/10</div></div></div>
  <form class="panel toolbar"><div class="field"><label>Patient</label><select name="patientId">${patientOptions}</select></div><div class="field"><label>Disorder</label><select name="disorder">${options(disorders,disorder,true)}</select></div><div class="field"><label>Metric</label><select name="metric"><option value="wellness" ${metric==='wellness'?'selected':''}>Wellness</option><option value="symptom" ${metric==='symptom'?'selected':''}>Average symptom score</option>${symptoms.map(sym=>`<option value="symptom:${html(sym)}" ${metric===`symptom:${sym}`?'selected':''}>${html(sym)}</option>`).join('')}</select></div><div class="field"><label>Aggregation</label><select name="aggregation">${['daily','weekly','fortnightly','monthly'].map(x=>`<option value="${x}" ${x===aggregation?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="field"><label>Calendar range</label><select name="calendarDays">${[30,60,90].map(days=>`<option value="${days}" ${days===calendarDays?'selected':''}>Last ${days} days</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><button>Update view</button></div></form>
  <section class="panel"><h2>${metric==='wellness'?'Wellness trend':metric.startsWith('symptom:')?`${html(metric.slice('symptom:'.length))} trend`:'Average symptom trend'}</h2><p class="muted">Weekly aggregation is the default to reduce day-to-day noise. Y-axis is fixed for direct clinical comparison.</p>${svgChart(series,metric,aggregation,'overlay',patientId)}<div class="legend"><span><i class="swatch" style="background:#2563eb"></i>Selected patient</span></div></section>
  <section class="panel"><h2>${html(metricLabel(metric))} daily calendar</h2><p class="muted">Each box is one day. Marker size reflects the recorded value; hover over a day for the exact score.</p>${renderMetricCalendar(filtered,metric,calendarDays)}</section>
  <section class="panel"><div style="display:flex;justify-content:space-between;align-items:center"><div><h2>Clinical record</h2><p class="muted">${html(symptoms.join(', '))}</p></div><a class="button" style="width:auto" target="_blank" href="/admin/report.pdf?patientId=${encodeURIComponent(patientId)}&disorder=${encodeURIComponent(disorder)}">Generate PDF</a></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Track</th><th>Disorder</th><th>Symptom</th><th>Score</th><th>Wellness</th></tr></thead><tbody>${latest.map(r=>`<tr><td>${html(r.Date)}</td><td>${html(r.Time)}</td><td>${html(r.Track)}</td><td>${html(r.Disorder)}</td><td>${html(r.Symptom)}</td><td>${r.ScoreNumber}</td><td>${r.WellnessNumber}%</td></tr>`).join('')}</tbody></table></div></section>`;
  res.send(pageShell('Patient review',body));
});

app.get('/admin/population',requireAdmin,(req,res)=>{
  const rows=readRows(), directory=patientDirectory(rows), disorders=unique(rows,'Disorder');
  const disorder=req.query.disorder||disorders[0]||'', metric=req.query.metric==='symptom'?'symptom':'wellness';
  const aggregation=['daily','weekly','fortnightly','monthly'].includes(req.query.aggregation)?req.query.aggregation:'weekly';
  const allPatients=[...new Set(rows.filter(r=>r.Disorder===disorder).map(patientKey).filter(Boolean))]
    .sort((a,b)=>(directory.get(a)?.label||a).localeCompare(directory.get(b)?.label||b));
  const selected=String(req.query.patients||'').split('|').filter(x=>allPatients.includes(x)).slice(0,10);
  const cohort=patientSeries(rows,disorder,metric,aggregation,[],directory);
  const overlayPatients=selected.length?selected:allPatients.slice(0,10);
  const overlay=patientSeries(rows,disorder,metric,aggregation,overlayPatients,directory);
  const summary=cohortSeries(cohort,metric), latest=summary[summary.length-1]||{average:0,median:0,count:0};
  const statuses=cohort.map(p=>({patient:p.patient,label:p.label||p.patient,status:classifyPatientTrend(p,metric),latest:p.series[p.series.length-1]?.value||0}));
  const improving=statuses.filter(x=>x.status==='Improving').length, deteriorating=statuses.filter(x=>x.status==='Deteriorating').length;
  const deviations=statuses.map(s=>({ ...s, deviation:round1(s.latest-latest.average) })).sort((a,b)=>Math.abs(b.deviation)-Math.abs(a.deviation));
  const threshold=metric==='wellness'?20:2;
  const flagged=deviations.filter(x=>Math.abs(x.deviation)>=threshold);
  const options=disorders.map(x=>`<option ${x===disorder?'selected':''}>${html(x)}</option>`).join('');
  const patientChecks=allPatients.map(patientId=>`<label><input type="checkbox" name="patient" value="${html(patientId)}" ${overlayPatients.includes(patientId)?'checked':''}>${html(directory.get(patientId)?.label||patientId)}</label>`).join('');
  const body=`<div class="cards"><div class="stat"><div class="label">Disorder</div><div class="value" style="font-size:20px">${html(disorder)}</div></div><div class="stat"><div class="label">Patients</div><div class="value">${cohort.length}</div></div><div class="stat"><div class="label">Latest cohort mean</div><div class="value">${latest.average}${metric==='wellness'?'%':'/10'}</div></div><div class="stat"><div class="label">Improving</div><div class="value good">${improving}</div></div><div class="stat"><div class="label">Deteriorating</div><div class="value flag">${deteriorating}</div></div><div class="stat"><div class="label">Cohort outliers</div><div class="value">${flagged.length}</div></div></div>
  <form class="panel toolbar" id="filters"><div class="field"><label>Disorder</label><select name="disorder">${options}</select></div><div class="field"><label>Metric</label><select name="metric"><option value="wellness" ${metric==='wellness'?'selected':''}>Wellness</option><option value="symptom" ${metric==='symptom'?'selected':''}>Average symptom score</option></select></div><div class="field"><label>Aggregation</label><select name="aggregation">${['daily','weekly','fortnightly','monthly'].map(x=>`<option value="${x}" ${x===aggregation?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><button type="button" onclick="applyFilters()">Update view</button></div></form>
  <section class="panel"><h2>Cohort summary</h2><p class="muted">Faint grey lines are individual patients. Blue is the cohort mean, purple dashed is the median, and the shaded band is ±1 standard deviation.</p>${svgChart(cohort,metric,aggregation,'summary')}<div class="legend"><span><i class="swatch" style="background:#1d4ed8"></i>Cohort mean</span><span><i class="swatch" style="background:#7c3aed"></i>Median</span><span><i class="swatch" style="background:#93c5fd;height:12px"></i>±1 SD</span></div></section>
  <section class="panel"><h2>Patient overlay</h2><p class="muted">Select up to 10 patients for a legible comparison. The first 10 are shown by default.</p><div class="patient-list" id="patientList">${patientChecks}</div><div style="display:flex;gap:8px;margin:10px 0 16px"><button style="width:auto" onclick="selectFirstTen()">First 10</button><button class="button secondary" style="width:auto" onclick="clearPatients()">Clear</button></div>${svgChart(overlay,metric,aggregation,'overlay')}</section>
  <section class="panel"><h2>Outliers and response status</h2><p class="muted">Outliers compare each patient's latest aggregated value with the latest cohort mean. Threshold: ${threshold}${metric==='wellness'?' percentage points':' score points'}.</p><div class="table-wrap"><table><thead><tr><th>Patient</th><th>Status</th><th>Latest</th><th>Deviation</th><th>Flag</th></tr></thead><tbody>${deviations.map(x=>`<tr><td>${html(x.label)}</td><td class="${x.status==='Improving'?'good':x.status==='Deteriorating'?'flag':''}">${x.status}</td><td>${x.latest}${metric==='wellness'?'%':'/10'}</td><td>${x.deviation>0?'+':''}${x.deviation}</td><td class="${Math.abs(x.deviation)>=threshold?'flag':''}">${Math.abs(x.deviation)>=threshold?'Cohort outlier':'Within range'}</td></tr>`).join('')}</tbody></table></div></section>
  <script>function applyFilters(){const f=document.getElementById('filters');const q=new URLSearchParams(new FormData(f));const checked=[...document.querySelectorAll('#patientList input:checked')].slice(0,10).map(x=>x.value);if(checked.length)q.set('patients',checked.join('|'));location.href='/admin/population?'+q.toString()}function clearPatients(){document.querySelectorAll('#patientList input').forEach(x=>x.checked=false)}function selectFirstTen(){[...document.querySelectorAll('#patientList input')].forEach((x,i)=>x.checked=i<10)}</script>`;
  res.send(pageShell('Population analytics',body));
});

if (require.main === module) {
  const server = app.listen(port,host,()=>console.log(`NeuroSol listening on http://${host}:${port}`));

  const shutdown = signal => {
    console.log(`${signal} received. Shutting down NeuroSol...`);
    server.close(error => {
      if (error) {
        console.error('Error while shutting down:',error);
        process.exitCode=1;
      }
    });
  };

  process.on('SIGINT',()=>shutdown('SIGINT'));
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
}

module.exports = {
  app,
  csvPath,
  identityStore,
  patientDirectory,
  patientSeries,
  buildCalendarDays,
  renderMetricCalendar,
  todayIso,
};
