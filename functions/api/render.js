// POST /api/render — 손님 방 사진 + 3D 시안 설정 → OpenAI 이미지 편집으로 실사 시안 생성
// 요청: multipart/form-data { image: File(jpeg/png/webp, 4MB 이하), payload: JSON 문자열 }
//   payload = { name, phone, consent:true, orient:"landscape"|"portrait", design:{...} }
// 필요한 설정 (Cloudflare Pages > Settings):
//   OPENAI_API_KEY (Secret), UBIS (KV 바인딩)
// 선택 설정:
//   OPENAI_IMAGE_MODEL(기본 gpt-image-1), IMAGE_QUALITY(low|medium|high, 기본 medium)
//   PER_PHONE_LIMIT(기본 3), PER_IP_DAILY(기본 6), DAILY_LIMIT(기본 60), INPUT_FIDELITY(예: high)
import { json, sha256, normPhone, todayKST, clampDesign, buildPrompt } from "../_lib.js";

const YEAR = 365 * 24 * 3600;
const OPTIONAL_PARAMS = ["output_format", "output_compression", "input_fidelity"];

async function bump(kv, key, delta, ttl) {
  const n = Math.max(0, Number((await kv.get(key)) || 0) + delta);
  await kv.put(key, String(n), { expirationTtl: ttl });
  return n;
}

async function callOpenAI(env, image, prompt, size, withExtras) {
  const form = new FormData();
  form.append("model", env.OPENAI_IMAGE_MODEL || "gpt-image-1");
  form.append("image", image, "room.jpg");
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", env.IMAGE_QUALITY || "medium");
  form.append("n", "1");
  if (withExtras) {
    form.append("output_format", "jpeg");
    form.append("output_compression", "82");
    if (env.INPUT_FIDELITY) form.append("input_fidelity", env.INPUT_FIDELITY);
  }
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  const out = await r.json().catch(() => ({}));
  return { r, out };
}

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY || !env.UBIS) {
    return json({ ok: false, code: "not_configured", message: "AI 시안 기능이 아직 설정되지 않았어요." }, 503);
  }
  const kv = env.UBIS;

  let form, body;
  try {
    form = await request.formData();
    body = JSON.parse(String(form.get("payload") || "{}"));
  } catch {
    return json({ ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요." }, 400);
  }

  const name = String(body.name || "").trim().slice(0, 30);
  const phone = normPhone(body.phone);
  if (!name) return json({ ok: false, code: "name", message: "성함을 입력해 주세요." }, 400);
  if (!phone) return json({ ok: false, code: "phone", message: "휴대폰 번호를 정확히 입력해 주세요." }, 400);
  if (body.consent !== true) return json({ ok: false, code: "consent", message: "개인정보 수집·이용에 동의해 주세요." }, 400);

  const image = form.get("image");
  if (!image || typeof image === "string" || !/^image\/(jpeg|png|webp)$/.test(image.type) || image.size > 4 * 1024 * 1024 || image.size < 1000) {
    return json({ ok: false, code: "image", message: "사진을 다시 올려 주세요. (4MB 이하 이미지)" }, 400);
  }

  const design = clampDesign(body.design);
  const perPhone = Number(env.PER_PHONE_LIMIT || 3);
  const perIp = Number(env.PER_IP_DAILY || 6);
  const daily = Number(env.DAILY_LIMIT || 60);
  const day = todayKST();
  const ph = await sha256("ubis:" + phone);
  const ip = await sha256("ubis-ip:" + (request.headers.get("cf-connecting-ip") || "unknown"));
  const kPhone = `cnt:${ph}`, kDay = `day:${day}`, kIp = `ip:${ip}:${day}`;

  const [usedPhone, usedDay, usedIp] = (await Promise.all([kv.get(kPhone), kv.get(kDay), kv.get(kIp)])).map((v) => Number(v || 0));
  if (usedPhone >= perPhone) {
    return json({ ok: false, code: "limit_phone", message: `AI 시안은 연락처당 ${perPhone}장까지 만들 수 있어요. 더 필요하시면 카톡으로 말씀해 주세요.`, remaining: 0 }, 429);
  }
  if (usedIp >= perIp) {
    return json({ ok: false, code: "limit_ip", message: "오늘은 이 기기에서 만들 수 있는 AI 시안을 모두 사용하셨어요. 카톡으로 말씀해 주세요." }, 429);
  }
  if (usedDay >= daily) {
    return json({ ok: false, code: "limit_day", message: "오늘 준비된 AI 시안이 모두 소진됐어요. 카톡으로 사진을 보내 주시면 직접 그려 드릴게요." }, 429);
  }

  // 생성 전에 미리 차감(동시 요청 방지). 실패하면 되돌림
  await Promise.all([
    kv.put(kPhone, String(usedPhone + 1), { expirationTtl: YEAR }),
    kv.put(kDay, String(usedDay + 1), { expirationTtl: 3 * 24 * 3600 }),
    kv.put(kIp, String(usedIp + 1), { expirationTtl: 2 * 24 * 3600 }),
  ]);
  const refund = () =>
    Promise.all([bump(kv, kPhone, -1, YEAR), bump(kv, kDay, -1, 3 * 24 * 3600), bump(kv, kIp, -1, 2 * 24 * 3600)]).catch(() => {});

  const lead = { name, phone, design, createdAt: new Date().toISOString(), status: "requested" };
  const saveLead = () => kv.put(`lead:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(lead), { expirationTtl: YEAR }).catch(() => {});

  const size = body.orient === "portrait" ? "1024x1536" : "1536x1024";
  const prompt = buildPrompt(design);
  let res;
  try {
    res = await callOpenAI(env, image, prompt, size, true);
    const param = String(res.out?.error?.param || "");
    if (res.r.status === 400 && OPTIONAL_PARAMS.some((p) => param.includes(p))) {
      res = await callOpenAI(env, image, prompt, size, false); // 선택 옵션을 지원하지 않으면 기본값으로 재시도
    }
  } catch {
    lead.status = "failed"; lead.error = "network";
    await Promise.all([refund(), saveLead()]);
    return json({ ok: false, code: "network", message: "AI 연결이 끊겼어요. 잠시 후 다시 시도해 주세요." }, 502);
  }

  const { r, out } = res;
  const b64 = out?.data?.[0]?.b64_json;
  if (!r.ok || !b64) {
    lead.status = "failed";
    lead.error = String(out?.error?.code || out?.error?.type || r.status).slice(0, 60);
    await Promise.all([refund(), saveLead()]);
    const safety = /safety|moderation|content_policy/i.test(JSON.stringify(out?.error || ""));
    return json({ ok: false, code: safety ? "safety" : "upstream", message: safety ? "이 사진으로는 시안을 만들 수 없어요. 다른 사진으로 시도해 주세요." : "AI가 잠시 바빠요. 잠시 후 다시 시도해 주세요." }, 502);
  }

  lead.status = "done";
  await saveLead();
  const mime = /^\/9j\//.test(b64) ? "image/jpeg" : "image/png";
  return json({ ok: true, image: `data:${mime};base64,${b64}`, remaining: Math.max(0, perPhone - usedPhone - 1) });
}

export const onRequest = () => json({ ok: false, message: "POST only" }, 405);
