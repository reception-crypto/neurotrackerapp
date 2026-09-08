const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const schemaVersion = 1;

function normaliseName(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function validName(value) {
  return value.length >= 2 && value.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function emptyState() {
  return { schemaVersion, requests: {} };
}

function createProfileRequestStore({ dataDir }) {
  if (!dataDir) throw new Error('Profile request storage requires a data directory.');
  const requestPath = path.join(dataDir, 'profile_requests.json');

  function read() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(requestPath)) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    if (parsed?.schemaVersion !== schemaVersion || !parsed.requests ||
        typeof parsed.requests !== 'object' || Array.isArray(parsed.requests)) {
      throw new Error('The profile request file is invalid.');
    }
    return parsed;
  }

  function write(state) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temporaryPath = `${requestPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, requestPath);
    try { fs.chmodSync(requestPath, 0o600); } catch (_) { /* Windows ACLs apply. */ }
  }

  function listPending() {
    return Object.values(read().requests)
      .filter(item => item.status === 'pending')
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  }

  function create({ displayName }) {
    const name = normaliseName(displayName);
    if (!validName(name)) {
      throw new Error('Enter your full name using between 2 and 160 characters.');
    }
    const state = read();
    const duplicate = Object.values(state.requests).find(item =>
      item.status === 'pending' &&
      normaliseName(item.displayName).toLocaleLowerCase('en-AU') ===
        name.toLocaleLowerCase('en-AU')
    );
    if (duplicate) return { request: duplicate, created: false };
    const request = {
      id: `pr-${crypto.randomUUID()}`,
      displayName: name,
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };
    state.requests[request.id] = request;
    write(state);
    return { request, created: true };
  }

  function getPending(id) {
    const item = read().requests[String(id || '').trim()];
    return item?.status === 'pending' ? { ...item } : null;
  }

  function complete(id, patientId) {
    const state = read();
    const item = state.requests[String(id || '').trim()];
    if (!item || item.status !== 'pending') return false;
    item.status = 'completed';
    item.completedAt = new Date().toISOString();
    item.patientId = String(patientId || '').trim();
    write(state);
    return true;
  }

  function dismiss(id) {
    const state = read();
    const item = state.requests[String(id || '').trim()];
    if (!item || item.status !== 'pending') return false;
    item.status = 'dismissed';
    item.dismissedAt = new Date().toISOString();
    write(state);
    return true;
  }

  return { create, complete, dismiss, getPending, listPending, requestPath };
}

module.exports = { createProfileRequestStore, normaliseName };
