import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { dateAfter, dateLabel, daysLeft, fields, fundingTypes, fundingOf, isPublic, levelsOf, studyLevels } from './model';
import { createStaffWorkspace, scholarshipRequest } from './services/staff.js';

export default function CloudManagement({ user, api, Dialog, today, onUnauthorized, onChanged }) {
  const controller = useRef(null);
  const [state, setState] = useState({ scholarships: [], users: [], statistics: null, loading: true });
  const [edit, setEdit] = useState(null), [moderation, setModeration] = useState(null), [activation, setActivation] = useState(null);
  const [error, setError] = useState('');
  const admin = user.role === 'admin';
  useEffect(() => {
    const workspace = createStaffWorkspace({ api, identity: user, onUnauthorized, onChanged });
    controller.current = workspace;
    const unsubscribe = workspace.subscribe(setState);
    void workspace.reload();
    return () => { unsubscribe(); workspace.dispose(); controller.current = null; };
  }, []);
  const ready = !state.loading && !state.busy && !state.error;
  const managed = state.scholarships;
  const store = { scholarships: managed }; // Existing form suggestions use only server listings.
  const stats = admin && state.statistics ? Object.entries(state.statistics).map(([label, count]) => [label, count])
    : [['Scholarships', managed.length], ['Published', managed.filter(isPublic).length], ['Pending approval', managed.filter(s => s.approvalStatus === 'pending').length]];
  async function save(event) {
    event.preventDefault(); setError('');
    try {
      const form = new FormData(event.currentTarget), values = Object.fromEntries(form);
      if (values.deadline && daysLeft(values.deadline, today) < 0 && (!edit.id || values.deadline !== edit.deadline)) throw new Error('Choose today or a future deadline.');
      const body = scholarshipRequest(values, form.getAll('studyLevels'), edit.version);
      if (await controller.current.save(edit.id, body)) setEdit(null);
    } catch (failure) { setError(failure.message); }
  }
  return <>
    <div className="stat-grid">{stats.map(([label, count]) => <div className="panel stat" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
    {state.loading && <p role="status">Loading staff workspace...</p>}
    {state.busy && <p role="status">Saving changes...</p>}
    {state.error && <div className="panel" role="alert"><p>{state.error}</p><button className="secondary-button" disabled={state.loading || state.busy} onClick={() => { setEdit(null); setModeration(null); setActivation(null); void controller.current.reload(); }}>Retry staff workspace</button></div>}
    <div className="panel"><div className="panel-heading"><h2>{admin ? 'Scholarship catalog' : 'Your scholarships'}</h2><button className="button" disabled={admin || !ready} title={admin ? 'Scholarship creation is available to university accounts through the backend.' : ''} onClick={() => { setError(''); setEdit({ field: 'All fields', minGpa: 3, deadline: dateAfter(30), studyLevels: ["Bachelor's"], fundingType: 'Fixed Amount' }); }}><Plus size={16}/>Add scholarship</button></div>
      <p>{admin ? 'Review pending listings, approve, reject or unpublish scholarships. Content creation and editing belong to university accounts.' : 'Create and manage scholarships belonging to your university. New and edited listings require administrator approval.'} Unpublishing keeps existing application history.</p>
      {!state.loading && !managed.length && <p>No scholarship listings yet.</p>}
      <div className="table-wrap"><table><thead><tr><th>Scholarship</th><th>Deadline</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>{managed.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.university}</small>{row.moderationNote && <small>{row.moderationNote}</small>}</td><td>{dateLabel(row.deadline)}</td><td>{isPublic(row) ? 'Published' : row.approvalStatus === 'pending' ? 'Pending approval' : row.approvalStatus === 'rejected' ? 'Rejected' : 'Unpublished'}</td><td><div className="action-row">
        <button className="text-link" disabled={admin || !ready} onClick={() => { setError(''); setEdit(row); }}>Edit</button>
        {admin ? <>{['approve', 'reject', 'unpublish'].map(decision => <button className="text-link" key={decision} disabled={!ready || (decision === 'unpublish' && !row.published)} onClick={() => setModeration({ row, decision })}>{decision === 'approve' ? 'Approve and publish' : decision === 'reject' ? 'Reject' : 'Unpublish'}</button>)}</>
          : <button className="text-link" disabled={!ready || !row.published} onClick={() => void controller.current.unpublish(row)}>{row.published ? 'Unpublish' : 'Awaiting approval'}</button>}
      </div></td></tr>)}</tbody></table></div></div>
    <div className="panel"><h2>{admin ? 'Application activity' : 'Applicant overview'}</h2><p>The backend does not provide a staff applicant overview endpoint. Student tracking and private notes are not loaded or shared here.</p></div>
    {admin && <div className="panel"><h2>User management</h2><p>Activation changes use the backend. Roles and administrator activation require a separately authorized operator; this screen cannot grant privileges.</p><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{state.users.map(row => <tr key={row.userId}><td><strong>{row.name}</strong><small>{row.university}</small></td><td>{row.role}</td><td>{row.active ? 'Active' : 'Disabled'}</td><td><button className="text-link" disabled={!ready || row.role === 'admin'} onClick={() => setActivation(row)}>{row.role === 'admin' ? 'Operator managed' : row.active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div></div>}
    {moderation && <Dialog title="Review scholarship" onClose={() => setModeration(null)}><form className="portal-form" onSubmit={async event => { event.preventDefault(); const note = new FormData(event.currentTarget).get('note'); if (await controller.current.moderate(moderation.row, moderation.decision, note)) setModeration(null); }}><p>{moderation.decision}: {moderation.row.name}</p><label>Moderation note<textarea name="note" maxLength={2000}/></label><button className="button" disabled={!ready}>Confirm moderation</button></form></Dialog>}
    {activation && <Dialog title="Confirm account activation" onClose={() => setActivation(null)}><p>{activation.active ? 'Disable' : 'Enable'} {activation.name}? This changes backend access immediately; Cognito login settings are unchanged.</p><button className="button" disabled={!ready} onClick={async () => { if (await controller.current.setActive(activation)) setActivation(null); }}>Confirm account change</button></Dialog>}
    {edit && !admin && <Dialog title={edit.id ? 'Edit scholarship' : 'Add scholarship'} onClose={() => setEdit(null)}><form className="portal-form form-grid" onSubmit={save}><label className="full-width">Scholarship name<input name="name" required maxLength={120} defaultValue={edit.name}/></label>{admin && <label className="full-width">University<input name="university" required maxLength={120} defaultValue={edit.university}/></label>}<label>Destination<input name="country" list="listing-countries" required maxLength={80} defaultValue={edit.country}/><datalist id="listing-countries">{[...new Set([...store.scholarships.map(s => s.country), 'Thailand', 'Japan', 'United States', 'United Kingdom', 'Australia', 'Singapore'])].sort().map(country => <option key={country} value={country}/>)}</datalist></label><fieldset className="full-width level-options"><legend>Eligible study levels (select one or more)</legend>{studyLevels.map(level => <label className="check-label" key={level}><input type="checkbox" name="studyLevels" value={level} defaultChecked={levelsOf(edit).includes(level)}/>{level}</label>)}</fieldset><label>Funding type<select name="fundingType" defaultValue={fundingOf(edit)}>{fundingTypes.map(f => <option key={f}>{f}</option>)}</select></label><label>Field<select name="field" defaultValue={edit.field}>{[...new Set([...fields, ...(edit.field ? [edit.field] : [])])].map(field => <option key={field}>{field}</option>)}</select></label><label>Minimum GPA<input name="minGpa" type="number" min="0" max="4" step="0.01" defaultValue={edit.minGpa ?? ""}/></label><label>Award (e.g. Full tuition)<input name="amount" required maxLength={50} defaultValue={edit.amount}/></label><label>Coverage<input name="coverage" maxLength={80} defaultValue={edit.coverage}/></label><label>Deadline<input name="deadline" type="date" defaultValue={edit.deadline || ""}/></label><label>Award category<input name="tag" maxLength={40} defaultValue={edit.tag || ""} disabled title="Award category is not editable through the backend."/></label><label className="full-width">Description<textarea name="description" required rows={3} maxLength={1000} defaultValue={edit.description}/></label><label className="full-width">Eligibility requirements<textarea name="eligibility" rows={3} maxLength={4000} defaultValue={edit.eligibility}/></label><label className="full-width">Required documents<textarea name="documents" rows={3} maxLength={4000} defaultValue={edit.documents}/></label><label className="full-width">Official application link<input name="applicationUrl" type="url" pattern="https://.*" maxLength={2000} defaultValue={edit.applicationUrl}/></label>{admin && <label className="check-label full-width"><input name="published" type="checkbox" defaultChecked={edit.published}/>Approve and publish in scholarship search</label>}{error && <p className="form-error full-width" role="alert">{error}</p>}<button className="button" disabled={!ready}>Save scholarship</button></form></Dialog>}
  </>;
}
