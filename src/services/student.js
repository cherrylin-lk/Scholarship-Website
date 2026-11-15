import { ApiError } from './api.js';

export function profileRequest(account, changes) {
  const source = { ...account.profile, ...changes };
  const degree = source.degree === 'Undergraduate' ? "Bachelor's" : source.degree;
  if (!["Bachelor's", "Master's", 'PhD'].includes(degree)) throw new Error('Choose Bachelor\'s, Master\'s or PhD before saving.');
  const gpa = source.gpa === '' || source.gpa == null ? null : Number(source.gpa);
  if (gpa != null && (!Number.isFinite(gpa) || gpa < 0 || gpa > 4)) throw new Error('Use a GPA from 0 to 4.');
  const name = String(changes.name ?? account.name ?? '').trim();
  if (!name || name.length > 80) throw new Error('Enter a name of up to 80 characters.');
  return { name, degree, gpa, field: source.field || '', country: source.country || '', bio: source.bio || '',
    fullFunding: source.fullFunding === true, reminders: source.reminders !== false,
    reminderDays: source.reminderDays ?? 14, version: account.version };
}

export function checkedStudent(record, userId) {
  if (!record || record.userId !== userId || record.role !== 'student' || record.active !== true)
    throw new ApiError('Account unavailable.', 403);
  if (!Number.isSafeInteger(record.version) || record.version < 1) throw new Error('Invalid account version.');
  return record;
}

function records(response, userId, prefix) {
  if (!Array.isArray(response?.items)) throw new Error('Invalid workspace response.');
  return response.items.map(row => {
    if (row.userId !== userId || typeof row.scholarshipId !== 'string' || row.recordKey !== `${prefix}#${row.scholarshipId}`
      || !Number.isSafeInteger(row.version) || row.version < 1) throw new Error('Invalid private record.');
    return { ...row, id: row.scholarshipId };
  });
}

// Per-session memory only. Epoch checks discard every response from an old identity.
export function createStudentWorkspace({ api, onUnauthorized = () => {} }) {
  const empty = () => ({ userId: null, account: null, saved: [], applications: [], dismissed: [], loading: false, busy: false, error: '' });
  let state = empty(), epoch = 0, readSequence = 0;
  const listeners = new Set();
  const publish = change => { state = { ...state, ...change }; listeners.forEach(fn => fn(state)); };
  const valid = (generation, id) => generation === epoch && state.userId === id;
  function reset() { epoch++; readSequence++; state = empty(); listeners.forEach(fn => fn(state)); }
  function failure(error, generation, id) {
    if (!valid(generation, id)) return;
    if ([401, 403].includes(error?.status)) { reset(); onUnauthorized(error.status); }
    else publish({ error: error?.status === 409
      ? 'Another session changed this record. Latest data loaded; review it before saving again.'
      : error?.status === 400 ? 'Check the entered values and try again.' : 'Could not update your workspace. Retry before making more changes.' });
  }
  async function reload() {
    const generation = epoch, id = state.userId, sequence = ++readSequence;
    if (!id) return false;
    publish({ loading: true, error: '' });
    try {
      const scoped = api.forSession ? api.forSession(() => valid(generation, id)) : api;
      const [account, saved, applications] = await Promise.all([scoped.me(), scoped.saved(), scoped.applications()]);
      checkedStudent(account, id);
      const values = { account, saved: records(saved, id, 'SAVED'), applications: records(applications, id, 'APPLICATION') };
      if (!valid(generation, id) || sequence !== readSequence) return false;
      publish({ ...values, loading: false });
      return true;
    } catch (error) {
      if (sequence === readSequence) {
        failure(error, generation, id);
        if (valid(generation, id)) publish({ loading: false });
      }
      return false;
    }
  }
  async function mutate(operation) {
    if (!state.userId || !state.account || state.loading || state.busy || state.error) return false;
    const generation = epoch, id = state.userId;
    publish({ busy: true });
    try {
      const scoped = api.forSession ? api.forSession(() => valid(generation, id)) : api;
      const change = await operation(state, scoped);
      if (!valid(generation, id)) return false;
      publish(change);
      return true;
    } catch (error) {
      if (valid(generation, id) && error?.status === 409 && !await reload()) {
        if (valid(generation, id)) publish({ error: 'Another session changed this record. Could not refresh it; retry before saving again.' });
        return false;
      }
      failure(error, generation, id);
      return false;
    } finally { if (valid(generation, id)) publish({ busy: false }); }
  }
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset, reload,
    start(identity) {
      if (identity.role !== 'student') { reset(); return; }
      if (state.userId === identity.id) return;
      reset(); publish({ userId: identity.id }); void reload();
    },
    async saveProfile(changes) {
      let body;
      try { body = profileRequest(state.account, changes); }
      catch (error) { publish({ error: error.message }); return false; }
      return mutate(async (snapshot, scoped) => ({ account: checkedStudent(await scoped.saveProfile(body), snapshot.userId) }));
    },
    toggleSaved(id) {
      return mutate(async (snapshot, scoped) => {
        if (snapshot.saved.some(row => row.scholarshipId === id)) {
          await scoped.unsave(id); return { saved: snapshot.saved.filter(row => row.scholarshipId !== id) };
        }
        const row = await scoped.save(id);
        return { saved: [...snapshot.saved, ...records({ items: [row] }, snapshot.userId, 'SAVED')] };
      });
    },
    saveApplication(id, changes) {
      return mutate(async (snapshot, scoped) => {
        const old = snapshot.applications.find(row => row.scholarshipId === id);
        const row = await scoped.saveApplication(id, { status: changes.status ?? old?.status ?? 'Planning',
          notes: changes.notes ?? old?.notes ?? '', ...(old ? { version: old.version } : {}) });
        const [checked] = records({ items: [row] }, snapshot.userId, 'APPLICATION');
        return { applications: [...snapshot.applications.filter(item => item.scholarshipId !== id), checked] };
      });
    },
    removeApplication(id) {
      return mutate(async (snapshot, scoped) => { await scoped.deleteApplication(id);
        return { applications: snapshot.applications.filter(row => row.scholarshipId !== id) }; });
    },
    dismiss(id) { publish({ dismissed: [...state.dismissed, id] }); },
  };
}
