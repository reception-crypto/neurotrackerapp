const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createPortalUserStore,
  drPascoePermissions,
} = require('../portal_users');

test('portal users are stored with hashed passwords and selected permissions', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-users-'));
  try {
    const store = createPortalUserStore({ dataDir });
    const saved = store.save({
      username: 'Dr Pascoe',
      password: 'temporary-clinical-password',
      permissions: drPascoePermissions,
    });
    assert.deepEqual(saved.permissions, drPascoePermissions);
    assert.equal(
      store.authenticate('dr pascoe', 'temporary-clinical-password').username,
      'Dr Pascoe',
    );
    assert.equal(store.authenticate('Dr Pascoe', 'wrong-password'), null);

    const raw = fs.readFileSync(store.userPath, 'utf8');
    assert.doesNotMatch(raw, /temporary-clinical-password/);
    assert.match(raw, /passwordHash/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('accounts can be disabled, updated, and removed', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-users-'));
  try {
    const store = createPortalUserStore({ dataDir });
    store.save({
      username: 'Reception',
      password: 'reception-password-123',
      permissions: ['enrolments'],
    });
    store.save({
      username: 'Reception',
      password: '',
      permissions: ['enrolments', 'patient_review'],
      active: false,
    });
    assert.equal(store.authenticate('Reception', 'reception-password-123'), null);
    assert.deepEqual(store.get('Reception').permissions, [
      'enrolments',
      'patient_review',
    ]);
    assert.equal(store.remove('Reception'), true);
    assert.equal(store.get('Reception'), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('protected admin username cannot be stored', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-users-'));
  try {
    const store = createPortalUserStore({ dataDir });
    assert.throws(() => store.save({
      username: 'admin',
      password: 'not-the-real-admin-password',
      permissions: [],
    }), /protected admin/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
