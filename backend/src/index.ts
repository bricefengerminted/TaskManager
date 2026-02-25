import express from 'express';
import cors from 'cors';
import path from 'path';
import { exec } from 'child_process';
import { runMigrations } from './db/migrate';
import projectsRouter from './routes/projects';
import tasksRouter from './routes/tasks';
import dashboardRouter from './routes/dashboard';
import uploadsRouter from './routes/uploads';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Run migrations on startup
runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:projectId/tasks', tasksRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/uploads', uploadsRouter);

// ── Slack navigation via Rambox ────────────────────────────────────
// Rambox doesn't expose its webviews externally, so we use a polling
// approach: a small JS snippet injected into Rambox's Slack service
// polls GET /api/slack-nav for pending URLs and navigates internally.
let pendingSlackUrl: string | null = null;

// Called by the TaskManager frontend when user clicks a Slack link
app.post('/api/open-url', (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('slack.com')) {
      return res.status(400).json({ error: 'Only Slack URLs are supported' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Store the URL for the Rambox Slack webview to pick up
  pendingSlackUrl = url;
  console.log('Queued Slack URL for Rambox:', url);

  // Also bring Rambox to the foreground
  if (process.platform === 'darwin') {
    exec(`open -a Rambox`, (err) => {
      if (err) console.error('Failed to focus Rambox:', err.message);
    });
  }

  res.json({ ok: true });
});

// Polled by the JS snippet running inside Rambox's Slack webview
app.get('/api/slack-nav', (_req, res) => {
  if (pendingSlackUrl) {
    const url = pendingSlackUrl;
    pendingSlackUrl = null;
    return res.json({ url });
  }
  res.json({ url: null });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`TaskManager API running on http://localhost:${PORT}`);
});

export default app;
