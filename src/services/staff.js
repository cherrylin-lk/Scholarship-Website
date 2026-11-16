import { ApiError } from './api.js';

// Only editable scholarship fields; ownership and publication are always server assigned.
export function scholarshipRequest(values, levels, version) {
  const body = Object.fromEntries(['name', 'country', 'amount', 'coverage', 'description', 'field', 'eligibility', 'documents', 'applicationUrl']
    .map(key => [key, String(values[key] || '').trim()]));
  if (!levels.length) throw new Error('Select at least one study level.');
  if (body.applicationUrl && !/^https:\/\//i.test(body.applicationUrl)) throw new Error('Application URL must use HTTPS.');
  return { ...body, studyLevels: levels, fundingType: values.fundingType,
    deadline: values.deadline || null, minGpa: values.minGpa === '' || values.minGpa == null ? null : Number(values.minGpa),
    ...(version == null ? {} : { version }) };
}

// In-memory, identity-scoped staff workspace. Never falls back to the demo store.
export function createStaffWorkspace({ api, identity, onUnauthorized = () => {}, onChanged = () => {} }) {
  let epoch = 0, sequence = 0, disposed = false;
  let state = { scholarships: [], users: [], statistics: null, loading: true, busy: false, error: '' };
  const listeners = new Set();
  const current = generation => !disposed && epoch === generation;
  const emit = update => { state = { ...state, ...update }; listeners.forEach(fn => fn(state)); };
  const scoped = api.forSession ? api.forSession(() => !disposed) : api;
  function failure(error, generation) {
    if (!current(generation)) return;
    if ([401, 403].includes(error?.status)) {
      emit({ scholarships: [], users: [], statistics: null, error: 'Staff access could not be verified. Sign in again.' });
      onUnauthorized();
    } else emit({ error: error?.status === 400 ? 'Check the entered values and try again.' : 'Could not load or save staff data. Retry before making more changes.' });
  }
  async function reload() {
    const generation = epoch, read = ++sequence;
    if (disposed) return false;
    emit({ loading: true, error: '' });
    try {
      const account = await scoped.me();
      if (account.userId !== identity.id || account.role !== identity.role || !['admin', 'university'].includes(account.role) || account.active !== true)
        throw new ApiError('Staff access denied.', 403);
      const admin = identity.role === 'admin';
      const [listing, users, statistics] = await Promise.all([
        admin ? scoped.adminScholarships() : scoped.universityScholarships(),
        admin ? scoped.adminUsers() : { items: [] }, admin ? scoped.statistics() : null,
      ]);
      if (!Array.isArray(listing.items) || !Array.isArray(users.items)) throw new Error('Invalid staff response.');
      for (const row of listing.items) {
        if (!row.id || !Number.isSafeInteger(row.version) || row.version < 1 || (!admin && row.ownerId !== identity.id))
          throw new Error('Invalid scholarship owner or version.');
      }
      if (!current(generation) || read !== sequence) return false;
      emit({ scholarships: listing.items, users: users.items, statistics, loading: false });
      return true;
    } catch (error) {
      if (read === sequence) { failure(error, generation); if (current(generation)) emit({ loading: false }); }
      return false;
    }
  }
  async function mutate(operation) {
    if (disposed || state.loading || state.busy || state.error) return false;
    const generation = epoch;
    emit({ busy: true });
    try {
      await operation(scoped);
      if (!current(generation)) return false;
      onChanged();
      return await reload();
    } catch (error) {
      if (current(generation) && error?.status === 409) {
        const refreshed = await reload();
        if (current(generation)) emit({ error: refreshed
          ? 'Another session changed this record. Latest data loaded; close the dialog, retry and review before saving again.'
          : 'Conflict detected. Could not refresh the record; retry before saving.' });
      } else failure(error, generation);
      return false;
    } finally { if (current(generation)) emit({ busy: false }); }
  }
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { disposed = true; epoch++; sequence++; state = { scholarships: [], users: [], statistics: null, loading: false, busy: false, error: '' }; listeners.clear(); },
    reload,
    save: (id, body) => mutate(client => {
      if (identity.role !== 'university') throw new ApiError('Not allowed.', 403);
      return id ? client.updateScholarship(id, body) : client.createScholarship(body);
    }),
    unpublish: row => mutate(client => client.unpublishScholarship(row.id, row.version)),
    moderate: (row, decision, note = '') => mutate(client => {
      if (identity.role !== 'admin') throw new ApiError('Not allowed.', 403);
      return client.moderate(row.id, { decision, note, version: row.version });
    }),
    setActive: row => mutate(client => {
      if (identity.role !== 'admin' || row.role === 'admin') throw new ApiError('Not allowed.', 403);
      return client.updateUser(row.userId, { active: !row.active, version: row.version });
    }),
  };
}
