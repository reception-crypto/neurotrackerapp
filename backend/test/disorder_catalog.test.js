'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  catalogVersion,
  createDisorderCatalogStore,
  disorderNameKey,
  normaliseDisorderName,
  normaliseSymptomName,
  symptomDefinitions,
  symptomNameKey,
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
    const historicalAura = catalog.findGlobalSymptom({
      displayName: 'Visual aura',
    });
    assert.equal(historicalAura.id, 'visual-aura');
    assert.equal(historicalAura.displayName, 'Visual aura');
    assert.equal(historicalAura.active, false);
    assert.equal(
      new Set(symptomDefinitions.map(item => item.id)).size,
      symptomDefinitions.length,
    );
  });
});

test('catalogue version 1 upgrades additively before editable symptoms are used', () => {
  withCatalog(({ catalog, dataDir }) => {
    const catalogPath = path.join(dataDir, 'disorder_catalog.json');
    fs.writeFileSync(
      catalogPath,
      `${JSON.stringify({
        version: 1,
        customDisorders: {
          'custom-10000000-0000-4000-8000-000000000001': {
            id: 'custom-10000000-0000-4000-8000-000000000001',
            displayName: 'Multiple sclerosis',
            nameKey: disorderNameKey('Multiple sclerosis'),
            kind: 'custom',
            active: true,
            minimumAppBuild: 8,
            allowedSymptomIds: symptomDefinitions.map(item => item.id),
          },
        },
        auditLog: [{ action: 'pre-existing-audit-event' }],
      }, null, 2)}\n`,
      'utf8',
    );

    const migrated = catalog.snapshot();
    assert.equal(migrated.version, catalogVersion);
    assert.deepEqual(migrated.customSymptoms, {});
    assert.deepEqual(migrated.builtInDisorderSymptomOverrides, {});
    assert.equal(Object.keys(migrated.customDisorders).length, 1);
    assert.equal(
      migrated.customDisorders['custom-10000000-0000-4000-8000-000000000001']
        .displayName,
      'Multiple sclerosis',
    );
    assert.equal(migrated.auditLog.length, 1);
    assert.equal(
      fs.readdirSync(dataDir)
        .filter(name => name.startsWith('disorder_catalog.json.backup-v1-'))
        .length,
      1,
    );
  });
});

test('custom symptoms use stable IDs, exact confirmation and explicit disorder availability', () => {
  withCatalog(({ catalog }) => {
    assert.throws(
      () => catalog.createCustomSymptom({
        displayName: 'Electric shock sensation',
        confirmation: 'Electric shock sensations',
      }),
      /must match exactly/,
    );
    assert.throws(
      () => catalog.createCustomSymptom({
        displayName: ' pain ',
        confirmation: 'pain',
      }),
      /already exists/,
    );

    const custom = catalog.createCustomSymptom({
      displayName: 'Electric shock sensation',
      confirmation: 'Electric shock sensation',
      actor: 'test-admin',
    });
    assert.match(custom.id, /^custom-symptom-[0-9a-f-]{36}$/);
    assert.equal(custom.minimumAppBuild, 8);

    const migraineBefore = catalog.findDisorder({ id: 'migraine' });
    assert.equal(migraineBefore.allowedSymptomIds.includes(custom.id), false);
    const updatedIds = [
      ...migraineBefore.allowedSymptomIds.filter(id => id !== 'vomiting'),
      custom.id,
    ];
    const migraineAfter = catalog.setDisorderSymptoms({
      disorderId: 'migraine',
      symptomIds: updatedIds,
      actor: 'test-admin',
    });
    assert.equal(migraineAfter.allowedSymptomIds.includes('vomiting'), false);
    assert.equal(migraineAfter.allowedSymptomIds.includes(custom.id), true);
    assert.equal(
      catalog.findSymptom(migraineAfter, { id: custom.id }).displayName,
      'Electric shock sensation',
    );

    const renamed = catalog.updateCustomSymptom({
      id: custom.id,
      displayName: 'Electric-shock sensation',
      confirmation: 'Electric-shock sensation',
      actor: 'test-admin',
    });
    assert.equal(renamed.id, custom.id);
    assert.equal(renamed.displayName, 'Electric-shock sensation');

    catalog.updateCustomSymptom({
      id: custom.id,
      active: false,
      actor: 'test-admin',
    });
    assert.equal(
      catalog.findDisorder({ id: 'migraine' }).allowedSymptomIds
        .includes(custom.id),
      false,
    );
    assert.equal(catalog.findGlobalSymptom({ id: custom.id }).id, custom.id);

    catalog.updateCustomSymptom({
      id: custom.id,
      active: true,
      actor: 'test-admin',
    });
    assert.equal(
      catalog.findDisorder({ id: 'migraine' }).allowedSymptomIds
        .includes(custom.id),
      true,
    );
    assert.deepEqual(
      catalog.snapshot().auditLog.map(event => event.action),
      [
        'custom_symptom_created',
        'disorder_symptoms_updated',
        'custom_symptom_updated',
        'custom_symptom_archived',
        'custom_symptom_reactivated',
      ],
    );
  });
});

test('symptom names are normalised for duplicate prevention', () => {
  assert.equal(normaliseSymptomName('  Limb   heaviness  '), 'Limb heaviness');
  assert.equal(
    symptomNameKey('Shock–like pain'),
    symptomNameKey('shock-like pain'),
  );
  assert.throws(
    () => normaliseSymptomName('<script>'),
    /unsupported punctuation/,
  );
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
