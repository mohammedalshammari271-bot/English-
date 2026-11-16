const MAX_INPUT = 8 * 1024 * 1024;
const MAX_COMPRESSED = 1_400_000;
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff'
};

function json(data, status = 200) {
  return Response.json(data, { status, headers });
}

function validGradebook(data) {
  const validClass = group => group && Array.isArray(group.rows)
    && typeof group.id === 'string'
    && (!group.periods || Array.isArray(group.periods)
      && group.periods.every(period => period && Array.isArray(period.rows)));
  return data && Array.isArray(data.classes) && data.classes.every(validClass)
    && (!data.archives || Array.isArray(data.archives)
      && data.archives.every(year => year && Array.isArray(year.classes) && year.classes.every(validClass)));
}

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  }
  return btoa(binary);
}

async function encode(data) {
  const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytes.length > MAX_COMPRESSED ? null : base64(bytes);
}

async function decode(row) {
  if (!row) return { revision: 0, savedAt: null, data: null };
  const bytes = Uint8Array.from(atob(row.content), char => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return { revision: row.revision, savedAt: row.saved_at, data: await new Response(stream).json() };
}

function current(db, owner) {
  return db.prepare('SELECT revision, saved_at, content FROM gradebook_revisions WHERE owner_id = ? ORDER BY revision DESC LIMIT 1')
    .bind(owner).first();
}

async function readBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_INPUT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try { return await new Blob(chunks, { type:'application/json' }).text().then(JSON.parse); }
  catch { return null; }
}

async function save(request, db, owner, ctx) {
  if (request.headers.get('origin') !== new URL(request.url).origin
      || !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) {
    return json({ error: 'invalid_origin' }, 403);
  }
  const body = await readBody(request);
  if (!body || body.account !== owner || !Number.isSafeInteger(body.revision) || body.revision < 0 || !validGradebook(body.data)) {
    return json({ error: 'invalid_gradebook' }, 400);
  }
  const content = await encode(body.data);
  if (!content) return json({ error: 'gradebook_too_large' }, 413);
  const savedAt = new Date().toISOString();
  // Insertion and revision comparison execute in a single SQLite statement.
  const result = await db.prepare(`
    INSERT INTO gradebook_revisions (owner_id, revision, saved_at, content)
    SELECT ?, ?, ?, ?
    WHERE ? = COALESCE((SELECT MAX(revision) FROM gradebook_revisions WHERE owner_id = ?), 0)
  `).bind(owner, body.revision + 1, savedAt, content, body.revision, owner).run();
  if (!result.meta.changes) return json(await decode(await current(db, owner)), 409);
  ctx.waitUntil(db.prepare(`
    DELETE FROM gradebook_revisions
    WHERE owner_id = ? AND revision < ?
      AND revision NOT IN (
        SELECT MAX(revision) FROM gradebook_revisions
        WHERE owner_id = ? AND saved_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
        GROUP BY substr(saved_at, 1, 10)
      )
  `).bind(owner, body.revision + 1 - 29, owner).run().catch(() => {}));
  return json({ revision: body.revision + 1, savedAt });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return json({ error: 'sign_in_required' }, 401);
    if (request.method === 'GET' && Object.hasOwn(assets, path)) {
      const [type, content, binary] = assets[path];
      const body = binary ? Uint8Array.from(atob(content), char => char.charCodeAt(0)) : content;
      return new Response(body, { headers: { ...headers, 'Content-Type': type } });
    }
    if (path === '/api/gradebook' || path.startsWith('/api/gradebook/')) {
      try {
        if (path === '/api/gradebook' && request.method === 'GET') {
          return json({ account: owner, ...await decode(await current(env.DB, owner)) });
        }
        if (path === '/api/gradebook' && request.method === 'PUT') return await save(request, env.DB, owner, ctx);
        if (path === '/api/gradebook/history' && request.method === 'GET') {
          const { results } = await env.DB.prepare(`
            SELECT revision, saved_at AS savedAt FROM gradebook_revisions WHERE owner_id = ? ORDER BY revision DESC LIMIT 64
          `).bind(owner).all();
          return json({ versions: results });
        }
        const version = /^\/api\/gradebook\/history\/(\d+)$/.exec(path);
        if (version && request.method === 'GET') {
          const row = await env.DB.prepare('SELECT revision, saved_at, content FROM gradebook_revisions WHERE owner_id = ? AND revision = ?')
            .bind(owner, Number(version[1])).first();
          return row ? json(await decode(row)) : json({ error: 'version_missing' }, 404);
        }
      } catch {
        return json({ error: 'storage_unavailable' }, 503);
      }
    }
    return json({ error: 'not_found' }, 404);
  }
};
