import { useEffect, useState } from 'react';
import { KeyRound, PencilLine, Plus, RefreshCw, Shield, UserRound, UserRoundCheck } from 'lucide-react';
import { api, json } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, Field, Modal, PageHeader, StatusPill, TableSkeleton } from '../components/UI';

export default function StaffPage() {
  const { user } = useAuth(); const toast = useToast();
  const [rows, setRows] = useState([]); const [roles, setRoles] = useState([]); const [pharmacies, setPharmacies] = useState([]);
  const [editing, setEditing] = useState(null); const [modal, setModal] = useState(false);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(null); const [search, setSearch] = useState('');
  const isAdmin = user?.role === 'platform_admin';
  async function load() {
    setLoading(true); setError(null);
    try {
      const [staff, roleRows, pharmacyRows] = await Promise.all([
        api(`/staff${search ? `?search=${encodeURIComponent(search)}` : ''}`), api('/staff/roles'), isAdmin ? api('/pharmacies') : Promise.resolve({ data: [] }),
      ]);
      setRows(staff.data); setRoles(roleRows.data.filter((role) => isAdmin || role.name !== 'platform_admin')); setPharmacies(pharmacyRows.data);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [search]);
  function openForm(row = null) { setEditing(row); setModal(true); }
  async function save(event) {
    event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget);
    const role = String(form.get('role'));
    const body = { fullName: form.get('fullName'), email: form.get('email'), phone: form.get('phone') || null, role, isActive: form.get('isActive') === 'on' };
    if (isAdmin && role !== 'platform_admin') body.pharmacyId = Number(form.get('pharmacyId'));
    if (form.get('password')) body.password = form.get('password');
    try {
      if (editing) await api(`/staff/${editing.id}`, json('PUT', body));
      else await api('/staff', json('POST', { ...body, password: String(form.get('password') || ''), isActive: undefined }));
      toast(editing ? 'Staff account updated.' : 'Staff account created.'); setModal(false); setEditing(null); await load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  return <>
    <PageHeader eyebrow="ACCESS GOVERNANCE" title="Staff & roles" description="Manage pharmacy team access with role assignments enforced by the API." action={<div className="action-row"><button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button><button className="button button-primary" onClick={() => openForm()}><Plus size={15} /> Add staff</button></div>} />
    <section className="panel table-panel staff-directory"><div className="table-toolbar"><div><h2><UserRoundCheck size={17} /> Team directory</h2><p>{isAdmin ? 'Platform-wide accounts and pharmacy assignments' : 'Accounts assigned to your pharmacy'}</p></div><label className="search-box"><UserRound size={15} /><input aria-label="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" /></label></div>
      {loading ? <TableSkeleton rows={5} cols={5} /> : error ? <ErrorState error={error} retry={load} /> : rows.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>TEAM MEMBER</th><th>PHARMACY</th><th>ROLE</th><th>LAST SIGN IN</th><th>STATUS</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><div className="stacked-cell"><b>{row.fullName}</b><small>{row.email}{row.phone ? ` · ${row.phone}` : ''}</small></div></td><td>{row.pharmacy || 'Platform-wide'}</td><td><span className="role-chip"><Shield size={13} />{row.role.replaceAll('_', ' ')}</span></td><td>{row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}</td><td><StatusPill tone={row.isActive ? 'good' : 'danger'}>{row.isActive ? 'Active' : 'Inactive'}</StatusPill></td><td><button className="icon-button table-action" aria-label={`Edit ${row.fullName}`} title="Edit account" onClick={() => openForm(row)}><PencilLine size={16} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={UserRound} title="No team members found" text={search ? 'Try a different name or email.' : 'Add a staff account to get started.'} />}
    </section>
    {modal && <Modal title={editing ? 'Edit staff account' : 'Add staff account'} onClose={() => setModal(false)} wide>
      <form key={editing?.id || 'new'} className="form-stack" onSubmit={save}><div className="form-grid">
        <Field label="Full name"><input name="fullName" required minLength="2" maxLength="150" defaultValue={editing?.fullName || ''} /></Field>
        <Field label="Email address"><input name="email" type="email" required maxLength="254" defaultValue={editing?.email || ''} /></Field>
        <Field label="Phone"><input name="phone" maxLength="30" defaultValue={editing?.phone || ''} /></Field>
        <Field label="Role"><select name="role" required defaultValue={editing?.role || ''}><option value="" disabled>Choose role</option>{roles.map((role) => <option key={role.id} value={role.name}>{role.name.replaceAll('_', ' ')}</option>)}</select></Field>
        {isAdmin && <Field label="Assigned pharmacy"><select name="pharmacyId" defaultValue={editing?.pharmacyId || ''}><option value="">Platform-wide role only</option>{pharmacies.map((pharmacy) => <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>)}</select></Field>}
        <Field label={editing ? 'New password (optional)' : 'Temporary password'}><input name="password" type="password" required={!editing} minLength="12" maxLength="200" autoComplete="new-password" placeholder={editing ? 'Leave blank to keep current' : 'At least 12 characters'} /></Field>
        {editing && <label className="field form-check"><span>Account status</span><span className="check-row"><input type="checkbox" name="isActive" defaultChecked={Boolean(editing.isActive)} /> Active sign-in</span></label>}
      </div><div className="form-note"><KeyRound size={14} /> Passwords are bcrypt-hashed server-side and never returned in staff responses.</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button></div></form>
    </Modal>}
  </>;
}
