import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { projects, tasks } from './schema';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../taskmanager.db');

const client = createClient({ url: `file:${DB_PATH}` });

export const db = drizzle(client, { schema: { projects, tasks } });
export { client };
