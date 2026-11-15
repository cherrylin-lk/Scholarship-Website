import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Bell, Bookmark, LayoutDashboard, LogOut, Plus, Sparkles, UserRound, X, ArrowRight, CalendarDays, ShieldCheck, Building2 } from 'lucide-react';
import { dateAfter, dateLabel, daysLeft, emptyProfile, fields, localDay, notifications, passwordHash, recommend, seedStore, statuses, studyLevels, fundingTypes, levelsOf, fundingOf, normalizeScholarship, isPublic, addThaiScholarships } from './model';
import './portal.css';

const Context = createContext(null);
export const usePortal = () => useContext(Context);
const STORE_KEY = 'scholarrise-platform-v1';
function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.users) && Array.isArray(saved.scholarships) && Array.isArray(saved.applications) && saved.bookmarks && saved.dismissed) return addThaiScholarships({ ...saved, scholarships: saved.scholarships.map(normalizeScholarship) });
    const initial = seedStore();
    const legacy = JSON.parse(localStorage.getItem('scholarrise-saved') || localStorage.getItem('scholarpath-saved') || '[]');
    if (Array.isArray(legacy)) initial.bookmarks.guest = legacy.filter(id => Number.isInteger(id));
    return initial;
  } catch { return seedStore(); }
}

export function PortalProvider({ children }) {
  const [store, setStore] = useState(loadStore);
  const [session, setSession] = useState(() => { try { return sessionStorage.getItem('scholarrise-session'); } catch { return null; } });
  const [view, setView] = useState('discover');
  const [auth, setAuth] = useState(null);
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [today, setToday] = useState(localDay());
  const user = store.users.find(u => u.id === session && u.active) || null;
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); setStorageError(false); } catch { setStorageError(true); } }, [store]);
  useEffect(() => { try { if (session) sessionStorage.setItem('scholarrise-session', session); else sessionStorage.removeItem('scholarrise-session'); } catch { /* Session remains in memory. */ } }, [session]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const timer = setInterval(() => setToday(localDay()), 60000); return () => clearInterval(timer); }, []);
  function go(next) { if (next !== 'discover' && !user) { setAuth('login'); return; } setView(next); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const alerts = notifications(store, user, today);
  function track(s) {
    if (!user) { setAuth('login'); return; }
    if (user.role !== 'student') { setToast('Use a student account to track applications.'); return; }
    if (!s.deadline) { setToast('Check the official announcement for a deadline before tracking this program.'); return; }
    if (!isPublic(s) || daysLeft(s.deadline, today) < 0) { setToast('This scholarship is closed.'); return; }
    if (store.applications.some(a => a.userId === user.id && a.scholarshipId === s.id)) { go('applications'); return; }
    setStore(previous => ({ ...previous, applications: [...previous.applications, { id: crypto.randomUUID(), userId: user.id, scholarshipId: s.id, status: 'Planning', notes: '', updatedAt: new Date().toISOString() }] }));
    setToast('Added to your application tracker. No application has been sent.');
  }
  return <Context.Provider value={{ store, setStore, user, view, go, setAuth, setSession, setToast, alerts, track, today }}>
    {storageError && <div className="storage-warning" role="alert">Browser storage is unavailable or full. Changes will last only for this session.</div>}
    {children}
    {auth && <AuthDialog mode={auth} setMode={setAuth}/>}
    {toast && <div className="portal-toast" role="status">{toast}<button aria-label="Dismiss message" onClick={() => setToast('')}><X size={16}/></button></div>}
  </Context.Provider>;
}

export function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; const dialog = ref.current; const focusable = () => [...dialog.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled); focusable()[0]?.focus(); function key(event) { if (event.key === 'Escape') onClose(); if (event.key === 'Tab') { const nodes = focusable(); const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } } dialog.addEventListener('keydown', key); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); }; }, []);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal portal-dialog" ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={onClose}><X/></button><h2>{title}</h2>{children}</section></div>;
}

function AuthDialog({ mode, setMode }) {
  const { store, setStore, setSession, setToast } = usePortal();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const email = data.email.trim().toLowerCase();
    try {
      if (mode === 'register') {
        if (!data.name.trim()) throw new Error('Enter your name.');
        if (store.users.some(u => u.email === email)) throw new Error('An account with this email already exists.');
        const salt = crypto.randomUUID();
        const account = { id: crypto.randomUUID(), name: data.name.trim(), email, role: 'student', active: true, salt, password: await passwordHash(data.password, salt), profile: { ...emptyProfile } };
        setStore(previous => ({ ...previous, users: [...previous.users, account] })); setSession(account.id); setMode(null); setToast('Account created. Complete your student profile to get recommendations.');
      } else {
        const account = store.users.find(u => u.email === email && !u.demo);
        if (!account || !account.active || await passwordHash(data.password, account.salt) !== account.password) throw new Error('Email or password is incorrect, or this demo account is disabled.');
        setSession(account.id); setMode(null); setToast(`Welcome back, ${account.name}.`);
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  function demo(role) { const account = store.users.find(u => u.demo && u.role === role && u.active); if (!account) { setError('This demo account is disabled.'); return; } setSession(account.id); setMode(null); setToast(`Signed in to the ${role} demo. Use My workspace to explore.`); }
  return <Dialog title={mode === 'register' ? 'Start your ScholarRise journey' : 'Welcome back to ScholarRise'} onClose={() => setMode(null)}><p>Local prototype. Accounts and data stay in this browser. Use sample details and a unique demo password.</p><form className="portal-form" onSubmit={submit}>
    {mode === 'register' && <label>Full name<input name="name" required maxLength={80} autoComplete="name"/></label>}
    <label>Email address<input name="email" type="email" required autoComplete="email" maxLength={160}/></label><label>Password<input name="password" type="password" required minLength={8} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'}/></label>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="button" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create student account' : 'Log in'}<ArrowRight size={16}/></button>
  </form><button className="text-link" onClick={() => { setError(''); setMode(mode === 'register' ? 'login' : 'register'); }}>{mode === 'register' ? 'Already registered? Log in' : 'New here? Create an account'}</button><div className="demo-access"><h3>Explore a demo role</h3><p>No password needed. University and administrator access are demo-only.</p><div className="action-row">{['student', 'university', 'admin'].map(role => <button className="secondary-button" key={role} onClick={() => demo(role)}>{role === 'admin' ? 'Administrator' : role}</button>)}</div></div></Dialog>;
}

export function AccountNav() {
  const { user, go, setAuth, alerts, setSession } = usePortal();
  return <div className="account-nav">{user ? <><button className="notification-button" aria-label={`${alerts.length} deadline reminders`} onClick={() => go('notifications')}><Bell size={19}/>{alerts.length > 0 && <span>{alerts.length}</span>}</button><button className="secondary-button" onClick={() => go(user.role === 'student' ? 'overview' : user.role)}><UserRound size={15}/><span>My workspace</span></button><button className="signout-button" aria-label="Log out" onClick={() => { setSession(null); go('discover'); }}><LogOut size={17}/></button></> : <><button className="text-link" onClick={() => setAuth('login')}>Log in</button><button className="button" onClick={() => setAuth('register')}>Register</button></>}</div>;
}

export function Workspace() {
  const { user, view, go } = usePortal();
  if (!user) return <main className="container workspace"><h1>Sign in to open your workspace.</h1></main>;
  const links = user.role === 'student' ? [['overview', 'Overview', LayoutDashboard], ['profile', 'Student profile', UserRound], ['recommendations', 'Recommendations', Sparkles], ['applications', 'Application tracking', Bookmark], ['notifications', 'Deadline reminders', Bell]] : user.role === 'university' ? [['university', 'University dashboard', Building2]] : [['admin', 'Administrator dashboard', ShieldCheck]];
  const activeView = links.some(([key]) => key === view) ? view : links[0][0];
  return <main className="container workspace"><div className="workspace-heading"><div><div className="section-kicker">YOUR SCHOLARRISE WORKSPACE</div><h1>{user.role === 'student' ? `Welcome, ${user.name.split(' ')[0]}.` : user.role === 'university' ? 'University dashboard' : 'Administrator dashboard'}</h1><p>{user.role === 'student' ? 'Your goals, opportunities, and next steps in one place.' : user.role === 'university' ? user.university : 'Manage this browser’s demo users and scholarship catalog.'}</p></div><span className="sample-label">Local demo · {user.role}</span></div><div className="workspace-layout"><aside className="workspace-menu">{links.map(([key, label, Icon]) => <button key={key} className={activeView === key ? 'current' : ''} onClick={() => go(key)}><Icon size={18}/>{label}</button>)}<button onClick={() => go('discover')}><ArrowRight size={18}/>Browse scholarships</button></aside><section className="workspace-content">
    {activeView === 'overview' && <Overview/>}{activeView === 'profile' && <Profile/>}{activeView === 'recommendations' && <Recommendations/>}{activeView === 'applications' && <Applications/>}{activeView === 'notifications' && <Notifications/>}{activeView === 'university' && user.role === 'university' && <Management/>}{activeView === 'admin' && user.role === 'admin' && <Management admin/>}
  </section></div><p className="demo-note">Local demonstration. No applications are sent, and no email or background notifications are delivered.</p></main>;
}

function Overview() {
  const { user, store, go, alerts, today } = usePortal();
  const applications = store.applications.filter(a => a.userId === user.id);
  const matches = store.scholarships.filter(s => recommend(s, user.profile, today));
  return <><div className="stat-grid">{[['Saved scholarships', (store.bookmarks[user.id] || []).length], ['Applications tracked', applications.length], ['Deadline reminders', alerts.length]].map(([label, count]) => <div className="panel stat" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div><div className="panel"><div className="section-kicker">YOUR NEXT STEP</div><h2>{user.profile.gpa ? 'Explore your scholarship matches.' : 'Tell us about your ambitions.'}</h2><p>{user.profile.gpa ? `${matches.length} open scholarships meet your study level and sample GPA requirement. Review the details before deciding.` : 'Add your study level, field, GPA, and preferred destination to unlock recommendations.'}</p><button className="button" onClick={() => go(user.profile.gpa ? 'recommendations' : 'profile')}>{user.profile.gpa ? 'See recommendations' : 'Complete my profile'}<ArrowRight size={16}/></button></div><Notifications compact/></>;
}

function Profile() {
  const { user, setStore, setToast } = usePortal();
  function submit(e) { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); if (!data.name.trim()) return; setStore(previous => ({ ...previous, users: previous.users.map(u => u.id === user.id ? { ...u, name: data.name.trim(), profile: { ...u.profile, degree: data.degree, field: data.field, gpa: data.gpa, country: data.country, bio: data.bio.trim(), fullFunding: data.fullFunding === 'on' } } : u) })); setToast('Student profile saved. Recommendations have been updated.'); }
  return <div className="panel"><h2>Student profile</h2><p>Use a GPA on a 0–4 scale. These preferences power your local recommendations.</p><form className="portal-form form-grid" onSubmit={submit}><label>Full name<input name="name" required maxLength={80} defaultValue={user.name}/></label><label>Email<input value={user.email} disabled readOnly/></label><label>Study level<select name="degree" defaultValue={user.profile.degree}><option value="Undergraduate">Bachelor's</option><option value="Postgraduate">Master's / PhD (legacy)</option>{studyLevels.slice(1).map(l => <option key={l}>{l}</option>)}</select></label><label>Field of study<select name="field" defaultValue={user.profile.field}>{fields.map(field => <option key={field}>{field}</option>)}</select></label><label>Current GPA (0–4)<input name="gpa" type="number" min="0" max="4" step="0.01" required defaultValue={user.profile.gpa}/></label><label>Preferred destination<select name="country" defaultValue={user.profile.country}><option value="">Any destination</option>{['United Kingdom', 'United States', 'Singapore', 'Canada', 'Australia', 'Thailand'].map(country => <option key={country}>{country}</option>)}</select></label><label className="full-width">About your goals<textarea name="bio" rows={3} maxLength={1000} defaultValue={user.profile.bio}/></label><label className="check-label full-width"><input name="fullFunding" type="checkbox" defaultChecked={user.profile.fullFunding}/>Prioritize full tuition scholarships</label><button className="button" type="submit">Save profile</button></form></div>;
}

function Recommendations() {
  const { store, user, today, go, track } = usePortal();
  const ranked = store.scholarships.map(s => ({ ...s, match: recommend(s, user.profile, today) })).filter(s => s.match).sort((a, b) => b.match.score - a.match.score);
  return <><div className="panel"><h2>Recommended for you</h2><p>Rule-based ranking: study level and minimum GPA are required. Field, destination, and funding preferences improve the match score. This is a preference score, not an admission probability.</p><button className="text-link" onClick={() => go('profile')}>Update my preferences <ArrowRight size={14}/></button></div>{!ranked.length && <div className="panel"><h3>No matches yet</h3><p>Complete your GPA and study preferences, or explore scholarships using search.</p></div>}<div className="recommendation-grid">{ranked.map(s => <article className="panel" key={s.id}><span className="match-score">{s.match.score}/100 preference match</span><h3>{s.name}</h3><p>{s.university} · {s.country}</p><ul className="reason-list">{s.match.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p><CalendarDays size={14}/> Deadline: {dateLabel(s.deadline)}</p><button className="button" onClick={() => track(s)}>{store.applications.some(a => a.userId === user.id && a.scholarshipId === s.id) ? 'Open tracker' : 'Track application'}</button></article>)}</div></>;
}

function Applications() {
  const { store, user, setStore, setToast, today, go } = usePortal();
  const [filter, setFilter] = useState('All statuses');
  const [remove, setRemove] = useState(null);
  const owned = store.applications.filter(a => a.userId === user.id);
  function update(id, changes) { setStore(previous => ({ ...previous, applications: previous.applications.map(a => a.id === id && a.userId === user.id ? { ...a, ...changes, updatedAt: new Date().toISOString() } : a) })); }
  return <><div className="panel"><div className="panel-heading"><h2>Application tracking</h2><select aria-label="Filter applications by status" value={filter} onChange={e => setFilter(e.target.value)}><option>All statuses</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></div><p>Track your own progress here. Changing a status does not submit a real application.</p></div>{!owned.length && <div className="panel"><h3>Your next chapter starts with one application.</h3><p>Open a scholarship’s details and select Track application.</p><button className="button" onClick={() => go('discover')}>Find scholarships</button></div>}{owned.length > 0 && !owned.some(a => filter === 'All statuses' || a.status === filter) && <div className="panel">No applications with this status.</div>}{owned.filter(a => filter === 'All statuses' || a.status === filter).map(a => { const s = store.scholarships.find(s => s.id === a.scholarshipId); if (!s) return null; const left = daysLeft(s.deadline, today); return <article className="panel" key={a.id}><div className="panel-heading"><div><h3>{s.name}</h3><p>{s.university}</p></div><span className="tag">{left < 0 ? 'Deadline passed' : left === 0 ? 'Due today' : `${left} days left`}</span></div><p>Deadline: {dateLabel(s.deadline)}{!s.published && ' · Listing currently unpublished'}</p><div className="form-grid"><label>Status<select value={a.status} onChange={e => update(a.id, { status: e.target.value })}>{statuses.map(status => <option key={status}>{status}</option>)}</select></label><label>Last updated<input readOnly value={new Date(a.updatedAt).toLocaleDateString('en-GB')}/></label><label className="full-width">Application notes<textarea rows={3} maxLength={2000} value={a.notes} onChange={e => update(a.id, { notes: e.target.value })} placeholder="Documents to prepare, next steps, or interview notes"/></label></div><button className="danger-button" onClick={() => setRemove(a.id)}>Remove from tracker</button></article>; })}{remove && <Dialog title="Remove tracked application?" onClose={() => setRemove(null)}><p>Your notes and tracking history for this application will be removed from this browser.</p><div className="action-row"><button className="secondary-button" onClick={() => setRemove(null)}>Cancel</button><button className="danger-button" onClick={() => { setStore(previous => ({ ...previous, applications: previous.applications.filter(a => !(a.id === remove && a.userId === user.id)) })); setRemove(null); setToast('Application removed from tracker.'); }}>Remove application</button></div></Dialog>}</>;
}

function Notifications({ compact = false }) {
  const { user, setStore, alerts, go } = usePortal();
  function preference(changes) { setStore(previous => ({ ...previous, users: previous.users.map(u => u.id === user.id ? { ...u, profile: { ...u.profile, ...changes } } : u) })); }
  return <div className="panel"><div className="panel-heading"><h2><Bell size={20}/> Deadline reminders</h2>{compact && <button className="text-link" onClick={() => go('notifications')}>Settings</button>}</div>{!compact && <><p>In-app reminders for saved scholarships and applications in Planning or Preparing. Checked while this page is open; no email, push, or background delivery.</p><div className="form-grid"><label className="check-label"><input type="checkbox" checked={user.profile.reminders} onChange={e => preference({ reminders: e.target.checked })}/>Enable deadline reminders</label><label>Reminder window<select value={user.profile.reminderDays} onChange={e => preference({ reminderDays: Number(e.target.value) })}>{[7, 14, 30].map(days => <option key={days} value={days}>{days} days before deadline</option>)}</select></label></div></>}{!alerts.length && <p>{user.profile.reminders ? 'You’re all caught up. Save or track scholarships to see upcoming deadlines here.' : 'Deadline reminders are switched off.'}</p>}{alerts.slice(0, compact ? 3 : alerts.length).map(s => <div className="reminder-row" key={s.noticeId}><CalendarDays size={22}/><div><h3>{s.name}</h3><p>{s.days === 0 ? 'Due today' : `Due in ${s.days} days`} · {dateLabel(s.deadline)}</p></div><button className="text-link" aria-label={`Dismiss reminder for ${s.name}`} onClick={() => setStore(previous => ({ ...previous, dismissed: { ...previous.dismissed, [user.id]: [...(previous.dismissed[user.id] || []), s.noticeId] } }))}>Dismiss</button></div>)}</div>;
}

function Management({ admin = false }) {
  const { user, store, setStore, setToast, today } = usePortal();
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const managed = store.scholarships.filter(s => admin || s.ownerId === user.id);
  const related = store.applications.filter(a => managed.some(s => s.id === a.scholarshipId));
  function save(e) {
    e.preventDefault(); setError(''); const data = Object.fromEntries(new FormData(e.currentTarget));
    if (!new FormData(e.currentTarget).getAll('studyLevels').length) { setError('Select at least one study level.'); return; }
    if (!data.name.trim() || !data.country.trim() || !data.amount.trim() || !data.description.trim() || (admin && !data.university.trim())) { setError('Complete all required fields.'); return; }
    if (daysLeft(data.deadline, today) < 0 && (!edit.id || data.deadline !== edit.deadline)) { setError('Choose today or a future deadline.'); return; }
    const record = { ...edit, id: edit.id || crypto.randomUUID(), name: data.name.trim(), university: admin ? data.university.trim() : user.university, country: data.country.trim(), degree: new FormData(e.currentTarget).getAll('studyLevels').includes("Bachelor's") ? 'Undergraduate' : 'Postgraduate', studyLevels: new FormData(e.currentTarget).getAll('studyLevels'), fundingType: data.fundingType, eligibility: data.eligibility.trim(), documents: data.documents.trim(), applicationUrl: data.applicationUrl.trim(), field: data.field, amount: data.amount.trim(), coverage: data.coverage.trim(), description: data.description.trim(), minGpa: Number(data.minGpa), deadline: data.deadline, tag: data.tag.trim() || 'University award', ownerId: edit.ownerId || user.id, initials: (admin ? data.university : user.university).trim()[0].toUpperCase(), published: admin && data.published === 'on', approvalStatus: admin ? (data.published === 'on' ? 'approved' : edit.approvalStatus || 'pending') : 'pending' };
    setStore(previous => ({ ...previous, scholarships: edit.id ? previous.scholarships.map(s => s.id === edit.id && (admin || s.ownerId === user.id) ? record : s) : [...previous.scholarships, record] })); setEdit(null); setToast(admin ? 'Scholarship saved.' : 'Scholarship submitted for administrator approval.');
  }
  return <><div className="stat-grid">{[['Scholarships', managed.length], ['Published', managed.filter(s => s.published).length], ['Tracked applications', related.length]].map(([label, count]) => <div className="panel stat" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div><div className="panel"><div className="panel-heading"><h2>{admin ? 'Scholarship catalog' : 'Your scholarships'}</h2><button className="button" onClick={() => { setError(''); setEdit({ degree: 'Undergraduate', field: 'All fields', minGpa: 3, deadline: dateAfter(30), published: false, studyLevels: ["Bachelor's"], fundingType: 'Fixed Amount' }); }}><Plus size={16}/>Add scholarship</button></div><p>{admin ? 'Review pending listings, approve, or unpublish scholarships.' : 'Create and manage scholarships belonging to your university. New and edited listings require administrator approval.'} Unpublishing keeps existing application history.</p><div className="table-wrap"><table><thead><tr><th>Scholarship</th><th>Deadline</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>{managed.map(s => <tr key={s.id}><td><strong>{s.name}</strong><small>{s.university}</small></td><td>{dateLabel(s.deadline)}</td><td>{isPublic(s) ? 'Published' : s.approvalStatus === 'pending' ? 'Pending approval' : 'Unpublished'}</td><td><div className="action-row"><button className="text-link" onClick={() => { setError(''); setEdit(s); }}>Edit</button><button className="text-link" disabled={!admin && !s.published} onClick={() => setStore(previous => ({ ...previous, scholarships: previous.scholarships.map(item => item.id === s.id && (admin || item.ownerId === user.id) ? { ...item, published: admin ? !item.published : false, approvalStatus: admin ? 'approved' : item.approvalStatus } : item) }))}>{s.published ? 'Unpublish' : admin ? 'Approve and publish' : 'Awaiting approval'}</button></div></td></tr>)}</tbody></table></div></div><div className="panel"><h2>{admin ? 'Application activity' : 'Applicant overview'}</h2><p>Only applications with a student-reported status of Submitted or later appear here. Private planning notes are not shared.</p>{!related.some(a => !['Planning', 'Preparing'].includes(a.status)) && <p>No submitted demo applications yet.</p>}{related.filter(a => !['Planning', 'Preparing'].includes(a.status)).map(a => <div className="reminder-row" key={a.id}><div><h3>{store.users.find(u => u.id === a.userId)?.name || 'Student'}</h3><p>{store.scholarships.find(s => s.id === a.scholarshipId)?.name}</p></div><span className="tag">{a.status}</span></div>)}</div>
    {admin && <div className="panel"><h2>User management</h2><p>Registration creates student accounts only. Staff roles are seeded demonstration accounts. Disabling an account prevents local login.</p><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{store.users.map(u => <tr key={u.id}><td><strong>{u.name}</strong><small>{u.email}</small></td><td>{u.role}</td><td>{u.active ? 'Active' : 'Disabled'}</td><td><button className="text-link" disabled={u.id === user.id} onClick={() => setStore(previous => ({ ...previous, users: previous.users.map(item => item.id === u.id && item.id !== user.id ? { ...item, active: !item.active } : item) }))}>{u.id === user.id ? 'Current account' : u.active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div></div>}
    {edit && <Dialog title={edit.id ? 'Edit scholarship' : 'Add scholarship'} onClose={() => setEdit(null)}><form className="portal-form form-grid" onSubmit={save}><label className="full-width">Scholarship name<input name="name" required maxLength={120} defaultValue={edit.name}/></label>{admin && <label className="full-width">University<input name="university" required maxLength={120} defaultValue={edit.university}/></label>}<label>Destination<input name="country" list="listing-countries" required maxLength={80} defaultValue={edit.country}/><datalist id="listing-countries">{[...new Set([...store.scholarships.map(s => s.country), 'Thailand', 'Japan', 'United States', 'United Kingdom', 'Australia', 'Singapore'])].sort().map(country => <option key={country} value={country}/>)}</datalist></label><fieldset className="full-width level-options"><legend>Eligible study levels (select one or more)</legend>{studyLevels.map(level => <label className="check-label" key={level}><input type="checkbox" name="studyLevels" value={level} defaultChecked={levelsOf(edit).includes(level)}/>{level}</label>)}</fieldset><label>Funding type<select name="fundingType" defaultValue={fundingOf(edit)}>{fundingTypes.map(f => <option key={f}>{f}</option>)}</select></label><label>Field<select name="field" defaultValue={edit.field}>{fields.map(field => <option key={field}>{field}</option>)}</select></label><label>Minimum GPA<input name="minGpa" type="number" min="0" max="4" step="0.01" required defaultValue={edit.minGpa}/></label><label>Award (e.g. Full tuition)<input name="amount" required maxLength={50} defaultValue={edit.amount}/></label><label>Coverage<input name="coverage" maxLength={80} defaultValue={edit.coverage}/></label><label>Deadline<input name="deadline" type="date" required defaultValue={edit.deadline}/></label><label>Award category<input name="tag" maxLength={40} defaultValue={edit.tag}/></label><label className="full-width">Description<textarea name="description" required rows={3} maxLength={1000} defaultValue={edit.description}/></label><label className="full-width">Eligibility requirements<textarea name="eligibility" rows={3} maxLength={4000} defaultValue={edit.eligibility}/></label><label className="full-width">Required documents<textarea name="documents" rows={3} maxLength={4000} defaultValue={edit.documents}/></label><label className="full-width">Official application link<input name="applicationUrl" type="url" pattern="https?://.*" maxLength={2000} defaultValue={edit.applicationUrl}/></label>{admin && <label className="check-label full-width"><input name="published" type="checkbox" defaultChecked={edit.published}/>Approve and publish in scholarship search</label>}{error && <p className="form-error full-width" role="alert">{error}</p>}<button className="button">Save scholarship</button></form></Dialog>}
  </>;
}
