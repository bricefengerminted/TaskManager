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
 * Convert https://…slack.com URL → slack:// deep link.
 * e.g. https://minted.slack.com/archives/D099AL64BCJ/p1771953727946249
 *    → slack://channel?id=D099AL64BCJ&message=1771953727.946249
 */
function toSlackDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url);

    // https://app.slack.com/client/TEAM/CHANNEL_OR_DM
    const clientMatch = parsed.pathname.match(
      /^\/client\/(T[A-Z0-9]+)\/([A-Z0-9]+)/i,
    );
    if (clientMatch) {
      const [, team, id] = clientMatch;
      return `slack://channel?team=${team}&id=${id}`;
    }

    // https://workspace.slack.com/archives/CHANNEL[/pTIMESTAMP]
    const archiveMatch = parsed.pathname.match(
      /^\/archives\/([A-Z0-9]+)(?:\/p(\d+))?/i,
    );
    if (archiveMatch) {
      const id = archiveMatch[1];
      const msgTs = archiveMatch[2];
      let link = `slack://channel?id=${id}`;
      if (msgTs) {
        const ts = msgTs.slice(0, 10) + '.' + msgTs.slice(10);
        link += `&message=${ts}`;
      }
      return link;
    }

    return null;
  } catch {
    return null;
  }
}

// Open a Slack link in Rambox
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

  // Convert https:// Slack URL to slack:// deep link
  const deepLink = toSlackDeepLink(url);
  const targetUrl = deepLink || url;
  const safeUrl = targetUrl.replace(/'/g, "'\\''");

  const isMac = process.platform === 'darwin';
  // Use open -a to force the slack:// deep link to open in Rambox
  // specifically, bypassing the native Slack app's protocol handler.
  const cmd = isMac
    ? `open -a Rambox '${safeUrl}'`
    : `xdg-open '${safeUrl}'`;

  console.log('Executing:', cmd);
  console.log('Original URL:', url);
  console.log('Deep link:', targetUrl);

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to open Slack link:', err.message);
      console.error('stderr:', stderr);
      return res.status(500).json({ error: 'Failed to open Slack link', detail: err.message, stderr });
    }
    console.log('Success. stdout:', stdout, 'stderr:', stderr);
    res.json({ ok: true });
  });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`TaskManager API running on http://localhost:${PORT}`);
});

export default app;
