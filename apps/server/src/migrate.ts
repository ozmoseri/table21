import { migrate } from './db.ts';
import { openDb } from './main.ts';

const db = await openDb();
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await db.close();
