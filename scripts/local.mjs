import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import app from '../dist/server/index.js';

const port = Number(process.env.PORT || 4173);
const host = '127.0.0.1';
const origin = 'http://' + host + ':' + port;
const directory = new URL('../.local/', import.meta.url);
mkdirSync(directory, { recursive: true });
const db = new DatabaseSync(new URL('gradebook.sqlite', directory));
db.exec('PRAGMA journal_mode=WAL');
if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gradebook_revisions'").get()) {
  db.exec(readFileSync(new URL('../drizzle/0000_gradebook_revisions.sql', import.meta.url), 'utf8'));
}
const DB = {
  prepare(sql) {
    const statement = db.prepare(sql);
    return { bind(...values) {
      return {
        first: async () => statement.get(...values),
        all: async () => ({ results: statement.all(...values) }),
        run: async () => ({ meta: statement.run(...values) })
      };
    } };
  }
};
createServer(async (incoming, outgoing) => {
  if (incoming.headers.host !== host + ':' + port || !incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
    outgoing.writeHead(403).end();
    return;
  }
  try {
    const headers = new Headers(incoming.headers);
    headers.set('oai-authenticated-user-id', 'local-owner');
    const init = { method: incoming.method, headers };
    if (!['GET','HEAD'].includes(incoming.method)) {
      init.body = Readable.toWeb(incoming);
      init.duplex = 'half';
    }
    const response = await app.fetch(new Request(origin + incoming.url, init), { DB }, { waitUntil() {} });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(port, host, () => console.log('English Gradebook: ' + origin));
