import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ org_name: '', admin_email: '', admin_password: '', confirm_password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.admin_password !== form.confirm_password) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/register', {
        org_name: form.org_name,
        admin_email: form.admin_email,
        admin_password: form.admin_password,
      });
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Create Organization</h1>
        <p style={styles.subtitle}>Set up your RBAC workspace</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Organization Name</label>
            <input
              type="text"
              value={form.org_name}
              onChange={set('org_name')}
              placeholder="Acme Corp"
              required
              autoFocus
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Admin Email</label>
            <input
              type="email"
              value={form.admin_email}
              onChange={set('admin_email')}
              placeholder="admin@acme.com"
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={form.admin_password}
              onChange={set('admin_password')}
              placeholder="Min 8 characters"
              required
              minLength={8}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Confirm Password</label>
            <input
              type="password"
              value={form.confirm_password}
              onChange={set('confirm_password')}
              placeholder="Repeat password"
              required
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? 'Creating…' : 'Create Organization'}
          </button>
        </form>
        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
  },
  title: { fontSize: 26, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 },
  subtitle: { color: '#6b7280', fontSize: 14, marginBottom: 28 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: '#374151' },
  btn: { background: '#4f46e5', color: '#fff', padding: '12px', fontSize: 15, marginTop: 4 },
  footer: { textAlign: 'center', marginTop: 20, fontSize: 14, color: '#6b7280' },
  link: { color: '#4f46e5', textDecoration: 'none', fontWeight: 500 },
};
