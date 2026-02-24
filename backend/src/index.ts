import express from 'express';
import cors from 'cors';
import path from 'path';
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

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`TaskManager API running on http://localhost:${PORT}`);
});

export default app;
