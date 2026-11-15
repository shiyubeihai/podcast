/**
 * dev-server.mjs — 本地试听用
 *
 * 作用：
 *   1. 把当前目录当静态站点发出去（http://localhost:8787）
 *   2. 提供 /api/resolve，让页面里可以直接贴链接、当场换地址、当场播放
 *
 * 用法：bun dev-server.mjs
 *
 * 注意：这只是本地开发用。GitHub Pages 是静态的，没有这个接口，
 *      线上加新的一集仍然是改 links.txt。
 */

import { fetchEpisode, getToken, writeSnapshot } from './resolve.mjs';

const ROOT = import.meta.dir;
const PORT = Number(process.env.PORT) || 8787;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

async function readLib() {
  try {
    const lib = await Bun.file(`${ROOT}/library.json`).json();
    if (lib && Array.isArray(lib.items)) return lib;
  } catch (e) {}
  return { schema: 1, updatedAt: new Date().toISOString(), count: 0, failed: 0, items: [] };
}

async function addLink(url, album) {
  const token = getToken(url);
  if (!token) {
    const err = new Error('认不出这个链接，需要豆包播客分享链接');
    err.status = 400;
    throw err;
  }

  const ep = await fetchEpisode(token);

  const lib = await readLib();
  const items = (lib.items || []).filter((x) => x && x.id !== token);
  const item = { ...ep, album: album || '未分组', link: url };
  items.unshift(item);

  const libOut = {
    schema: 1,
    updatedAt: new Date().toISOString(),
    count: items.length,
    failed: items.filter((x) => !x.ok).length,
    items
  };

  await Bun.write(`${ROOT}/library.json`, JSON.stringify(libOut, null, 2) + '\n');
  await writeSnapshot(`${ROOT}/index.html`, libOut);

  // 同步写回 links.txt，避免下次跑 resolve.mjs 时丢掉刚加的这一条（或丢掉专辑名）
  const text = await Bun.file(`${ROOT}/links.txt`).text().catch(() => '');
  const line = (album ? album + ' | ' : '') + (url || `https://www.doubao.com/podcast/${token}`);
  const lines = text.split(/\r?\n/);

  const isComment = (l) => l.trim().startsWith('#');
  const hit = lines.some((l) => !isComment(l) && l.includes(token));

  if (!hit) {
    await Bun.write(`${ROOT}/links.txt`, line + '\n' + text);
  } else if (album) {
    const next = lines
      .map((l) => (!isComment(l) && l.includes(token) ? line : l))
      .join('\n');
    await Bun.write(`${ROOT}/links.txt`, next);
  }

  return item;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const u = new URL(req.url);

    if (u.pathname === '/api/resolve') {
      if (req.method === 'GET') return json({ dev: true });
      if (req.method !== 'POST') return json({ error: '只支持 POST' }, 405);

      let body;
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: '请求格式不对' }, 400);
      }

      try {
        const item = await addLink(String(body.url || '').trim(), String(body.album || '').trim());
        console.log(`  + ${item.title} · ${Math.round(item.duration / 60)} 分`);
        return json({ ok: true, item });
      } catch (err) {
        console.log(`  ! ${err.message}`);
        return json({ error: err.message || String(err) }, err.status || 502);
      }
    }

    // 静态文件
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const file = Bun.file(ROOT + p);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });

    const headers = {};
    if (/\.(html|js|mjs|json|txt)$/.test(p)) headers['cache-control'] = 'no-store';
    return new Response(file, { headers });
  }
});

console.log(`\n播客台 本地服务：http://localhost:${PORT}`);
console.log('页面右上角 ＋ 可以直接贴链接（线上版没有这个功能）\n');
