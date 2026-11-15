// GET /api/leads — 관리자용 상담 신청 목록 (헤더 x-admin-key 로 ADMIN_KEY 확인)
import { json, sha256 } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const key = request.headers.get("x-admin-key") || "";
  if (!env.ADMIN_KEY || key.length < 8 || (await sha256(key)) !== (await sha256(env.ADMIN_KEY))) {
    return json({ ok: false, message: "관리자 키가 올바르지 않아요." }, 401);
  }
  if (!env.UBIS) return json({ ok: false, message: "KV(UBIS)가 연결되지 않았어요." }, 503);

  const items = [];
  let cursor;
  do {
    const page = await env.UBIS.list({ prefix: "lead:", cursor, limit: 1000 });
    for (const k of page.keys) {
      const v = await env.UBIS.get(k.name);
      if (v) {
        try { items.push({ id: k.name, ...JSON.parse(v) }); } catch {}
      }
      if (items.length >= 500) break;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && items.length < 500);

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return json({ ok: true, count: items.length, items });
}
