/**
 * Demo Resource Routes
 *
 * These routes simulate a real application protected by RBAC.
 * Each endpoint requires a specific permission — the PDP middleware
 * enforces it. This is how RBAC works in practice.
 *
 * Resources: files, reports, settings
 * Actions: CREATE, READ, UPDATE, DELETE
 */

const express = require('express');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Simulated in-memory data per tenant (resets on server restart — demo only)
const tenantData = {};

function getTenantStore(tenantId) {
  if (!tenantData[tenantId]) {
    tenantData[tenantId] = {
      files: [
        { id: '1', name: 'Q1-Report.pdf', size: '2.4 MB', created_at: new Date('2026-01-10').toISOString() },
        { id: '2', name: 'Budget-2026.xlsx', size: '1.1 MB', created_at: new Date('2026-02-01').toISOString() },
        { id: '3', name: 'Architecture.png', size: '800 KB', created_at: new Date('2026-03-05').toISOString() },
      ],
      reports: [
        { id: '1', title: 'Monthly Sales', status: 'published', created_at: new Date('2026-01-15').toISOString() },
        { id: '2', title: 'User Analytics', status: 'draft', created_at: new Date('2026-02-20').toISOString() },
      ],
      settings: {
        org_name: 'My Organization',
        timezone: 'UTC',
        max_users: 50,
      },
    };
  }
  return tenantData[tenantId];
}

// ── FILES ────────────────────────────────────────────────────────────────────

router.get('/files',
  ...requirePermission('files/*', 'READ'),
  asyncHandler(async (req, res) => {
    const store = getTenantStore(req.user.tenant_id);
    res.json({ files: store.files, count: store.files.length });
  })
);

router.post('/files',
  ...requirePermission('files/*', 'CREATE'),
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name is required' } });
    const store = getTenantStore(req.user.tenant_id);
    const file = { id: String(Date.now()), name, size: '0 KB', created_at: new Date().toISOString() };
    store.files.push(file);
    res.status(201).json({ file });
  })
);

router.put('/files/:id',
  ...requirePermission('files/*', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const store = getTenantStore(req.user.tenant_id);
    const file = store.files.find(f => f.id === req.params.id);
    if (!file) return res.status(404).json({ error: { message: 'File not found' } });
    if (req.body.name) file.name = req.body.name;
    res.json({ file });
  })
);

router.delete('/files/:id',
  ...requirePermission('files/*', 'DELETE'),
  asyncHandler(async (req, res) => {
    const store = getTenantStore(req.user.tenant_id);
    const idx = store.files.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: { message: 'File not found' } });
    store.files.splice(idx, 1);
    res.json({ success: true, message: 'File deleted' });
  })
);

// ── REPORTS ──────────────────────────────────────────────────────────────────

router.get('/reports',
  ...requirePermission('reports/*', 'READ'),
  asyncHandler(async (req, res) => {
    const store = getTenantStore(req.user.tenant_id);
    res.json({ reports: store.reports, count: store.reports.length });
  })
);

router.post('/reports',
  ...requirePermission('reports/*', 'CREATE'),
  asyncHandler(async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: { message: 'title is required' } });
    const store = getTenantStore(req.user.tenant_id);
    const report = { id: String(Date.now()), title, status: 'draft', created_at: new Date().toISOString() };
    store.reports.push(report);
    res.status(201).json({ report });
  })
);

router.delete('/reports/:id',
  ...requirePermission('reports/*', 'DELETE'),
  asyncHandler(async (req, res) => {
    const store = getTenantStore(req.user.tenant_id);
    const idx = store.reports.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: { message: 'Report not found' } });
    store.reports.splice(idx, 1);
    res.json({ success: true, message: 'Report deleted' });
  })
);

// ── SETTINGS ─────────────────────────────────────────────────────────────────

router.get('/settings',
  ...requirePermission('settings', 'READ'),
  asyncHandler(async (req, res) => {
    const store = getTenantStore(req.user.tenant_id);
    res.json({ settings: store.settings });
  })
);

router.put('/settings',
  ...requirePermission('settings', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const store = getTenantStore(req.user.tenant_id);
    const allowed = ['org_name', 'timezone', 'max_users'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) store.settings[key] = req.body[key];
    }
    res.json({ settings: store.settings });
  })
);

module.exports = router;
