import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE'];

// Admin role check — only Admin sees the full control panel
const isAdmin = (role) => role === 'Admin' || role === 'admin';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState(() => isAdmin(user?.role) ? 'overview' : 'tryit');
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const tenantId = user?.tenant_id;

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError('');
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api.get(`/tenants/${tenantId}/roles`),
        api.get(`/tenants/${tenantId}/permissions`),
      ]);
      setRoles(rolesRes.data.roles || []);
      setPermissions(permsRes.data.permissions || []);

      if (activeTab === 'users') {
        const { data } = await api.get(`/tenants/${tenantId}/users`);
        setUsers(data.users || []);
      }
      if (activeTab === 'audit') {
        const { data } = await api.get(`/tenants/${tenantId}/audit-logs?limit=30`);
        setAuditLogs(data.audit_logs || []);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [tenantId, activeTab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const adminTabs = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'roles', label: '🎭 Roles' },
    { id: 'permissions', label: '🔑 Permissions' },
    { id: 'users', label: '👥 Users' },
    { id: 'audit', label: '📋 Audit Logs' },
    { id: 'tryit', label: '🧪 Try It' },
  ];

  const userTabs = [
    { id: 'tryit', label: '🧪 Try RBAC' },
  ];

  const tabs = isAdmin(user?.role) ? adminTabs : userTabs;

  return (
    <div style={s.layout}>
      <aside style={s.sidebar}>
        <div style={s.logo}>{isAdmin(user?.role) ? 'RBAC Admin' : 'RBAC Demo'}</div>
        <nav style={s.nav}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ ...s.navBtn, ...(activeTab === t.id ? s.navBtnActive : {}) }}>
              {t.label}
            </button>
          ))}
        </nav>
        <div style={s.userInfo}>
          <p style={s.userEmail}>{user?.email}</p>
          <p style={s.userRole}>{user?.role || 'User'}</p>
          <button onClick={logout} style={s.logoutBtn}>Sign Out</button>
        </div>
      </aside>

      <main style={s.main}>
        <div style={s.header}>
          <h2 style={s.pageTitle}>{tabs.find(t => t.id === activeTab)?.label}</h2>
        </div>
        {error && <p style={s.errorMsg}>{error}</p>}
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
          <>
            {activeTab === 'overview' && <Overview roles={roles} permissions={permissions} users={users} user={user} />}
            {activeTab === 'roles' && <RolesTab tenantId={tenantId} roles={roles} permissions={permissions} onRefresh={fetchData} />}
            {activeTab === 'permissions' && <PermissionsTab tenantId={tenantId} permissions={permissions} onRefresh={fetchData} />}
            {activeTab === 'users' && <UsersTab tenantId={tenantId} users={users} roles={roles} onRefresh={fetchData} />}
            {activeTab === 'audit' && <AuditTab logs={auditLogs} />}
            {activeTab === 'tryit' && <TryItTab user={user} />}
          </>
        )}
      </main>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function Overview({ roles, permissions, users, user }) {
  return (
    <div>
      <div style={s.grid}>
        <StatCard label="Roles" value={roles.length} color="#4f46e5" />
        <StatCard label="Permissions" value={permissions.length} color="#059669" />
        <StatCard label="Users" value={users.length || '—'} color="#d97706" />
        <StatCard label="Your Role" value={user?.role || 'User'} color="#7c3aed" />
      </div>
      {roles.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <p style={s.sectionTitle}>Roles</p>
          <SimpleTable
            columns={['Name', 'Parent', 'Created']}
            rows={roles.map(r => [
              <strong key={r.role_id}>{r.role_name}</strong>,
              roles.find(p => p.role_id === r.parent_role_id)?.role_name || '—',
              new Date(r.created_at).toLocaleDateString(),
            ])}
          />
        </div>
      )}
    </div>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────
function RolesTab({ tenantId, roles, permissions, onRefresh }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [selectedRole, setSelectedRole] = useState(null);
  const [rolePerms, setRolePerms] = useState([]);
  const [assignPermId, setAssignPermId] = useState('');

  const loadRolePerms = async (roleId) => {
    const { data } = await api.get(`/tenants/${tenantId}/roles/${roleId}/permissions`);
    setRolePerms(data.permissions || []);
  };

  const selectRole = async (role) => {
    setSelectedRole(role);
    await loadRolePerms(role.role_id);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setMsg({ type: '', text: '' }); setSaving(true);
    try {
      await api.post(`/tenants/${tenantId}/roles`, { role_name: name, parent_role_id: parentId || null });
      setMsg({ type: 'success', text: `Role "${name}" created` });
      setName(''); setParentId('');
      onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error?.message || 'Failed' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (roleId, roleName) => {
    if (!window.confirm(`Delete role "${roleName}"?`)) return;
    try {
      await api.delete(`/tenants/${tenantId}/roles/${roleId}`);
      if (selectedRole?.role_id === roleId) setSelectedRole(null);
      onRefresh();
    } catch (err) { alert(err.response?.data?.error?.message || 'Failed'); }
  };

  const handleAssignPerm = async (e) => {
    e.preventDefault();
    if (!assignPermId) return;
    try {
      await api.post(`/tenants/${tenantId}/roles/${selectedRole.role_id}/permissions`, { permission_id: assignPermId });
      setAssignPermId('');
      await loadRolePerms(selectedRole.role_id);
    } catch (err) { alert(err.response?.data?.error?.message || 'Failed'); }
  };

  const handleRemovePerm = async (permId) => {
    try {
      await api.delete(`/tenants/${tenantId}/roles/${selectedRole.role_id}/permissions/${permId}`);
      await loadRolePerms(selectedRole.role_id);
    } catch (err) { alert(err.response?.data?.error?.message || 'Failed'); }
  };

  const unassigned = permissions.filter(p => !rolePerms.find(rp => rp.permission_id === p.permission_id));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedRole ? '1fr 1fr' : '1fr', gap: 24 }}>
      <div>
        <div style={s.formCard}>
          <p style={s.sectionTitle}>Create Role</p>
          <form onSubmit={handleCreate} style={s.inlineForm}>
            <div style={s.formField}>
              <label style={s.label}>Role Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Manager" required style={s.input} />
            </div>
            <div style={s.formField}>
              <label style={s.label}>Parent Role</label>
              <select value={parentId} onChange={e => setParentId(e.target.value)} style={s.input}>
                <option value="">None</option>
                {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
              </select>
            </div>
            <button type="submit" disabled={saving} style={s.btnPrimary}>{saving ? 'Creating…' : 'Create'}</button>
          </form>
          {msg.text && <p style={msg.type === 'error' ? s.errorMsg : s.successMsg}>{msg.text}</p>}
        </div>

        <p style={{ ...s.sectionTitle, marginTop: 20 }}>Roles ({roles.length}) — click to manage permissions</p>
        {roles.length === 0 ? <p style={{ color: '#6b7280' }}>No roles yet.</p> : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead><tr>{['Name', 'Parent', 'Created', ''].map(c => <th key={c} style={s.th}>{c}</th>)}</tr></thead>
              <tbody>
                {roles.map((r, i) => (
                  <tr key={r.role_id} onClick={() => selectRole(r)}
                    style={{ ...i % 2 === 0 ? {} : { background: '#f9fafb' }, cursor: 'pointer', ...(selectedRole?.role_id === r.role_id ? { background: '#e0e7ff' } : {}) }}>
                    <td style={s.td}><strong>{r.role_name}</strong></td>
                    <td style={s.td}>{roles.find(p => p.role_id === r.parent_role_id)?.role_name || '—'}</td>
                    <td style={s.td}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td style={s.td} onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleDelete(r.role_id, r.role_name)} style={s.btnDanger}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRole && (
        <div>
          <div style={s.formCard}>
            <p style={s.sectionTitle}>Permissions for: <span style={{ color: '#4f46e5' }}>{selectedRole.role_name}</span></p>
            <form onSubmit={handleAssignPerm} style={s.inlineForm}>
              <div style={s.formField}>
                <label style={s.label}>Assign Permission</label>
                <select value={assignPermId} onChange={e => setAssignPermId(e.target.value)} style={s.input}>
                  <option value="">Select permission…</option>
                  {unassigned.map(p => (
                    <option key={p.permission_id} value={p.permission_id}>{p.resource_name} : {p.action}</option>
                  ))}
                </select>
              </div>
              <button type="submit" style={s.btnPrimary}>Assign</button>
            </form>
            <div style={{ marginTop: 16 }}>
              {rolePerms.length === 0 ? <p style={{ color: '#6b7280', fontSize: 13 }}>No permissions assigned.</p> : rolePerms.map(p => (
                <div key={p.permission_id} style={s.permRow}>
                  <span>
                    <code style={s.code}>{p.resource_name}</code>{' '}
                    <span style={{ ...s.actionBadge, ...actionColor(p.action) }}>{p.action}</span>{' '}
                    {p.inherited && <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>(inherited)</span>}
                  </span>
                  {!p.inherited && <button onClick={() => handleRemovePerm(p.permission_id)} style={s.btnDanger}>Remove</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Permissions Tab ───────────────────────────────────────────────────────────
function PermissionsTab({ tenantId, permissions, onRefresh }) {
  const [resource, setResource] = useState('');
  const [action, setAction] = useState('READ');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const handleCreate = async (e) => {
    e.preventDefault();
    setMsg({ type: '', text: '' }); setSaving(true);
    try {
      await api.post(`/tenants/${tenantId}/permissions`, { resource_name: resource, action });
      setMsg({ type: 'success', text: `Permission "${resource}:${action}" created` });
      setResource(''); setAction('READ');
      onRefresh();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error?.message || 'Failed' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (permId, res, act) => {
    if (!window.confirm(`Delete "${res}:${act}"?`)) return;
    try {
      await api.delete(`/tenants/${tenantId}/permissions/${permId}`);
      onRefresh();
    } catch (err) { alert(err.response?.data?.error?.message || 'Failed'); }
  };

  return (
    <div>
      <div style={s.formCard}>
        <p style={s.sectionTitle}>Create Permission</p>
        <form onSubmit={handleCreate} style={s.inlineForm}>
          <div style={s.formField}>
            <label style={s.label}>Resource</label>
            <input value={resource} onChange={e => setResource(e.target.value)} placeholder="e.g. files/* or reports" required style={s.input} />
          </div>
          <div style={s.formField}>
            <label style={s.label}>Action</label>
            <select value={action} onChange={e => setAction(e.target.value)} style={s.input}>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving} style={s.btnPrimary}>{saving ? 'Creating…' : 'Create'}</button>
        </form>
        {msg.text && <p style={msg.type === 'error' ? s.errorMsg : s.successMsg}>{msg.text}</p>}
      </div>

      <p style={{ ...s.sectionTitle, marginTop: 20 }}>Permissions ({permissions.length})</p>
      {permissions.length === 0 ? <p style={{ color: '#6b7280' }}>No permissions yet.</p> : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead><tr>{['Resource', 'Action', 'Created', ''].map(c => <th key={c} style={s.th}>{c}</th>)}</tr></thead>
            <tbody>
              {permissions.map((p, i) => (
                <tr key={p.permission_id} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
                  <td style={s.td}><code style={s.code}>{p.resource_name}</code></td>
                  <td style={s.td}><span style={{ ...s.actionBadge, ...actionColor(p.action) }}>{p.action}</span></td>
                  <td style={s.td}>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td style={s.td}><button onClick={() => handleDelete(p.permission_id, p.resource_name, p.action)} style={s.btnDanger}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab({ tenantId, users, roles, onRefresh }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [userRoles, setUserRoles] = useState([]);
  const [assignRoleId, setAssignRoleId] = useState('');
  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteMsg, setInviteMsg] = useState({ type: '', text: '' });
  const [inviting, setInviting] = useState(false);

  const loadUserRoles = async (userId) => {
    const { data } = await api.get(`/tenants/${tenantId}/users/${userId}/roles`);
    setUserRoles(data.roles || []);
  };

  const selectUser = async (u) => {
    setSelectedUser(u);
    await loadUserRoles(u.user_id);
  };

  const handleAssignRole = async (e) => {
    e.preventDefault();
    if (!assignRoleId) return;
    try {
      await api.post(`/tenants/${tenantId}/users/${selectedUser.user_id}/roles`, { role_id: assignRoleId });
      setAssignRoleId('');
      await loadUserRoles(selectedUser.user_id);
      onRefresh();
    } catch (err) { alert(err.response?.data?.error?.message || 'Failed'); }
  };

  const handleRemoveRole = async (roleId) => {
    try {
      await api.delete(`/tenants/${tenantId}/users/${selectedUser.user_id}/roles/${roleId}`);
      await loadUserRoles(selectedUser.user_id);
      onRefresh();
    } catch (err) { alert(err.response?.data?.error?.message || 'Failed'); }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteMsg({ type: '', text: '' }); setInviting(true);
    try {
      const { data } = await api.post('/auth/invite', { email: inviteEmail, password: invitePassword, role_id: inviteRoleId });
      setInviteMsg({ type: 'success', text: `User "${data.user.email}" created with role "${data.user.role}"` });
      setInviteEmail(''); setInvitePassword(''); setInviteRoleId('');
      onRefresh();
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.response?.data?.error?.message || 'Failed to create user' });
    } finally { setInviting(false); }
  };

  const unassigned = roles.filter(r => !userRoles.find(ur => ur.role_id === r.role_id));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedUser ? '1fr 1fr' : '1fr', gap: 24 }}>
      <div>
        {/* Invite User Form */}
        <div style={s.formCard}>
          <p style={s.sectionTitle}>➕ Create User</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: -8, marginBottom: 14 }}>
            Create a non-admin user with a specific role. They can log in and test RBAC via the "Try It" tab.
          </p>
          <form onSubmit={handleInvite} style={{ ...s.inlineForm, flexWrap: 'wrap' }}>
            <div style={s.formField}>
              <label style={s.label}>Email</label>
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="user@example.com" required type="email" style={s.input} />
            </div>
            <div style={s.formField}>
              <label style={s.label}>Password</label>
              <input value={invitePassword} onChange={e => setInvitePassword(e.target.value)} placeholder="min 8 chars" required type="password" style={s.input} />
            </div>
            <div style={s.formField}>
              <label style={s.label}>Role</label>
              <select value={inviteRoleId} onChange={e => setInviteRoleId(e.target.value)} required style={s.input}>
                <option value="">Select role…</option>
                {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
              </select>
            </div>
            <button type="submit" disabled={inviting} style={s.btnPrimary}>{inviting ? 'Creating…' : 'Create User'}</button>
          </form>
          {inviteMsg.text && <p style={inviteMsg.type === 'error' ? s.errorMsg : s.successMsg}>{inviteMsg.text}</p>}
        </div>

        <p style={{ ...s.sectionTitle, marginTop: 20 }}>Users ({users.length}) — click to manage roles</p>
        {users.length === 0 ? <p style={{ color: '#6b7280' }}>No users found.</p> : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead><tr>{['Email', 'Roles', 'Joined'].map(c => <th key={c} style={s.th}>{c}</th>)}</tr></thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.user_id} onClick={() => selectUser(u)}
                    style={{ ...i % 2 === 0 ? {} : { background: '#f9fafb' }, cursor: 'pointer', ...(selectedUser?.user_id === u.user_id ? { background: '#e0e7ff' } : {}) }}>
                    <td style={s.td}>{u.email}</td>
                    <td style={s.td}>{(u.roles || []).join(', ') || '—'}</td>
                    <td style={s.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedUser && (
        <div>
          <div style={s.formCard}>
            <p style={s.sectionTitle}>Roles for: <span style={{ color: '#4f46e5' }}>{selectedUser.email}</span></p>
            <form onSubmit={handleAssignRole} style={s.inlineForm}>
              <div style={s.formField}>
                <label style={s.label}>Assign Role</label>
                <select value={assignRoleId} onChange={e => setAssignRoleId(e.target.value)} style={s.input}>
                  <option value="">Select role…</option>
                  {unassigned.map(r => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
                </select>
              </div>
              <button type="submit" style={s.btnPrimary}>Assign</button>
            </form>
            <div style={{ marginTop: 16 }}>
              {userRoles.length === 0 ? <p style={{ color: '#6b7280', fontSize: 13 }}>No roles assigned.</p> : userRoles.map(r => (
                <div key={r.role_id} style={s.permRow}>
                  <span style={{ fontWeight: 500 }}>{r.role_name}</span>
                  <button onClick={() => handleRemoveRole(r.role_id)} style={s.btnDanger}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit Tab ─────────────────────────────────────────────────────────────────
function AuditTab({ logs }) {
  if (logs.length === 0) return <p style={{ color: '#6b7280' }}>No audit logs found.</p>;
  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead><tr>{['Time', 'Resource', 'Action', 'Decision'].map(c => <th key={c} style={s.th}>{c}</th>)}</tr></thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={l.log_id || i} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
              <td style={s.td}>{new Date(l.timestamp || l.created_at).toLocaleString()}</td>
              <td style={s.td}><code style={s.code}>{l.resource}</code></td>
              <td style={s.td}>{l.action}</td>
              <td style={s.td}><span style={{ color: l.decision === 'ALLOW' ? '#059669' : '#dc2626', fontWeight: 600 }}>{l.decision}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Try It Tab — RBAC in Action ───────────────────────────────────────────────
const DEMO_ACTIONS = [
  { label: '📄 Read Files',      method: 'get',    url: '/resources/files',      desc: 'files/* : READ' },
  { label: '➕ Create File',     method: 'post',   url: '/resources/files',      body: { name: 'demo-file.txt' }, desc: 'files/* : CREATE' },
  { label: '🗑️ Delete File',    method: 'delete', url: '/resources/files',      desc: 'files/* : DELETE', seedId: '1', createBody: { name: 'temp.txt' }, createKey: 'file' },
  { label: '📊 Read Reports',    method: 'get',    url: '/resources/reports',    desc: 'reports/* : READ' },
  { label: '➕ Create Report',   method: 'post',   url: '/resources/reports',    body: { title: 'Demo Report' }, desc: 'reports/* : CREATE' },
  { label: '🗑️ Delete Report',  method: 'delete', url: '/resources/reports',    desc: 'reports/* : DELETE', seedId: '1', createBody: { title: 'Temp Report' }, createKey: 'report' },
  { label: '⚙️ Read Settings',  method: 'get',    url: '/resources/settings',   desc: 'settings : READ' },
  { label: '✏️ Update Settings', method: 'put',    url: '/resources/settings',   body: { org_name: 'Updated Org' }, desc: 'settings : UPDATE' },
];

function TryItTab({ user }) {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  const tryAction = async (action, idx) => {
    setLoading(l => ({ ...l, [idx]: true }));
    try {
      let res;
      if (action.method === 'delete' && action.seedId) {
        // Try deleting the seed item first
        try {
          res = await api.delete(`${action.url}/${action.seedId}`);
        } catch (err) {
          if (err.response?.status === 404) {
            // Seed item gone — create a fresh one then delete it
            const created = await api.post(action.url, action.createBody);
            const newId = created.data[action.createKey]?.id;
            res = await api.delete(`${action.url}/${newId}`);
          } else {
            throw err; // 403 or other — let it bubble up as DENY
          }
        }
      } else if (action.method === 'get') res = await api.get(action.url);
      else if (action.method === 'post') res = await api.post(action.url, action.body || {});
      else if (action.method === 'put') res = await api.put(action.url, action.body || {});
      else if (action.method === 'delete') res = await api.delete(action.url);
      setResults(r => ({ ...r, [idx]: { ok: true, status: res.status } }));
    } catch (err) {
      const status = err.response?.status;
      setResults(r => ({ ...r, [idx]: { ok: false, status, msg: err.response?.data?.error?.message || 'Error' } }));
    } finally {
      setLoading(l => ({ ...l, [idx]: false }));
    }
  };

  return (
    <div>
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
        <p style={{ margin: 0, fontSize: 14, color: '#1e40af' }}>
          <strong>How this works:</strong> You are logged in as <strong>{user?.email}</strong> with role <strong>{user?.role}</strong>.
          Each button calls a real API endpoint protected by RBAC. If your role has the required permission → <span style={{ color: '#059669', fontWeight: 600 }}>ALLOW</span>.
          If not → <span style={{ color: '#dc2626', fontWeight: 600 }}>DENY (403)</span>.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {DEMO_ACTIONS.map((action, idx) => {
          const result = results[idx];
          const busy = loading[idx];
          return (
            <div key={idx} style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{action.label}</p>
                <code style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{action.desc}</code>
              </div>
              <button
                onClick={() => tryAction(action, idx)}
                disabled={busy}
                style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, opacity: busy ? 0.7 : 1 }}
              >
                {busy ? 'Calling…' : 'Try It'}
              </button>
              {result && (
                <div style={{ borderRadius: 6, padding: '8px 12px', background: result.ok ? '#d1fae5' : '#fee2e2', color: result.ok ? '#065f46' : '#991b1b', fontSize: 13, fontWeight: 600 }}>
                  {result.ok
                    ? `✅ ALLOW (${result.status})`
                    : `❌ DENY — ${result.status === 403 ? '403 Forbidden' : result.status || 'Error'}`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }) {
  return (
    <div style={{ ...s.card, borderTop: `4px solid ${color}` }}>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color }}>{value}</p>
    </div>
  );
}

function SimpleTable({ columns, rows }) {
  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead><tr>{columns.map(c => <th key={c} style={s.th}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => (
          <tr key={i} style={i % 2 === 0 ? {} : { background: '#f9fafb' }}>
            {row.map((cell, j) => <td key={j} style={s.td}>{cell}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function actionColor(action) {
  const map = { CREATE: { background: '#d1fae5', color: '#065f46' }, READ: { background: '#dbeafe', color: '#1e40af' }, UPDATE: { background: '#fef3c7', color: '#92400e' }, DELETE: { background: '#fee2e2', color: '#991b1b' }, SHARE: { background: '#ede9fe', color: '#5b21b6' } };
  return map[action] || {};
}

const s = {
  layout: { display: 'flex', minHeight: '100vh' },
  sidebar: { width: 220, background: '#1a1a2e', color: '#fff', display: 'flex', flexDirection: 'column', padding: '24px 16px', flexShrink: 0 },
  logo: { fontSize: 18, fontWeight: 700, color: '#a5b4fc', marginBottom: 28 },
  nav: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  navBtn: { background: 'transparent', color: '#9ca3af', textAlign: 'left', padding: '10px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14 },
  navBtnActive: { background: '#4f46e5', color: '#fff' },
  userInfo: { borderTop: '1px solid #374151', paddingTop: 16 },
  userEmail: { fontSize: 12, color: '#9ca3af', marginBottom: 2, wordBreak: 'break-all' },
  userRole: { fontSize: 11, color: '#6b7280', marginBottom: 12 },
  logoutBtn: { background: '#374151', color: '#d1d5db', width: '100%', padding: '8px', border: 'none', borderRadius: 6, cursor: 'pointer' },
  main: { flex: 1, padding: '32px 40px', overflowY: 'auto', background: '#f8fafc' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  pageTitle: { fontSize: 22, fontWeight: 700, margin: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 20 },
  card: { background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  formCard: { background: '#fff', borderRadius: 10, padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  sectionTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 14px 0', color: '#111827' },
  inlineForm: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' },
  formField: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160 },
  label: { fontSize: 13, fontWeight: 500, color: '#374151' },
  input: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, outline: 'none' },
  btnPrimary: { background: '#4f46e5', color: '#fff', padding: '9px 18px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' },
  btnDanger: { background: '#fee2e2', color: '#dc2626', padding: '5px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  errorMsg: { color: '#dc2626', fontSize: 13, marginTop: 8 },
  successMsg: { color: '#059669', fontSize: 13, marginTop: 8 },
  tableWrap: { background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '11px 16px', fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', textTransform: 'uppercase', letterSpacing: '0.05em' },
  td: { padding: '11px 16px', fontSize: 14, borderBottom: '1px solid #f3f4f6' },
  code: { background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: 13, fontFamily: 'monospace' },
  actionBadge: { padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  permRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' },
};
