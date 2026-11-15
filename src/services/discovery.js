import { filterScholarships } from '../model.js';
import { createApi } from './api.js';

export function createDiscovery({ source = 'demo', baseUrl, fetchImpl } = {}) {
  if (!['demo', 'api'].includes(source)) throw new Error('Unknown discovery source.');
  const api = source === 'api' ? createApi({ baseUrl, fetchImpl }) : null;
  return {
    source,
    async catalog(records, signal) {
      if (!api) return filterScholarships(records);
      const rows = [];
      let offset = 0;
      do {
        const page = await api.listScholarships({ limit: 100, offset }, signal);
        if (!Array.isArray(page.items)) throw new Error('Invalid scholarship API response.');
        rows.push(...page.items);
        const next = page.nextOffset;
        if (next != null && (!Number.isInteger(next) || next <= offset)) throw new Error('Invalid API pagination.');
        offset = next;
      } while (offset != null);
      return rows;
    },
    filter: filterScholarships,
  };
}
