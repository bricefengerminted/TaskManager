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

/**
 * Convert an https://…slack.com URL to a slack:// deep link so the OS
 * routes it to whatever app handles the Slack protocol (Rambox, native
 * Slack, etc.) and navigates straight to the conversation.
 */
function toSlackDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url);

    // https://app.slack.com/client/T0ABC1234/C0ABC5678
    const clientMatch = parsed.pathname.match(
      /^\/client\/(T[A-Z0-9]+)\/([A-Z0-9]+)/i,
    );
    if (clientMatch) {
      const [, team, id] = clientMatch;
      if (id.startsWith('C')) return `slack://channel?team=${team}&id=${id}`;
      if (id.startsWith('D')) return `slack://user?team=${team}&id=${id}`;
      return `slack://channel?team=${team}&id=${id}`;
    }

    // https://workspace.slack.com/archives/C0ABC5678[/p1234567890]
    const archiveMatch = parsed.pathname.match(
      /^\/archives\/([A-Z0-9]+)/i,
    );
    if (archiveMatch) {
      const id = archiveMatch[1];
      return `slack://channel?id=${id}`;
    }

    return null;
  } catch {
    return null;
  }
}

// Open a Slack URL in Rambox instead of the default browser
app.post('/api/open-url', (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  // Only allow Slack URLs through this endpoint
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('slack.com')) {
      return res.status(400).json({ error: 'Only Slack URLs are supported' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Convert to a slack:// deep link when possible so Rambox (or the
  // native Slack app) navigates to the actual conversation.
  const deepLink = toSlackDeepLink(url);
  const targetUrl = deepLink || url;
  const safeUrl = targetUrl.replace(/'/g, "'\\''");

  const isMac = process.platform === 'darwin';
  // On macOS: focus Rambox first, then open the deep link so the OS
  //           routes it to the registered slack:// handler.
  // On Linux: xdg-open will route slack:// to the registered handler.
  const cmd = isMac
    ? `open -a Rambox && open '${safeUrl}'`
    : `xdg-open '${safeUrl}'`;

  exec(cmd, (err) => {
    if (err) {
      console.error('Failed to open Slack link:', err.message);
      return res.status(500).json({ error: 'Failed to open Slack link', detail: err.message });
    }
    res.json({ ok: true, deepLink: !!deepLink });
  });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`TaskManager API running on http://localhost:${PORT}`);
});

export default app;
