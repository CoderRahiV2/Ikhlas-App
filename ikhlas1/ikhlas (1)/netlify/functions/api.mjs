import { getStore } from "@netlify/blobs";
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
export const config = { path: "/api/*" };

export default async (req) => {
  const p = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/");
  const m = req.method, q = new URL(req.url).searchParams;
  const db = getStore("ikhlas"), files = getStore("files"), dur = getStore("durood");
  const env = process.env;
  const admin = !!env.ADMIN_PASSWORD && req.headers.get("x-admin") === env.ADMIN_PASSWORD;
  const need = () => (admin ? null : J({ error: "অ্যাডমিন পাসওয়ার্ড ভুল" }, 401));
  const get = async (k, d) => (await db.get(k, { type: "json" })) ?? d;
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  const d = new Date(Date.now() + 6 * 36e5); // Dhaka time
  const day = (x) => Math.floor(x / 864e5);
  const wk = () => { const t = new Date(d); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 2) % 7)); return t.toISOString().slice(0, 10); };

  // ---- login ----
  if (p[0] === "login" && m === "POST") {
    const b = await body();
    if (!env.GROUP_CODE) return J({ error: "GROUP_CODE সেট করা হয়নি" }, 500);
    return b.code === env.GROUP_CODE && b.name?.trim() ? J({ ok: true }) : J({ error: "গ্রুপ কোড ভুল" }, 401);
  }
  // ---- books ----
  if (p[0] === "books") {
    if (m === "GET") return J(await get("books", []));
    if (m === "POST") {
      if (need()) return need();
      const b = await body(), list = await get("books", []);
      list.unshift({ id: b.id, title: b.title, author: b.author, cat: b.cat, cover: b.cover, chunks: b.chunks, size: b.size, at: Date.now() });
      await db.setJSON("books", list); return J({ ok: true });
    }
    if (m === "DELETE") {
      if (need()) return need();
      const list = await get("books", []), bk = list.find((x) => x.id === p[1]);
      if (bk) for (let i = 0; i < bk.chunks; i++) await files.delete(`${bk.id}/${i}`);
      await db.setJSON("books", list.filter((x) => x.id !== p[1])); return J({ ok: true });
    }
  }
  if (p[0] === "upload" && m === "POST") { // chunk upload: /api/upload/:id/:n  (max 3 x 4MB = 12MB)
    if (need()) return need();
    if (+p[2] > 2) return J({ error: "১২ এমবির বেশি নয়" }, 400);
    await files.set(`${p[1]}/${p[2]}`, await req.arrayBuffer()); return J({ ok: true });
  }
  if (p[0] === "file" && m === "GET") {
    const f = await files.get(`${p[1]}/${p[2]}`, { type: "arrayBuffer" });
    return f ? new Response(f, { headers: { "content-type": "application/octet-stream" } }) : J({ error: "নেই" }, 404);
  }
  // ---- durood competition ----
  if (p[0] === "durood") {
    if (m === "GET") {
      const w = wk(), data = (await dur.get(w, { type: "json" })) ?? {};
      return J({ week: w, list: Object.entries(data).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 100) });
    }
    if (m === "POST") {
      const b = await body(), n = Math.floor(+b.count);
      if (!env.GROUP_CODE || b.code !== env.GROUP_CODE || !b.name?.trim()) return J({ error: "লগইন করুন" }, 401);
      if (!(n >= 1 && n <= 100000)) return J({ error: "সংখ্যা সঠিক নয়" }, 400);
      const w = wk(), data = (await dur.get(w, { type: "json" })) ?? {}, nm = b.name.trim().slice(0, 30);
      data[nm] = (data[nm] || 0) + n; await dur.setJSON(w, data); return J({ ok: true, total: data[nm] });
    }
    if (m === "DELETE") { // admin: clear all competition data (every Monday)
      if (need()) return need();
      const { blobs } = await dur.list(); for (const x of blobs) await dur.delete(x.key); return J({ ok: true, deleted: blobs.length });
    }
  }
  // ---- arabic words (1 new word per day) ----
  if (p[0] === "words") {
    const ws = await get("words", { start: null, list: [] });
    if (m === "GET") {
      if (q.get("all") && need()) return need();
      const n = ws.start ? Math.min(ws.list.length, day(d) - ws.start + 1) : 0;
      return J({ words: q.get("all") ? ws.list : ws.list.slice(0, Math.max(0, n)), total: ws.list.length });
    }
    if (need()) return need();
    if (m === "POST") {
      const b = await body(); if (!b.ar || !b.bn) return J({ error: "আরবি ও অর্থ দিন" }, 400);
      if (!ws.start) ws.start = day(d);
      ws.list.push({ ar: b.ar, bn: b.bn, pr: b.pr || "" }); await db.setJSON("words", ws); return J({ ok: true });
    }
    if (m === "DELETE") { ws.list.splice(+p[1], 1); await db.setJSON("words", ws); return J({ ok: true }); }
  }
  // ---- links ----
  if (p[0] === "links") {
    if (m === "GET") return J(await get("links", []));
    if (need()) return need();
    if (m === "POST") { await db.setJSON("links", (await body()).links || []); return J({ ok: true }); }
  }
  return J({ error: "not found" }, 404);
};
