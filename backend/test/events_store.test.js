const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEventsStore } = require('../events_store');

test('only clinic-assigned Events can be recorded; removal keeps history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurosol-events-'));
  try {
    const store = createEventsStore({ dataDir: dir, now: () => new Date('2026-09-29T01:00:00Z') });
    const infusion = store.saveDefinition({ label: 'Infusion', question: 'Infusion today?', type: 'daily' });
    const attack = store.saveDefinition({ label: 'Cluster headache attack', question: 'Record attack', type: 'timed' });
    const input = { eventId: infusion.id, occurredAt: '2026-09-29T00:00:00Z', localDate: '2026-09-29' };
    assert.throws(() => store.record('patient-a', input), /not assigned/);
    store.assign('patient-a', [infusion.id, attack.id]);
    store.record('patient-a', input);
    assert.throws(() => store.record('patient-a', input), /already been recorded/);
    store.record('patient-a', { ...input, eventId: attack.id });
    store.record('patient-a', { ...input, eventId: attack.id });
    assert.equal(store.entries('patient-a').length, 3);
    store.assign('patient-a', []);
    assert.deepEqual(store.assigned('patient-a'), []);
    assert.equal(store.entries('patient-a').length, 3);
    assert.throws(() => store.record('patient-a', { ...input, eventId: attack.id }), /not assigned/);
    assert.deepEqual(store.entries('patient-b'), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
