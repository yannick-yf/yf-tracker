(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TrackerReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const DB_NAME = 'yf-tracker-v2';
    const SCHEMA = 1;
    const mapFields = ['drafts', 'draftItems', 'draftDates', 'equipment', 'custom', 'customExercises', 'history', 'pairs', 'substitutions', 'mappings', 'notes'];
    const clone = value => JSON.parse(JSON.stringify(value));
    const identity = workout => workout.date + '|' + workout.session;
    function sameRecord(first, second) {
        if (first === second) return true;
        if (!first || !second || typeof first !== 'object' || typeof second !== 'object' || Array.isArray(first) !== Array.isArray(second)) return false;
        const firstKeys = Object.keys(first), secondKeys = Object.keys(second);
        return firstKeys.length === secondKeys.length && firstKeys.every(key => Object.prototype.hasOwnProperty.call(second, key) && sameRecord(first[key], second[key]));
    }

    function pack(state) {
        const result = { schema: SCHEMA, session: state.session, venue: state.venue, dateISO: state.dateISO, workouts: clone(state.workouts || []), skipped: [...state.skipped], sampleSessions: state.sampleSessions || 0 };
        for (const field of mapFields) result[field] = clone([...(state[field] || new Map())]);
        return result;
    }
    function validateState(value) {
        if (!value || value.schema !== SCHEMA) throw new Error('Unsupported review backup version. Existing data was not changed.');
        value = clone(value);
        if (!value.draftItems) value.draftItems = [];
        if (!value.draftDates) {
            const contexts = new Set((value.drafts || []).map(([key]) => key.split('|').slice(0, 2).join('|')));
            value.draftDates = [...contexts].map(key => [key, value.dateISO || new Date().toISOString().slice(0, 10)]);
        }
        if (!Array.isArray(value.workouts) || !Array.isArray(value.skipped)) throw new Error('Invalid review state.');
        for (const field of mapFields) {
            if (!Array.isArray(value[field]) || !value[field].every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string')) throw new Error('Invalid ' + field + ' metadata.');
        }
        const validSet = set => set && typeof set === 'object' && Number.isFinite(Number(set.weight)) && Number.isFinite(Number(set.reps));
        for (const [, draft] of value.drafts) {
            if (!Array.isArray(draft) || draft.length > 100 || !draft.every(entry => entry && ['weight', 'reps', 'rir'].every(field => typeof entry[field] === 'string') && typeof entry.done === 'boolean')) throw new Error('Invalid draft rows.');
        }
        for (const field of ['custom', 'customExercises']) for (const [, item] of value[field]) {
            if (!item || typeof item !== 'object' || typeof item.name !== 'string') throw new Error('Invalid custom setup metadata.');
        }
        for (const [, setup] of value.custom) if (typeof setup.id !== 'string' || typeof setup.kind !== 'string' || typeof setup.unit !== 'string' || !Array.isArray(setup.venues) || !setup.venues.every(venue => ['ttl', 'bf', 'home', 'hotel', 'other'].includes(venue))) throw new Error('Incomplete equipment metadata.');
        const validExercise = item => item && typeof item.key === 'string' && typeof item.name === 'string' && Number.isInteger(item.sets) && item.sets > 0 && item.sets <= 100 && ['reps', 'rir', 'rest', 'group'].every(field => typeof item[field] === 'string');
        for (const [, item] of value.customExercises) if (!validExercise(item)) throw new Error('Invalid custom exercise targets.');
        for (const [, item] of value.substitutions) if (!validExercise(item) || typeof item.slotKey !== 'string') throw new Error('Invalid exercise substitution metadata.');
        for (const [, item] of value.draftItems) if (!validExercise(item)) throw new Error('Invalid draft exercise identity.');
        for (const field of ['equipment', 'pairs']) for (const [, selection] of value[field]) if (typeof selection !== 'string') throw new Error('Invalid equipment or superset selection.');
        for (const [, records] of value.history) {
            if (!Array.isArray(records) || !records.every(record => record && typeof record.date === 'string' && Array.isArray(record.sets) && record.sets.every(validSet))) throw new Error('Invalid equipment history metadata.');
        }
        for (const [, mapping] of value.mappings) if (!mapping || typeof mapping.equipmentId !== 'string' || typeof mapping.unit !== 'string') throw new Error('Invalid historical setup mapping.');
        for (const [, note] of value.notes) if (typeof note !== 'string') throw new Error('Invalid workout note.');
        for (const [, date] of value.draftDates) if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid draft date.');
        for (const workout of value.workouts) if (!workout || !Array.isArray(workout.exercises) || !workout.exercises.every(exercise => exercise && typeof exercise.name === 'string' && Array.isArray(exercise.sets) && exercise.sets.every(validSet))) throw new Error('Invalid saved review workout.');
        if (!value.skipped.every(key => typeof key === 'string')) throw new Error('Invalid skipped exercise metadata.');
        if (!['upper-a', 'lower-a', 'upper-b', 'upper-c', 'lower-b'].includes(value.session) || !['ttl', 'bf', 'home', 'hotel', 'other'].includes(value.venue)) throw new Error('Invalid workout or venue selection.');
        if (value.dateISO && !/^\d{4}-\d{2}-\d{2}$/.test(value.dateISO)) throw new Error('Invalid workout date.');
        return clone(value);
    }
    function apply(state, value) {
        const checked = validateState(value);
        state.session = checked.session; state.venue = checked.venue; state.dateISO = checked.dateISO;
        state.workouts = checked.workouts; state.skipped = new Set(checked.skipped); state.sampleSessions = checked.sampleSessions || 0;
        for (const field of mapFields) state[field] = new Map(checked[field]);
    }
    function validateBundle(value) {
        if (!value || !['yf-tracker', 'yf-tracker-review'].includes(value.app) || !Array.isArray(value.workouts) || !Array.isArray(value.health)) throw new Error('Choose a full YF Tracker JSON backup.');
        const seen = new Set();
        for (const workout of value.workouts) {
            if (!workout || typeof workout.date !== 'string' || typeof workout.session !== 'string' || !Array.isArray(workout.exercises)) throw new Error('Invalid workout record.');
            if (seen.has(identity(workout))) throw new Error('Duplicate date/session records require review before import.');
            seen.add(identity(workout));
            for (const exercise of workout.exercises) {
                if (!exercise || typeof exercise.name !== 'string' || !Array.isArray(exercise.sets)) throw new Error('Invalid exercise record.');
                for (const set of exercise.sets) if (!set || (set.reps != null && !Number.isFinite(Number(set.reps)))) throw new Error('Invalid set record.');
            }
        }
        if (value.tracker_review) {
            if (value.tracker_review.schema !== SCHEMA) throw new Error('This backup needs a newer review build.');
            validateState(value.tracker_review.state);
        }
        if (value.app === 'yf-tracker-review' && !value.tracker_review) throw new Error('Demo restore requires its review metadata.');
        return clone(value);
    }
    function legacyArchive(bundle) {
        const archive = validateBundle(bundle);
        delete archive.tracker_review;
        return archive;
    }
    function buildBundle(state, makeWorkout, now = new Date().toISOString()) {
        const archive = state.archive ? clone(state.archive) : { app: 'yf-tracker-review', version: 1, health: [], workouts: [], program: null };
        const workouts = archive.workouts;
        const seen = new Set(workouts.map(identity));
        for (const workout of state.workouts || []) {
            const exported = makeWorkout(workout);
            if (seen.has(identity(exported))) {
                const existing = workouts.find(record => identity(record) === identity(exported));
                if (!sameRecord(existing, exported)) throw new Error('A saved date/session conflicts with history. Neither record was overwritten.');
            } else { workouts.push(clone(exported)); seen.add(identity(exported)); }
        }
        archive.exported_at = now;
        archive.tracker_review = { schema: SCHEMA, state: pack(state) };
        return archive;
    }
    function mergeArchives(existing, incoming) {
        const source = legacyArchive(incoming);
        if (!existing) return { archive: source, added: source.workouts.length, conflicts: [] };
        const archive = clone(existing), indexed = new Map(archive.workouts.map(workout => [identity(workout), workout]));
        let added = 0;
        const conflicts = [];
        for (const workout of source.workouts) {
            const previous = indexed.get(identity(workout));
            if (!previous) { archive.workouts.push(clone(workout)); indexed.set(identity(workout), workout); added++; }
            else if (!sameRecord(previous, workout)) conflicts.push(identity(workout));
        }
        const dates = new Set(archive.health.map(record => record.date));
        for (const day of source.health) if (!dates.has(day.date)) { archive.health.push(clone(day)); dates.add(day.date); }
        if (!archive.program && source.program) archive.program = clone(source.program);
        return { archive, added, conflicts };
    }
    function rollbackArchive(current, checkpoint) {
        if (!current) return clone(checkpoint);
        if (!checkpoint) return clone(current);
        const result = mergeArchives(current, checkpoint);
        if (result.conflicts.length) throw new Error('Rollback has conflicting workouts; export the current full backup before reviewing them.');
        return result.archive;
    }
    function openStore(indexedDB) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots', { keyPath: 'id' }); };
            request.onerror = () => reject(request.error || new Error('Local storage could not open.'));
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                function get(id) { return new Promise((done, fail) => { const query = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(id); query.onsuccess = () => done(query.result ? query.result.value : null); query.onerror = () => fail(query.error); }); }
                function put(records) { return new Promise((done, fail) => { const transaction = db.transaction('snapshots', 'readwrite'); const store = transaction.objectStore('snapshots'); for (const [id, value] of records) store.put({ id, value: clone(value) }); transaction.oncomplete = () => done(); transaction.onerror = () => fail(transaction.error); transaction.onabort = () => fail(transaction.error || new Error('Local save aborted.')); }); }
                resolve({ get, put, close() { db.close(); } });
            };
        });
    }
    function validateReviewRecords(bundle, convert) {
        if (!bundle.tracker_review) return;
        for (const workout of bundle.tracker_review.state.workouts) {
            const converted = convert(workout);
            const raw = bundle.workouts.find(record => identity(record) === identity(converted));
            if (!raw || !sameRecord(raw, converted)) throw new Error('Review metadata conflicts with the full-history records. Nothing was imported.');
        }
    }
    return { DB_NAME, SCHEMA, clone, identity, sameRecord, pack, apply, validateState, validateBundle, validateReviewRecords, legacyArchive, buildBundle, mergeArchives, rollbackArchive, openStore };
});