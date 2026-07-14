require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const basicAuth = require('basic-auth');
const PDFDocument = require('pdfkit');

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.API_KEY || 'change-this-mobile-upload-key';
const adminUser = process.env.ADMIN_USER || process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-admin-password';
const dataDir = path.join(__dirname, 'data');
const csvPath = path.join(dataDir, 'symptom_entries.csv');

const csvColumns = ['ReceivedAt','Date','Time','Patient','Track','Disorder','Symptom','Score','WellnessPercent'];

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

function validScore(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 10;
}

function validWellness(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function normalisedRecord(receivedAt, date, time, patient, track, disorder, symptom, score, wellness) {
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

    // Current server schema: ReceivedAt,Date,Time,Patient,Track,Disorder,Symptom,Score,WellnessPercent
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
  console.log(`NeuroTracker CSV normalised: ${rows.length} rows. Backup: ${backupPath}`);
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

function requireApiKey(req, res, next) {
  if (req.header('x-api-key') !== apiKey) return res.status(401).json({ error: 'Invalid or missing API key.' });
  next();
}

function requireAdmin(req, res, next) {
  const user = basicAuth(req);
  if (!user || user.name !== adminUser || user.pass !== adminPassword) {
    res.set('WWW-Authenticate', 'Basic realm="NeuroTracker Admin"');
    return res.status(401).send('Authentication required.');
  }
  next();
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
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

function patientSeries(rows, disorder, metric, aggregation='weekly', selectedPatients=[]) {
  const symptomMetric = metric.startsWith('symptom:') ? metric.slice('symptom:'.length) : '';
  const filtered = rows.filter(r =>
    (!disorder || r.Disorder === disorder) &&
    (!selectedPatients.length || selectedPatients.includes(r.Patient)) &&
    (!symptomMetric || r.Symptom === symptomMetric)
  );
  const byPatient = new Map();
  for (const r of filtered) {
    if (!r.Patient || !r.Date) continue;
    const patient = r.Patient;
    const key = periodKey(r.Date, aggregation);
    if (!byPatient.has(patient)) byPatient.set(patient, new Map());
    const period = byPatient.get(patient);
    if (!period.has(key)) period.set(key, { scores: [], wellness: [] });
    const bucket = period.get(key);
    if (Number.isFinite(r.ScoreNumber)) bucket.scores.push(r.ScoreNumber);
    if (r.WellnessNumber > 0) bucket.wellness.push(r.WellnessNumber);
  }
  return [...byPatient.entries()].map(([patient, periods]) => ({
    patient,
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
      return `<polyline class="patient-faint" points="${pts}"><title>${html(p.patient)}</title></polyline>`;
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
      return `<polyline fill="none" stroke="${palette[i%palette.length]}" stroke-width="${active?3:1.2}" stroke-opacity="${active?0.95:0.18}" points="${pts}"><title>${html(p.patient)}</title></polyline>`;
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
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif}header{background:#111827;color:#fff;padding:20px 30px;display:flex;justify-content:space-between;align-items:center}header h1{font-size:24px;margin:0}nav a{color:#bfdbfe;margin-left:18px;text-decoration:none;font-weight:600}main{max-width:1500px;margin:auto;padding:24px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}.toolbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;align-items:end}.field label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}select,input,button,.button{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#111827;font-size:14px}button,.button{background:var(--blue);color:white;border:none;font-weight:700;cursor:pointer;text-decoration:none;text-align:center;display:inline-block}.button.secondary{background:#374151}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}.stat .label{font-size:12px;text-transform:uppercase;color:var(--muted);font-weight:700}.stat .value{font-size:27px;font-weight:800;margin-top:5px}.chart{width:100%;min-height:420px}.axis{font-size:12px;fill:#4b5563}.axis-title{font-size:13px;fill:#374151;font-weight:700}.patient-faint{fill:none;stroke:#64748b;stroke-width:1;stroke-opacity:.16}.cohort{fill:none;stroke:#1d4ed8;stroke-width:4}.median{fill:none;stroke:#7c3aed;stroke-width:2;stroke-dasharray:7 5}.legend{display:flex;gap:20px;flex-wrap:wrap;color:var(--muted);font-size:13px}.swatch{display:inline-block;width:24px;height:4px;margin-right:7px;vertical-align:middle}.table-wrap{overflow:auto;max-height:480px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#f8fafc;color:#475569}.flag{color:var(--danger);font-weight:700}.good{color:var(--good);font-weight:700}.muted{color:var(--muted)}.empty{padding:70px;text-align:center;color:var(--muted)}.patient-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:210px;overflow:auto;padding:8px;border:1px solid var(--line);border-radius:9px}.patient-list label{font-size:13px}.patient-list input{width:auto;margin-right:7px}@media(max-width:700px){
    main{padding:12px}
    header{padding:14px 12px;display:block;text-align:center}
    header h1{font-size:20px;margin-bottom:12px}
    nav{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%}
    nav a{margin:0;padding:10px 8px;border:1px solid #334155;border-radius:8px;text-align:center;font-size:13px;line-height:1.2}
    nav a:last-child{grid-column:1 / -1}
    .chart{min-height:300px}
    .toolbar{grid-template-columns:1fr}
    .panel{padding:14px}
  }
  </style></head><body><header><h1>NeuroTracker Clinician Portal</h1><nav><a href="/admin">Patient review</a><a href="/admin/population">Population analytics</a><a href="/admin/export.csv">CSV export</a></nav></header><main>${body}</main></body></html>`;
}

repairCsvIfNeeded();
app.use(cors());
app.use(express.json({limit:'256kb'}));
app.use('/static', express.static(path.join(__dirname,'public')));

app.get('/health',(req,res)=>res.json({ok:true,storage:'csv'}));
app.post('/api/symptom-entry',requireApiKey,(req,res)=>{
  const b=req.body||{}, wellness=b.wellnessPercent??b.wellness_score??b.wellness??'';
  const records=Array.isArray(b.records)&&b.records.length?b.records:[
    {track:'Primary',disorder:b.disorder,symptom:b.symptom1,score:b.score1},
    {track:'Primary',disorder:b.disorder,symptom:b.symptom2,score:b.score2},
    {track:'Primary',disorder:b.disorder,symptom:b.symptom3,score:b.score3}
  ];
  const receivedAt=new Date().toISOString();
  const lines=records.filter(r=>r&&r.symptom).map(r=>[receivedAt,b.date,b.time,b.patientName||b.fullName,r.track||'Primary',r.disorder,r.symptom,r.score,wellness].map(escapeCsv).join(',')+'\n');
  fs.appendFileSync(csvPath,lines.join(''),'utf8');
  res.status(201).json({ok:true,rows:lines.length});
});

app.get('/admin/export.csv',requireAdmin,(req,res)=>res.download(csvPath,'neurotracker_symptom_entries.csv'));

app.get('/admin/report.pdf',requireAdmin,(req,res)=>{
  const rows=readRows().filter(r=>(!req.query.patient||r.Patient===req.query.patient)&&(!req.query.disorder||r.Disorder===req.query.disorder));
  const doc=new PDFDocument({margin:48});
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="neurotracker-report.pdf"');doc.pipe(res);
  doc.fontSize(20).text('NeuroTracker Clinical Report');doc.moveDown();
  doc.fontSize(11).text(`Patient: ${req.query.patient||'Cohort'}`);doc.text(`Disorder: ${req.query.disorder||'All'}`);doc.text(`Generated: ${new Date().toLocaleString('en-AU')}`);doc.moveDown();
  const dates=unique(rows,'Date');doc.text(`Date range: ${dates[0]||'-'} to ${dates[dates.length-1]||'-'}`);doc.text(`Submission rows: ${rows.length}`);doc.moveDown();
  unique(rows,'Symptom').forEach(sym=>{const vals=rows.filter(r=>r.Symptom===sym).map(r=>r.ScoreNumber);doc.text(`${sym}: mean ${round1(mean(vals))}/10, range ${Math.min(...vals)}–${Math.max(...vals)}`)});
  const wellness=[...new Map(rows.filter(r=>r.WellnessNumber>0).map(r=>[`${r.Patient}|${r.Date}`,r.WellnessNumber])).values()];doc.moveDown().text(`Average wellness: ${round1(mean(wellness))}%`);
  doc.end();
});

app.get('/admin',requireAdmin,(req,res)=>{
  const rows=readRows(), patients=unique(rows,'Patient'), disorders=unique(rows,'Disorder');
  const patient=req.query.patient||patients[0]||'', disorder=req.query.disorder||'';
  const aggregation=['daily','weekly','fortnightly','monthly'].includes(req.query.aggregation)?req.query.aggregation:'weekly';
  const requestedMetric=String(req.query.metric||'wellness');
  const metric=requestedMetric==='symptom'||requestedMetric==='wellness'||requestedMetric.startsWith('symptom:')?requestedMetric:'wellness';
  const filtered=rows.filter(r=>(!patient||r.Patient===patient)&&(!disorder||r.Disorder===disorder));
  const series=patientSeries(filtered,disorder,metric,aggregation,patient?[patient]:[]);
  const dates=unique(filtered,'Date'), symptoms=unique(filtered,'Symptom');
  const avgSym=round1(mean(filtered.map(r=>r.ScoreNumber)));
  const wellness=[...new Map(filtered.filter(r=>r.WellnessNumber>0).map(r=>[r.Date,r.WellnessNumber])).values()];
  const latest=filtered.sort((a,b)=>`${b.Date}${b.Time}`.localeCompare(`${a.Date}${a.Time}`)).slice(0,120);
  const options=(items,selected,all=false)=>(all?'<option value="">All</option>':'')+items.map(x=>`<option ${x===selected?'selected':''}>${html(x)}</option>`).join('');
  const body=`<div class="cards"><div class="stat"><div class="label">Patient</div><div class="value" style="font-size:19px">${html(patient||'-')}</div></div><div class="stat"><div class="label">Reporting days</div><div class="value">${dates.length}</div></div><div class="stat"><div class="label">Average wellness</div><div class="value">${round1(mean(wellness))}%</div></div><div class="stat"><div class="label">Average symptom</div><div class="value">${avgSym}/10</div></div></div>
  <form class="panel toolbar"><div class="field"><label>Patient</label><select name="patient">${options(patients,patient)}</select></div><div class="field"><label>Disorder</label><select name="disorder">${options(disorders,disorder,true)}</select></div><div class="field"><label>Metric</label><select name="metric"><option value="wellness" ${metric==='wellness'?'selected':''}>Wellness</option><option value="symptom" ${metric==='symptom'?'selected':''}>Average symptom score</option>${symptoms.map(sym=>`<option value="symptom:${html(sym)}" ${metric===`symptom:${sym}`?'selected':''}>${html(sym)}</option>`).join('')}</select></div><div class="field"><label>Aggregation</label><select name="aggregation">${['daily','weekly','fortnightly','monthly'].map(x=>`<option value="${x}" ${x===aggregation?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><button>Update view</button></div></form>
  <section class="panel"><h2>${metric==='wellness'?'Wellness trend':metric.startsWith('symptom:')?`${html(metric.slice('symptom:'.length))} trend`:'Average symptom trend'}</h2><p class="muted">Weekly aggregation is the default to reduce day-to-day noise. Y-axis is fixed for direct clinical comparison.</p>${svgChart(series,metric,aggregation,'overlay',patient)}<div class="legend"><span><i class="swatch" style="background:#2563eb"></i>Selected patient</span></div></section>
  <section class="panel"><div style="display:flex;justify-content:space-between;align-items:center"><div><h2>Clinical record</h2><p class="muted">${html(symptoms.join(', '))}</p></div><a class="button" style="width:auto" target="_blank" href="/admin/report.pdf?patient=${encodeURIComponent(patient)}&disorder=${encodeURIComponent(disorder)}">Generate PDF</a></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Track</th><th>Disorder</th><th>Symptom</th><th>Score</th><th>Wellness</th></tr></thead><tbody>${latest.map(r=>`<tr><td>${html(r.Date)}</td><td>${html(r.Time)}</td><td>${html(r.Track)}</td><td>${html(r.Disorder)}</td><td>${html(r.Symptom)}</td><td>${r.ScoreNumber}</td><td>${r.WellnessNumber}%</td></tr>`).join('')}</tbody></table></div></section>`;
  res.send(pageShell('Patient review',body));
});

app.get('/admin/population',requireAdmin,(req,res)=>{
  const rows=readRows(), disorders=unique(rows,'Disorder');
  const disorder=req.query.disorder||disorders[0]||'', metric=req.query.metric==='symptom'?'symptom':'wellness';
  const aggregation=['daily','weekly','fortnightly','monthly'].includes(req.query.aggregation)?req.query.aggregation:'weekly';
  const allPatients=unique(rows.filter(r=>r.Disorder===disorder),'Patient');
  const selected=(req.query.patients||'').split('|').filter(x=>allPatients.includes(x));
  const cohort=patientSeries(rows,disorder,metric,aggregation,[]);
  const overlayPatients=selected.length?selected:allPatients.slice(0,10);
  const overlay=patientSeries(rows,disorder,metric,aggregation,overlayPatients);
  const summary=cohortSeries(cohort,metric), latest=summary[summary.length-1]||{average:0,median:0,count:0};
  const statuses=cohort.map(p=>({patient:p.patient,status:classifyPatientTrend(p,metric),latest:p.series[p.series.length-1]?.value||0}));
  const improving=statuses.filter(x=>x.status==='Improving').length, deteriorating=statuses.filter(x=>x.status==='Deteriorating').length;
  const deviations=statuses.map(s=>({ ...s, deviation:round1(s.latest-latest.average) })).sort((a,b)=>Math.abs(b.deviation)-Math.abs(a.deviation));
  const threshold=metric==='wellness'?20:2;
  const flagged=deviations.filter(x=>Math.abs(x.deviation)>=threshold);
  const options=disorders.map(x=>`<option ${x===disorder?'selected':''}>${html(x)}</option>`).join('');
  const patientChecks=allPatients.map(p=>`<label><input type="checkbox" name="patient" value="${html(p)}" ${overlayPatients.includes(p)?'checked':''}>${html(p)}</label>`).join('');
  const body=`<div class="cards"><div class="stat"><div class="label">Disorder</div><div class="value" style="font-size:20px">${html(disorder)}</div></div><div class="stat"><div class="label">Patients</div><div class="value">${cohort.length}</div></div><div class="stat"><div class="label">Latest cohort mean</div><div class="value">${latest.average}${metric==='wellness'?'%':'/10'}</div></div><div class="stat"><div class="label">Improving</div><div class="value good">${improving}</div></div><div class="stat"><div class="label">Deteriorating</div><div class="value flag">${deteriorating}</div></div><div class="stat"><div class="label">Cohort outliers</div><div class="value">${flagged.length}</div></div></div>
  <form class="panel toolbar" id="filters"><div class="field"><label>Disorder</label><select name="disorder">${options}</select></div><div class="field"><label>Metric</label><select name="metric"><option value="wellness" ${metric==='wellness'?'selected':''}>Wellness</option><option value="symptom" ${metric==='symptom'?'selected':''}>Average symptom score</option></select></div><div class="field"><label>Aggregation</label><select name="aggregation">${['daily','weekly','fortnightly','monthly'].map(x=>`<option value="${x}" ${x===aggregation?'selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><button type="button" onclick="applyFilters()">Update view</button></div></form>
  <section class="panel"><h2>Cohort summary</h2><p class="muted">Faint grey lines are individual patients. Blue is the cohort mean, purple dashed is the median, and the shaded band is ±1 standard deviation.</p>${svgChart(cohort,metric,aggregation,'summary')}<div class="legend"><span><i class="swatch" style="background:#1d4ed8"></i>Cohort mean</span><span><i class="swatch" style="background:#7c3aed"></i>Median</span><span><i class="swatch" style="background:#93c5fd;height:12px"></i>±1 SD</span></div></section>
  <section class="panel"><h2>Patient overlay</h2><p class="muted">Select up to 10 patients for a legible comparison. The first 10 are shown by default.</p><div class="patient-list" id="patientList">${patientChecks}</div><div style="display:flex;gap:8px;margin:10px 0 16px"><button style="width:auto" onclick="selectFirstTen()">First 10</button><button class="button secondary" style="width:auto" onclick="clearPatients()">Clear</button></div>${svgChart(overlay,metric,aggregation,'overlay')}</section>
  <section class="panel"><h2>Outliers and response status</h2><p class="muted">Outliers compare each patient's latest aggregated value with the latest cohort mean. Threshold: ${threshold}${metric==='wellness'?' percentage points':' score points'}.</p><div class="table-wrap"><table><thead><tr><th>Patient</th><th>Status</th><th>Latest</th><th>Deviation</th><th>Flag</th></tr></thead><tbody>${deviations.map(x=>`<tr><td>${html(x.patient)}</td><td class="${x.status==='Improving'?'good':x.status==='Deteriorating'?'flag':''}">${x.status}</td><td>${x.latest}${metric==='wellness'?'%':'/10'}</td><td>${x.deviation>0?'+':''}${x.deviation}</td><td class="${Math.abs(x.deviation)>=threshold?'flag':''}">${Math.abs(x.deviation)>=threshold?'Cohort outlier':'Within range'}</td></tr>`).join('')}</tbody></table></div></section>
  <script>function applyFilters(){const f=document.getElementById('filters');const q=new URLSearchParams(new FormData(f));const checked=[...document.querySelectorAll('#patientList input:checked')].slice(0,10).map(x=>x.value);if(checked.length)q.set('patients',checked.join('|'));location.href='/admin/population?'+q.toString()}function clearPatients(){document.querySelectorAll('#patientList input').forEach(x=>x.checked=false)}function selectFirstTen(){[...document.querySelectorAll('#patientList input')].forEach((x,i)=>x.checked=i<10)}</script>`;
  res.send(pageShell('Population analytics',body));
});

app.listen(port,'0.0.0.0',()=>console.log(`NeuroTracker backend running at http://localhost:${port}`));
