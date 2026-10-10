const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert.ok(!/localStorage|fetch\(|XMLHttpRequest/.test(script));
assert.ok(fs.readFileSync(path.join(__dirname, 'review-store.js'), 'utf8').includes("'yf-tracker-v2'"));

const nodes = new Map();
const listeners = new Map();
function nodeFor(id) {
    if (!nodes.has(id)) {
        nodes.set(id, {
            value: '', textContent: '', innerHTML: '', hidden: false, open: false, style: {},
            classList: { remove() { }, add() { } }, setAttribute() { }, addEventListener() { },
            showModal() { this.open = true; }, close() { this.open = false; }
        });
    }
    return nodes.get(id);
}
const context = vm.createContext({
    document: { getElementById: nodeFor, querySelector() { return null; }, addEventListener(type, listener) { listeners.set(type, listener); } },
    window: { scrollTo() { }, addEventListener() { } },
    setTimeout() { return 1; }, clearTimeout() { }, setInterval() { return 1; }, clearInterval() { }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'review-store.js'), 'utf8'), context);
vm.runInContext(script, context);
// Production starts without demo data; these checks exercise the demo catalog explicitly.
vm.runInContext('state.demo = true', context);
const api = vm.runInContext('({state, configuration, selectedEquipment, draftFor, workoutEntries, historyFor, referenceFor, elsewhereFor, pruneIdleDraftDates, loadConfirmed, formatSets, finish, finishSample, loadOptionHTML, closeSheet, completeSet, timer, stopTimer, guidanceFor, knownExercise, legacyWorkout, hasAnyDraftEntries, importBackup, reviewDraft})', context);
const backup = require('./review-store.js');
const catalogBefore = vm.runInContext('JSON.stringify(equipmentCatalog)', context);
const json = value => JSON.parse(JSON.stringify(value));
const checks = [];

function reset(session = 'upper-a', venue = 'ttl') {
    api.state.session = session;
    api.state.venue = venue;
    api.state.drafts.clear();
    api.state.draftItems.clear();
    api.state.draftDates.clear();
    api.state.equipment.clear();
    api.state.custom.clear();
    api.state.customExercises.clear(); api.state.pairs.clear(); api.state.substitutions.clear(); api.state.skipped.clear(); api.state.mappings.clear(); api.state.notes.clear(); api.state.archive = null;
    api.state.history.clear();
    api.state.workouts = [];
    api.state.sampleSessions = 0;
    api.stopTimer();
}
function itemFor(key) {
    return api.configuration().find(item => item.key === key);
}
function entered(weight, reps, rir = '', done = false) {
    return { weight: String(weight), reps: String(reps), rir: String(rir), done };
}
function putSet(item, index, entry, equipment = api.selectedEquipment(item)) {
    Object.assign(api.draftFor(item, equipment)[index], entry);
}
function check(name, run) {
    reset();
    run();
    assert.equal(vm.runInContext('JSON.stringify(equipmentCatalog)', context), catalogBefore);
    checks.push(name);
}

check('Save valid unticked rows with checked rows', () => {
    const item = itemFor('pulldown');
    putSet(item, 0, entered(70, 9, 1, true));
    putSet(item, 1, entered(70, 8, 2));
    api.finishSample();
    assert.deepEqual(json(api.state.workouts[0].exercises[0].sets), [
        { weight: 70, reps: 9, rir: 1 }, { weight: 70, reps: 8, rir: 2 }
    ]);
});

check('Incomplete rows prevent saving without clearing any draft', () => {
    const item = itemFor('pulldown');
    putSet(item, 0, entered(70, 9, 1, true));
    putSet(item, 1, entered(72, ''));
    const before = JSON.stringify([...api.state.drafts]);
    api.finishSample();
    assert.equal(api.state.workouts.length, 0);
    assert.equal(JSON.stringify([...api.state.drafts]), before);
    assert.equal(nodeFor('sheet-title').textContent, 'Review incomplete sets');
});

check('Finish includes sets from alternate equipment and clears only saved drafts', () => {
    const item = itemFor('pulldown');
    const original = api.selectedEquipment(item);
    putSet(item, 0, entered(70, 9, 1), original);
    const alternate = { ...original, id: 'test-stack', name: 'Other stack', previous: null, exerciseKey: item.key };
    api.state.custom.set(alternate.id, alternate);
    api.state.equipment.set('ttl|' + item.key, alternate.id);
    putSet(item, 0, entered(60, 10, 2), alternate);
    api.finishSample();
    assert.equal(api.state.workouts[0].exercises.length, 2);
    assert.deepEqual(json(api.state.workouts[0].exercises.map(exercise => exercise.sets[0].weight)), [70, 60]);
    assert.equal(api.state.history.get(original.id)[0].venue, 'ttl');
    assert.equal(api.state.history.get(alternate.id)[0].sets[0].rir, 2);
    assert.equal(api.workoutEntries().length, 0);
});

check('Shared free-weight references do not share drafts across venues', () => {
    reset('lower-a', 'ttl');
    const ttlItem = itemFor('rdl');
    putSet(ttlItem, 0, entered(80, 6, 2, true));
    api.state.venue = 'bf';
    const basicFitItem = itemFor('rdl');
    assert.equal(api.draftFor(basicFitItem)[0].weight, '');
    putSet(basicFitItem, 0, entered(75, 8, 2));
    api.finishSample();
    assert.equal(api.state.workouts[0].venue, 'bf');
    api.state.venue = 'ttl';
    assert.equal(api.draftFor(ttlItem)[0].weight, '80');
    assert.equal(api.draftFor(ttlItem)[0].done, true);
});

check('Earlier sample workouts and history remain unchanged after subsequent saves', () => {
    const item = itemFor('pulldown');
    putSet(item, 0, entered(70, 8, 2));
    api.finishSample();
    const firstWorkout = JSON.stringify(api.state.workouts[0]);
    const firstRecord = JSON.stringify(api.state.history.get('pulldown-ttl')[0]);
    putSet(item, 0, entered(70, 9, 0));
    api.finishSample();
    assert.equal(JSON.stringify(api.state.workouts[0]), firstWorkout);
    assert.equal(JSON.stringify(api.state.history.get('pulldown-ttl')[1]), firstRecord);
});

check('Unknown conventions cannot be completed or silently assigned', () => {
    reset('upper-b', 'hotel');
    const item = itemFor('preacher');
    const raw = api.selectedEquipment(item);
    assert.equal(raw.kind, 'Unidentified setup');
    assert.equal(api.loadConfirmed(raw), false);
    putSet(item, 0, entered(12.5, 10, 1));
    api.finishSample();
    assert.equal(api.state.workouts.length, 0);
    const confirmed = { ...raw, id: 'preacher-test-per-arm', sourceId: raw.id, kind: 'Plate-loaded', unit: 'kg per arm', previous: null, exerciseKey: item.key };
    assert.equal(api.historyFor(confirmed).length, 0);
    assert.equal(api.loadConfirmed(confirmed), true);
});

check('Known TTL plate machines start with a usable total-plates convention', () => {
    reset('lower-a', 'ttl');
    for (const key of ['glute', 'abBench']) {
        const equipment = api.selectedEquipment(itemFor(key));
        assert.equal(equipment.unit, 'kg total plates');
        assert.equal(api.loadConfirmed(equipment), true);
    }
    reset('upper-c', 'ttl');
    assert.equal(api.selectedEquipment(itemFor('isoRow')).unit, 'kg per arm');
    assert.equal(api.selectedEquipment(itemFor('frontPulldown')).unit, 'kg per arm');
    reset('upper-b', 'ttl');
    assert.equal(api.selectedEquipment(itemFor('shoulderPress')).unit, 'kg per arm');
    assert.equal(api.selectedEquipment(itemFor('lateral')).unit, 'kg per arm');
    for (const key of ['hsTriceps', 'preacher']) assert.equal(api.selectedEquipment(itemFor(key)).unit, 'kg total plates');
    reset('lower-b', 'ttl');
    assert.equal(api.selectedEquipment(itemFor('hack')).unit, 'kg total plates');
    reset('lower-a', 'ttl');
    assert.equal(api.selectedEquipment(itemFor('belt')).unit, 'kg total plates');
});

check('Both TTL leg days use the weighted jackknife and no oblique machine', () => {
    for (const session of ['lower-a', 'lower-b']) {
        reset(session, 'ttl');
        const keys = api.configuration().map(item => item.key);
        assert.ok(keys.includes('jackknife'));
        assert.ok(!keys.includes('oblique'));
    }
});

check('RIR zero, recorded RIR and unknown RIR stay distinct', () => {
    assert.ok(api.formatSets([{ weight: 70, reps: 9, rir: 0 }]).includes('RIR 0'));
    assert.ok(api.formatSets([{ weight: 70, reps: 9, rir: 3 }]).includes('RIR 3'));
    assert.ok(api.formatSets([{ weight: 70, reps: 9, rir: null }]).includes('RIR ?'));
});

check('Load options respect known hardware', () => {
    const plateOptions = api.loadOptionHTML({ kind: 'Plate-loaded' }, 'unconfirmed');
    assert.ok(plateOptions.includes('kg per arm') && plateOptions.includes('kg total plates'));
    assert.ok(!plateOptions.includes('Stack or cable'));
    const stackOptions = api.loadOptionHTML({ kind: 'Weight stack' }, 'kg');
    assert.ok(stackOptions.includes('Stack or cable'));
    assert.ok(!stackOptions.includes('kg per arm'));
});

check('Removing an RIR-only row asks before discarding its value', () => {
    const item = itemFor('pulldown');
    const draft = api.draftFor(item);
    draft[draft.length - 1].rir = '0';
    const button = { dataset: { action: 'remove-set', index: '0' } };
    listeners.get('click')({ target: { closest() { return button; } } });
    assert.equal(nodeFor('sheet-title').textContent, 'Remove this set?');
    assert.equal(draft.length, item.sets);
    assert.equal(draft[draft.length - 1].rir, '0');
    api.closeSheet(false);
});

check('Compact references omit RIR without losing detailed effort data', () => {
    const sets = [{ weight: 70, reps: 9, rir: 0 }];
    assert.equal(api.formatSets(sets, false, false), '70 x 9');
    assert.ok(api.formatSets(sets).includes('RIR 0'));
    assert.equal(sets[0].rir, 0);
});

check('Home sample history uses sample visits, not invented calendar dates', () => {
    reset('upper-b', 'home');
    const equipment = api.selectedEquipment(itemFor('ohp'));
    const reference = api.referenceFor(equipment);
    assert.equal(reference.record.date, 'Sample visit 3');
    assert.equal(reference.record.venue, 'home');
    assert.equal(reference.label, 'Last on this setup');
});

check('A shared free-weight reference names its source, not a fictitious local visit', () => {
    reset('upper-b', 'home');
    const equipment = api.selectedEquipment(itemFor('inclineCurl'));
    const reference = api.referenceFor(equipment);
    assert.equal(reference.label, 'Shared free-weight reference');
    assert.equal(reference.record.venue, 'ttl');
    api.state.history.set(equipment.id, [
        { date: 'New sample', venue: 'ttl', sets: [{ weight: 12.5, reps: 11, rir: 1 }] },
        { date: 'Older sample', venue: 'home', sets: [{ weight: 12.5, reps: 9, rir: 2 }] }
    ]);
    assert.equal(api.referenceFor(equipment).record.venue, 'home');
    assert.equal(api.referenceFor(equipment).label, 'Last on this setup');
});

check('A machine reference never falls back to a different venue', () => {
    const equipment = api.selectedEquipment(itemFor('pulldown'));
    api.state.history.set(equipment.id, [{ date: 'Other venue', venue: 'bf', sets: [{ weight: 66, reps: 9, rir: 1 }] }]);
    assert.equal(api.referenceFor(equipment), null);
});

check('Last time in another venue shows only when the latest performance was elsewhere', () => {
    const item = itemFor('pulldown'), equipment = api.selectedEquipment(item);
    api.state.history.set(equipment.id, [
        { date: '05/10/2026', venue: 'bf', sets: [{ weight: 70, reps: 9, rir: 1 }] },
        { date: '23/09/2026', venue: 'ttl', sets: [{ weight: 66, reps: 9, rir: 1 }] }
    ]);
    assert.equal(api.referenceFor(equipment).record.date, '23/09/2026');
    assert.equal(api.elsewhereFor(item, equipment).venue, 'bf');
    assert.equal(api.elsewhereFor(item, equipment).date, '05/10/2026');
    api.state.venue = 'bf';
    assert.equal(api.referenceFor(equipment).record.date, '05/10/2026');
    assert.equal(api.elsewhereFor(item, equipment), null);
});

check('Demo sample visits keep the other-venue line because they have no dates to compare', () => {
    reset('upper-a', 'bf');
    const item = itemFor('pulldown'), equipment = api.selectedEquipment(item);
    assert.equal(api.referenceFor(equipment).record.venue, 'bf');
    const other = api.elsewhereFor(item, equipment);
    assert.ok(other && other.venue !== 'bf');
});

check('The other-venue rule holds for every venue pair, session and exercise', () => {
    const venues = ['ttl', 'bf', 'home', 'hotel', 'other'], sessions = ['upper-a', 'lower-a', 'upper-b', 'upper-c', 'lower-b'];
    const sets = [{ weight: 40, reps: 10, rir: 1 }], failures = [];
    let pairs = 0;
    for (const session of sessions) for (const there of venues) for (const here of venues) {
        if (here === there) continue;
        reset(session, there);
        const thereItems = api.configuration();
        reset(session, here);
        for (const item of api.configuration()) {
            const source = thereItems.find(candidate => candidate.key === item.key);
            if (!source) continue;
            reset(session, there);
            const thereEquipment = api.selectedEquipment(source);
            api.state.history.set(thereEquipment.id, [{ date: '05/10/2026', venue: there, sets }]);
            api.state.venue = here;
            const equipment = api.selectedEquipment(item), shown = api.elsewhereFor(item, equipment);
            const label = session + ' ' + item.key + ' ' + there + '->' + here;
            const reference = api.referenceFor(equipment);
            const inBox = reference && reference.record.venue === there && reference.record.date === '05/10/2026';
            if (!inBox && (!shown || shown.venue !== there || shown.date !== '05/10/2026')) failures.push(label + ' missing');
            api.state.history.set(equipment.id, [{ date: '06/10/2026', venue: here, sets }, ...(api.state.history.get(equipment.id) || []).filter(record => record.venue !== here)]);
            if (equipment.id !== thereEquipment.id && api.elsewhereFor(item, equipment)) failures.push(label + ' not hidden after newer local');
            pairs++;
        }
    }
    assert.ok(pairs > 500, 'only ' + pairs + ' combinations tested');
    assert.deepEqual(failures, []);
});

check('A new venue shows the latest performance from anywhere as context only', () => {
    const item = itemFor('pulldown'), equipment = api.selectedEquipment(item);
    api.state.history.set(equipment.id, [{ date: '05/10/2026', venue: 'ttl', sets: [{ weight: 70, reps: 9, rir: 1 }] }]);
    api.state.venue = 'hotel';
    const hotelEquipment = api.selectedEquipment(item);
    const other = api.elsewhereFor(item, hotelEquipment);
    assert.equal(other.venue, 'ttl');
    assert.equal(other.date, '05/10/2026');
    assert.equal(api.referenceFor(hotelEquipment), null);
});

check('Supersets advance partners and start rest only after the pair', () => {
    reset('upper-b', 'ttl');
    const items = api.configuration(), first = items.findIndex(item => item.key === 'inclineCurl'), second = items.findIndex(item => item.key === 'rope');
    putSet(items[first], 0, entered(12.5, 10, 1)); api.completeSet(first, 0);
    assert.equal(api.timer.interval, null);
    assert.equal(api.state.pairs.get('upper-b|ttl|' + items[first].group), 'rope');
    putSet(items[second], 0, entered(35, 10, 1)); api.completeSet(second, 0);
    assert.notEqual(api.timer.interval, null);
});

check('Load guidance follows first-set reps and RIR, not another machine load', () => {
    const item = itemFor('pulldown'), equipment = api.selectedEquipment(item);
    putSet(item, 0, entered(70, 5, 0)); assert.ok(api.guidanceFor(item, equipment).includes('below target'));
    putSet(item, 0, entered(70, 10, 4)); assert.ok(api.guidanceFor(item, equipment).includes('headroom'));
    putSet(item, 0, entered(70, 9, 1)); assert.ok(api.guidanceFor(item, equipment).includes('fits the target'));
});

check('A replacement retains original performed sets at finish', () => {
    const original = itemFor('pulldown'); putSet(original, 0, entered(70, 9, 1));
    const replacement = { ...api.knownExercise('frontPulldown'), slotKey: 'pulldown' };
    api.state.substitutions.set('upper-a|ttl|pulldown', replacement);
    putSet(itemFor('frontPulldown'), 0, entered(35, 10, 1));
    api.finishSample(); assert.equal(api.state.workouts[0].exercises.length, 2);
});

check('Full backups preserve all legacy workout/health/program fields exactly', () => {
    const archive = { app: 'yf-tracker', version: 1, health: [{ date: '01/10/2026', weight: 72.4 }], program: { name: 'v1.7', sessions: [] }, workouts: [{ date: '01/10/2026', session: 'Upper A', location: 'Home', exercises: [{ name: 'Original label', target: '3x8', note: 'Original note', sets: [{ weight: 40, reps: 8, rir: 0 }] }] }] };
    api.state.archive = backup.clone(archive); const result = backup.buildBundle(api.state, api.legacyWorkout);
    assert.deepEqual(result.workouts, archive.workouts); assert.deepEqual(result.health, archive.health); assert.deepEqual(result.program, archive.program);
    const restored = {}; backup.apply(restored, backup.validateBundle(result).tracker_review.state); assert.equal(restored.session, 'upper-a');
});

check('A later conflicting import cannot overwrite existing history', () => {
    const original = { app: 'yf-tracker', health: [], workouts: [{ date: '01/10/2026', session: 'Upper A', exercises: [{ name: 'Lift', sets: [{ weight: 70, reps: 9 }] }] }] };
    const changed = backup.clone(original); changed.workouts[0].exercises[0].sets[0].weight = 999;
    const merged = backup.mergeArchives(original, changed); assert.equal(merged.conflicts.length, 1); assert.deepEqual(merged.archive.workouts, original.workouts);
});

check('Rollback retains newer workouts', () => {
    const previous = { app: 'yf-tracker', health: [], workouts: [{ date: '01/10/2026', session: 'Upper A', exercises: [] }] };
    const current = backup.clone(previous); current.workouts.push({ date: '02/10/2026', session: 'Upper B', exercises: [] });
    assert.deepEqual(backup.rollbackArchive(current, previous).workouts, current.workouts);
});

check('Malformed restore metadata cannot partly mutate current state', () => {
    const invalid = backup.pack(api.state); invalid.drafts = [['bad', { not: 'rows' }]];
    const untouched = { sentinel: true }; assert.throws(() => backup.apply(untouched, invalid)); assert.deepEqual(untouched, { sentinel: true });
});

check('Active drafts cannot be replaced by backup import', () => {
    const item = itemFor('pulldown'); putSet(item, 0, entered(70, 9));
    api.importBackup({ size: 0, text() { throw new Error('Protected draft must stop before reading the file'); } });
    assert.equal(nodeFor('sheet-title').textContent, 'Active drafts protected');
    assert.equal(api.draftFor(item)[0].weight, '70');
    api.closeSheet();
});

check('Note-only drafts receive the same import protection', () => {
    api.state.notes.set('upper-a|ttl|pulldown|pulldown-ttl', 'Seat position 3');
    assert.equal(api.hasAnyDraftEntries(), true);
    api.importBackup({ size: 0, text() { throw new Error('Protected note must stop before reading the file'); } });
    assert.equal(nodeFor('sheet-title').textContent, 'Active drafts protected');
    assert.equal(api.state.notes.values().next().value, 'Seat position 3');
    api.closeSheet();
});

check('Review metadata must match full-history records before restore', () => {
    putSet(itemFor('pulldown'), 0, entered(70, 9)); api.finishSample();
    const bundle = backup.buildBundle(api.state, api.legacyWorkout);
    assert.doesNotThrow(() => backup.validateReviewRecords(bundle, api.legacyWorkout));
    bundle.tracker_review.state.workouts[0].exercises[0].sets[0].weight = 999;
    assert.throws(() => backup.validateReviewRecords(bundle, api.legacyWorkout));
});

check('Recovery activates the incomplete superset partner', () => {
    reset('upper-b', 'ttl');
    const item = itemFor('rope'); putSet(item, 0, entered(35, ''));
    const key = [...api.state.drafts.keys()].find(candidate => candidate.includes('|rope|'));
    api.reviewDraft(key);
    assert.equal(api.state.pairs.get('upper-b|ttl|' + item.group), 'rope');
    assert.ok(nodeFor('exercise-list').innerHTML.includes('data-exercise="rope"'));
});

check('New exports retain seated versus standing OHP identity', () => {
    const seated = { date: '01/01/2099', session: 'upper-b', venue: 'home', exercises: [{ exerciseKey: 'ohp', name: 'Seated barbell OHP', equipmentId: 'seated-home-ohp', equipmentName: 'Seated barbell OHP', unit: 'kg', sets: [{ weight: 35, reps: 7, rir: 2 }] }] };
    assert.equal(api.legacyWorkout(seated).exercises[0].name, 'Seated OHP barbell');
    seated.exercises[0].equipmentName = 'Standing barbell OHP';
    assert.equal(api.legacyWorkout(seated).exercises[0].name, 'Standing OHP barbell');
});

check('Draft dates are separate and survive backup restore', () => {
    reset('lower-a', 'ttl'); api.state.dateISO = '2099-01-01'; putSet(itemFor('rdl'), 0, entered(80, 6, 2));
    api.state.session = 'upper-b'; api.state.dateISO = '2099-01-02'; putSet(itemFor('ohp'), 0, entered(40, 5, 1));
    assert.equal(api.state.draftDates.get('lower-a|ttl'), '2099-01-01');
    assert.equal(api.state.draftDates.get('upper-b|ttl'), '2099-01-02');
    const restored = {}; backup.apply(restored, backup.pack(api.state));
    assert.equal(restored.draftDates.get('lower-a|ttl'), '2099-01-01');
});

check('Idle past draft dates fall back to today and dated drafts are kept', () => {
    reset('lower-a', 'ttl'); api.state.dateISO = '2020-01-01';
    api.configuration().forEach(item => api.draftFor(item));
    assert.equal(api.state.draftDates.get('lower-a|ttl'), '2020-01-01');
    assert.equal(api.pruneIdleDraftDates(), true);
    assert.equal(api.state.draftDates.has('lower-a|ttl'), false);
    assert.notEqual(api.state.dateISO, '2020-01-01');
    reset('lower-a', 'ttl'); api.state.dateISO = '2020-01-01'; putSet(itemFor('rdl'), 0, entered(80, 6, 2));
    api.pruneIdleDraftDates();
    assert.equal(api.state.draftDates.get('lower-a|ttl'), '2020-01-01');
});

check('A canonical session cannot duplicate its same-day historical TTL variant', () => {
    reset('lower-a', 'ttl'); api.state.dateISO = '2099-01-01'; putSet(itemFor('rdl'), 0, entered(80, 6, 2));
    api.state.archive = { app: 'yf-tracker', health: [], workouts: [{ date: '01/01/2099', session: 'Lower A \u00b7 TTL', exercises: [] }] };
    api.finishSample(); assert.equal(api.state.workouts.length, 0);
    assert.equal(api.state.archive.workouts[0].session, 'Lower A \u00b7 TTL');
});

if (process.argv[2]) {
    const original = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    reset(); api.state.archive = backup.legacyArchive(original);
    const exported = backup.buildBundle(api.state, api.legacyWorkout);
    assert.deepEqual(exported.workouts, original.workouts); assert.deepEqual(exported.health, original.health); assert.deepEqual(exported.program, original.program);
    checks.push('Read-only real-history roundtrip: ' + original.workouts.length + ' original workouts unchanged');
}

console.log(checks.length + ' review-build checks passed:');
for (const name of checks) console.log('- ' + name);