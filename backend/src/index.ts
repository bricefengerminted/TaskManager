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

// Open a Slack link directly in Rambox
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

  // Use AppleScript to tell Rambox to open the URL — this activates Rambox
  // and uses its internal URL routing to navigate to the Slack conversation.
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const isMac = process.platform === 'darwin';
  const cmd = isMac
    ? `osascript -e 'tell application "Rambox" to activate' -e 'tell application "Rambox" to open location "${safeUrl}"'`
    : `xdg-open '${url.replace(/'/g, "'\\''")}'`;

  exec(cmd, (err) => {
    if (err) {
      console.error('Failed to open Slack link:', err.message);
      return res.status(500).json({ error: 'Failed to open Slack link', detail: err.message });
    }
    res.json({ ok: true });
  });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`TaskManager API running on http://localhost:${PORT}`);
});

export default app;
