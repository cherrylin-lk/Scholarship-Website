import { thaiScholarships } from './thaiScholarships.js';
import { initialScholarships } from './data.js';

export const fields = ['Engineering & Technology', 'Business & Economics', 'Science & Research', 'Arts & Design', 'All fields'];
export const statuses = ['Planning', 'Preparing', 'Submitted', 'Under review', 'Accepted', 'Rejected'];
export const emptyProfile = { degree: 'Undergraduate', field: 'Engineering & Technology', country: '', gpa: '', bio: '', fullFunding: false, reminders: true, reminderDays: 14 };
export function localDay(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function dateAfter(days) { const date = new Date(); date.setDate(date.getDate() + days); return localDay(date); }
export function daysLeft(deadline, today = localDay()) { return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000); }
export function dateLabel(value) { if (!value) return 'Check official announcement'; return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
export function seedStore() {
  return { scholarships: [...thaiScholarships.map(s => ({ ...s })), ...initialScholarships.map((s, i) => ({ ...s, deadline: dateAfter([7, 21, 12, 35, 60, 90][i]), minGpa: [3.5, 3.2, 3, 3.4, 2.5, 2.5][i], published: true, approvalStatus: 'approved', studyLevels: levelsOf(s), fundingType: fundingOf(s), ownerId: i === 0 ? 'demo-university' : 'system' }))], users: [
    { id: 'demo-student', name: 'Alex Morgan', email: 'student@scholarrise.demo', role: 'student', demo: true, active: true, profile: { ...emptyProfile, country: 'United Kingdom', gpa: '3.7' } },
    { id: 'demo-university', name: 'Westbridge Scholarships Team', email: 'university@scholarrise.demo', role: 'university', university: 'Westbridge University', demo: true, active: true },
    { id: 'demo-admin', name: 'ScholarRise Administrator', email: 'admin@scholarrise.demo', role: 'admin', demo: true, active: true },
  ], applications: [], bookmarks: {}, dismissed: {} };
}
export function recommend(scholarship, profile, today = localDay()) {
  if (!scholarship.deadline || (scholarship.realProgram && scholarship.minGpa == null) || !isPublic(scholarship) || daysLeft(scholarship.deadline, today) < 0) return null;
  if (!profile.gpa || Number(profile.gpa) < scholarship.minGpa || !levelsOf(scholarship).some(level => levelsOf({ degree: profile.degree }).includes(level))) return null;
  const reasons = ['Study level matches', 'Meets sample GPA requirement'];
  let score = 50;
  if (scholarship.field === profile.field || scholarship.field === 'All fields') { score += 30; reasons.push(scholarship.field === 'All fields' ? 'Open to your field' : 'Matches your field'); }
  if (profile.country && scholarship.country === profile.country) { score += 10; reasons.push('Preferred destination'); }
  if (!profile.fullFunding || scholarship.amount === 'Full tuition') { score += 10; if (profile.fullFunding) reasons.push('Full tuition funding'); }
  return { score, reasons };
}
export function notifications(store, user, today = localDay()) {
  if (!user || user.role !== 'student' || !user.profile.reminders) return [];
  const tracked = store.applications.filter(a => a.userId === user.id && ['Planning', 'Preparing'].includes(a.status)).map(a => a.scholarshipId);
  const watched = new Set([...(store.bookmarks[user.id] || []), ...tracked]);
  return store.scholarships.filter(s => isPublic(s) && watched.has(s.id)).map(s => ({ ...s, days: daysLeft(s.deadline, today), noticeId: `${s.id}:${s.deadline}` })).filter(s => s.days >= 0 && s.days <= Number(user.profile.reminderDays) && !(store.dismissed[user.id] || []).includes(s.noticeId)).sort((a, b) => a.days - b.days);
}
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}

export const studyLevels = ["Bachelor's", "Master's", 'PhD'];
export const fundingTypes = ['Fully Funded', 'Partially Funded', 'Tuition Waiver', 'Fixed Amount'];
export function levelsOf(s) {
 if (Array.isArray(s.studyLevels) && s.studyLevels.length) return s.studyLevels;
 return s.degree === 'Undergraduate' ? ["Bachelor's"] : s.degree === 'Postgraduate' ? ["Master's", 'PhD'] : [s.degree].filter(Boolean);
}
export function fundingOf(s) { return fundingTypes.includes(s.fundingType) ? s.fundingType : s.amount === 'Full tuition' ? (/living/i.test(s.coverage || '') ? 'Fully Funded' : 'Tuition Waiver') : 'Fixed Amount'; }
export function isPublic(s) { return s.published === true && (s.approvalStatus == null || s.approvalStatus === 'approved'); }
export function normalizeScholarship(s) { return { ...s, studyLevels: levelsOf(s), fundingType: fundingOf(s), approvalStatus: s.approvalStatus || (s.published ? 'approved' : 'pending') }; }
export function filterScholarships(list, { country = '', level = '', university = '', funding = '', query = '' } = {}) {
 const keyword = query.trim().toLowerCase();
 return list.filter(s => isPublic(s) && (!country || s.country === country) && (!level || levelsOf(s).includes(level)) && (!university || s.university === university) && (!funding || fundingOf(s) === funding) && [s.name, s.description, s.university, s.country, s.field, s.amount, fundingOf(s)].join(' ').toLowerCase().includes(keyword));
}

// Append once by stable ID; preserve saved edits and user data.
export function addThaiScholarships(store) {
 const existing = new Set(store.scholarships.map(s => s.id));
 return { ...store, scholarships: [...store.scholarships, ...thaiScholarships.filter(s => !existing.has(s.id)).map(s => ({ ...s }))] };
}
