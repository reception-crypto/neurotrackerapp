'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDisorderCatalogStore,
  disorderNameKey,
  normaliseDisorderName,
  symptomDefinitions,
} = require('../disorder_catalog');

function withCatalog(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-catalog-'));
  let uuidCounter = 0;
  const catalog = createDisorderCatalogStore({
    dataDir,
    now: () => new Date('2026-08-04T00:00:00.000Z'),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
  });
  try {
    return run({ catalog, dataDir });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('built-in disorders and symptoms have stable canonical identifiers', () => {
  withCatalog(({ catalog }) => {
    const migraine = catalog.findDisorder({ displayName: 'Migraine' });
    assert.equal(migraine.id, 'migraine');
    assert.equal(migraine.minimumAppBuild, 7);
    assert.equal(
      catalog.findSymptom(migraine, { displayName: 'Headache' }).id,
      'headache',
    );
    assert.equal(
      catalog.findSymptom(migraine, { displayName: 'Vertigo' }).id,
      'vertigo',
    );
    assert.equal(
      catalog.findSymptom(migraine, { displayName: 'Dizziness' }).id,
      'dizziness',
    );
    assert.equal(
      catalog.findSymptom(migraine, { displayName: 'Visual aura' }),
      null,
    );
    assert.deepEqual(
      catalog.findGlobalSymptom({ displayName: 'Visual aura' }),
      { id: 'visual-aura', displayName: 'Visual aura' },
    );
    assert.equal(
      new Set(symptomDefinitions.map(item => item.id)).size,
      symptomDefinitions.length,
    );
  });
});

test('custom disorders require exact confirmation and use controlled symptoms', () => {
  withCatalog(({ catalog }) => {
    assert.throws(
      () => catalog.createCustomDisorder({
        displayName: 'Multiple sclerosis',
        confirmation: 'Multiple Sclerosis',
      }),
      /must match exactly/,
    );
    const created = catalog.createCustomDisorder({
      displayName: 'Multiple sclerosis',
      confirmation: 'Multiple sclerosis',
      actor: 'test-admin',
    });
    assert.match(created.id, /^custom-[0-9a-f-]{36}$/);
    assert.equal(created.minimumAppBuild, 8);
    assert.equal(created.allowedSymptoms.includes('Pain'), true);
    assert.equal(created.allowedSymptoms.includes('Dizziness'), true);
    assert.equal(created.allowedSymptoms.includes('Vertigo'), true);
    assert.equal(created.allowedSymptoms.includes('Visual aura'), false);
    assert.equal(created.allowedSymptoms.includes('Sweating changes'), false);
    assert.equal(created.allowedSymptoms.length, symptomDefinitions.length);
    assert.equal(created.allowedSymptomIds.includes('pain'), true);
  });
});

test('case, whitespace and dash variants cannot create duplicate disorders', () => {
  withCatalog(({ catalog }) => {
    catalog.createCustomDisorder({
      displayName: 'Functional neurological disorder',
      confirmation: 'Functional neurological disorder',
    });
    assert.throws(
      () => catalog.createCustomDisorder({
        displayName: '  FUNCTIONAL   NEUROLOGICAL DISORDER  ',
        confirmation: 'FUNCTIONAL NEUROLOGICAL DISORDER',
      }),
      /already exists/,
    );
    assert.throws(
      () => catalog.createCustomDisorder({
        displayName: 'migraine',
        confirmation: 'migraine',
      }),
      /already exists/,
    );
    assert.equal(
      disorderNameKey('Guillain–Barré syndrome'),
      disorderNameKey('Guillain-Barré syndrome'),
    );
  });
});

test('invalid free text is rejected before it reaches the catalogue', () => {
  assert.throws(
    () => normaliseDisorderName('<script>alert(1)</script>'),
    /unsupported punctuation/,
  );
  assert.throws(
    () => normaliseDisorderName('x'),
    /3 to 120/,
  );
  withCatalog(({ catalog }) => {
    assert.equal(
      catalog.findDisorder({ displayName: 'Not registered' }),
      null,
    );
  });
});

test('renaming and archiving preserve the identifier and create audit events', () => {
  withCatalog(({ catalog }) => {
    const created = catalog.createCustomDisorder({
      displayName: 'Hereditary spastic paraplegia',
      confirmation: 'Hereditary spastic paraplegia',
      actor: 'test-admin',
    });
    const renamed = catalog.updateCustomDisorder({
      id: created.id,
      displayName: 'Hereditary spastic paraplegia (HSP)',
      confirmation: 'Hereditary spastic paraplegia (HSP)',
      actor: 'test-admin',
    });
    assert.equal(renamed.id, created.id);
    assert.equal(renamed.displayName, 'Hereditary spastic paraplegia (HSP)');

    const archived = catalog.updateCustomDisorder({
      id: created.id,
      active: false,
      actor: 'test-admin',
    });
    assert.equal(archived.active, false);
    assert.equal(
      catalog.definitions().some(item => item.id === created.id),
      false,
    );
    assert.equal(
      catalog.definitions({ includeInactive: true })
        .some(item => item.id === created.id),
      true,
    );
    assert.equal(
      catalog.findDisorder({ id: created.id }).displayName,
      'Hereditary spastic paraplegia (HSP)',
    );
    assert.deepEqual(
      catalog.snapshot().auditLog.map(event => event.action),
      [
        'custom_disorder_created',
        'custom_disorder_updated',
        'custom_disorder_archived',
      ],
    );
  });
});

test('catalogue writes are atomic and corrupt files are not overwritten', () => {
  withCatalog(({ catalog, dataDir }) => {
    catalog.createCustomDisorder({
      displayName: 'Progressive supranuclear palsy',
      confirmation: 'Progressive supranuclear palsy',
    });
    const stored = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'disorder_catalog.json'), 'utf8'),
    );
    assert.equal(Object.keys(stored.customDisorders).length, 1);
    assert.equal(
      fs.readdirSync(dataDir).some(name => name.includes('.tmp-')),
      false,
    );

    fs.writeFileSync(
      path.join(dataDir, 'disorder_catalog.json'),
      '{"version":1,"customDisorders":{"broken":{}},"auditLog":[]}',
      'utf8',
    );
    assert.throws(() => catalog.snapshot(), /invalid record/);
    assert.match(
      fs.readFileSync(path.join(dataDir, 'disorder_catalog.json'), 'utf8'),
      /"broken"/,
    );
  });
});

test('stored custom definitions cannot introduce retired symptoms', () => {
  withCatalog(({ catalog, dataDir }) => {
    const created = catalog.createCustomDisorder({
      displayName: 'Posterior cortical atrophy',
      confirmation: 'Posterior cortical atrophy',
    });
    const catalogPath = path.join(dataDir, 'disorder_catalog.json');
    const stored = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    stored.customDisorders[created.id].allowedSymptomIds[0] =
      'sweating-changes';
    fs.writeFileSync(catalogPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    assert.throws(() => catalog.snapshot(), /invalid symptoms/);
    assert.match(fs.readFileSync(catalogPath, 'utf8'), /sweating-changes/);
  });
});
