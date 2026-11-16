/**
 * resolve.mjs — 把豆包分享链接换成带签名的音频地址
 *
 * 输入：links.txt（一行一个链接，可写「专辑名 | 链接」）
 * 输出：library.json（播放器读这个文件）
 *
 * 用法：bun resolve.mjs
 *
 * 说明：豆包分享页的音频地址是页面打开时由接口实时生成的，带签名，约 7 天过期。
 * 浏览器跨域读不到那个接口，所以必须由脚本（本机或 GitHub Actions）去换。
 */

const API =
  'https://www.doubao.com/api/doubao/do_action_v2?aid=497858&version_code=20800';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HERE = import.meta.dir;
const LINKS = `${HERE}/links.txt`;
const OUT = `${HERE}/library.json`;
const HTML = `${HERE}/index.html`;

/**
 * 把清单内嵌进 index.html。
 * 这样双击打开 html（file:// 下 fetch 被浏览器禁掉）也能读到最后一次生成的清单。
 */
export async function writeSnapshot(htmlPath, lib) {
  try {
    const html = await Bun.file(htmlPath).text();
    const start = '<script id="lib-snapshot" type="application/json">';
    const i = html.indexOf(start);
    if (i < 0) return false;
    const j = html.indexOf('</script>', i);
    if (j < 0) return false;

    const next = html.slice(0, i + start.length) + JSON.stringify(lib) + html.slice(j);
    await Bun.write(htmlPath, next);
    return true;
  } catch (e) {
    return false;
  }
}

function log(...a) {
  console.log(...a);
}

/* ---------- 读 links.txt ---------- */

export function readLinks(text) {
  const out = [];
  const seen = new Set();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // 支持三种写法：
    //   链接
    //   专辑名 | 链接
    //   专辑名 | 标题 | 链接
    // 链接留空（或写 -）表示占位：先占住编号，等拿到链接再补
    const parts = line.split('|').map((s) => s.trim());
    let album = '';
    let title = '';
    let link = '';

    if (parts.length >= 3) {
      album = parts[0];
      title = parts.slice(1, -1).join(' | ');
      link = parts[parts.length - 1];
    } else if (parts.length === 2) {
      album = parts[0];
      link = parts[1];
    } else {
      link = parts[0];
    }

    if (!link || link === '-' || link === '待补') {
      if (!title) {
        log(`  跳过（没有链接也没有标题）：${line.slice(0, 80)}`);
        continue;
      }
      out.push({ token: '', album, title, link: '', pending: true });
      continue;
    }

    const token = getToken(link);
    if (!token) {
      log(`  跳过（认不出链接）：${line.slice(0, 80)}`);
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);

    out.push({ token, album, title, link });
  }
  return out;
}

export function getToken(link) {
  try {
    const u = new URL(link);
    const m = u.pathname.match(/\/podcast\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];
    const q = u.searchParams.get('token') || u.searchParams.get('share_token');
    if (q && /^[A-Za-z0-9_-]{6,}$/.test(q)) return q;
    // 只贴了一串 id 也认
    if (/^[A-Za-z0-9_-]{6,}$/.test(link.trim())) return link.trim();
  } catch (e) {
    if (/^[A-Za-z0-9_-]{6,}$/.test(String(link).trim())) return String(link).trim();
  }
  return '';
}

/* ---------- 调豆包接口 ---------- */

export async function fetchEpisode(token) {
  const body = JSON.stringify({
    scene: 'FPA_Podcast',
    payload: JSON.stringify({
      api_name: 'GetShareDeepResearchPodcast',
      params: JSON.stringify({ share_token: token })
    })
  });

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'User-Agent': UA,
          Referer: `https://www.doubao.com/podcast/${token}`
        },
        body,
        signal: AbortSignal.timeout(25000)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (json?.success === false) {
        throw new Error(json?.data?.resp ? '接口返回失败' : '接口返回失败');
      }

      const inner = JSON.parse(json.data.resp);
      if (inner.code) throw new Error(`${inner.code} ${inner.msg || ''}`.trim());

      const ep = inner.episode;
      if (!ep) throw new Error('没有 episode 数据');
      if (inner.podcast_gen_status !== 3) throw new Error('还在生成中，稍后再试');

      const meta = ep.meta || {};
      const pm = meta.playback_model || {};
      if (!pm.audio_link) throw new Error('没有音频地址');

      const expires = Number(new URL(pm.audio_link).searchParams.get('x-expires')) || 0;

      return {
        id: token,
        title: meta.title || `未命名 ${token.slice(0, 6)}`,
        duration: Number(pm.duration) || 0,
        audio: pm.audio_link,
        cover: meta.cover_link || '',
        expires,
        ok: true
      };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/* ---------- 主流程 ---------- */

async function main() {
  const linksText = await Bun.file(LINKS).text().catch(() => '');
  const links = readLinks(linksText);

  if (!links.length) {
    log('links.txt 里没有可用链接，写出空清单');
  }

  // 读旧清单：刷新失败时，旧的链接如果还没过期就继续用
  let old = new Map();
  try {
    const prev = await Bun.file(OUT).json();
    for (const it of prev.items || []) old.set(it.id, it);
  } catch (e) {}

  const items = [];
  let failed = 0;

  for (const l of links) {
    if (l.pending) {
      items.push({
        id: 'pending:' + (l.title || l.album),
        title: l.title,
        album: l.album || '未分组',
        duration: 0,
        audio: '',
        cover: '',
        expires: 0,
        ok: false,
        pending: true,
        link: ''
      });
      log(`  … ${l.title}（待补链接）`);
      continue;
    }

    const label = `${l.token.slice(0, 8)}…`;

    // 还有 3 天以上有效期就沿用旧地址，免得每天换签名让浏览器缓存全部作废
    const prev = old.get(l.token);
    if (prev && prev.ok && prev.audio && prev.expires * 1000 - Date.now() > 3 * 86400000) {
      const days = ((prev.expires * 1000 - Date.now()) / 86400000).toFixed(1);
      items.push({
        ...prev,
        title: l.title || prev.title,
        album: l.album || prev.album || '未分组',
        link: l.link
      });
      log(`  = ${label} ${l.title || prev.title} · 沿用旧地址（还有 ${days} 天）`);
      continue;
    }

    try {
      const ep = await fetchEpisode(l.token);
      if (l.title) ep.title = l.title;
      items.push({
        ...ep,
        album: l.album || '未分组',
        link: l.link
      });
      const days = ((ep.expires * 1000 - Date.now()) / 86400000).toFixed(1);
      log(`  ✓ ${label} ${ep.title} · ${Math.round(ep.duration / 60)} 分 · 有效期 ${days} 天`);
    } catch (err) {
      failed++;
      const prev = old.get(l.token);
      if (prev && prev.expires * 1000 > Date.now()) {
        items.push({
          ...prev,
          title: l.title || prev.title,
          album: l.album || prev.album || '未分组',
          link: l.link
        });
        log(`  ! ${label} 刷新失败（${err.message}），沿用上一次的地址`);
      } else {
        items.push({
          id: l.token,
          title: l.album ? `${l.album}（未取到）` : `未取到 ${l.token.slice(0, 6)}`,
          album: l.album || '未分组',
          duration: 0,
          audio: '',
          cover: '',
          expires: 0,
          ok: false,
          error: String(err.message || err),
          link: l.link
        });
        log(`  ✗ ${label} ${err.message}`);
      }
    }
  }

  const out = {
    schema: 1,
    updatedAt: new Date().toISOString(),
    count: items.length,
    failed,
    items
  };

  await Bun.write(OUT, JSON.stringify(out, null, 2) + '\n');
  const ok = await writeSnapshot(HTML, out);
  log(`\n写出 library.json：${items.length} 集，失败 ${failed} 集`);
  log(ok ? '已把清单内嵌进 index.html，双击就能听' : '（没能内嵌 index.html，双击模式下会读不到清单）');
}

if (import.meta.main) main().catch((err) => {
  console.error('整体失败：', err);
  process.exit(1);
});
