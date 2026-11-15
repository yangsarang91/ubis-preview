// POST /api/render — 손님 방 사진 + 3D 시안 설정 → OpenAI 이미지 편집으로 실사 시안 생성
// 필요한 설정 (Cloudflare Pages > Settings):
//   OPENAI_API_KEY   (Secret)  OpenAI API 키
//   UBIS             (KV 바인딩) 연락처·사용량 기록
// 선택 설정:
//   OPENAI_IMAGE_MODEL  기본 gpt-image-1
//   IMAGE_QUALITY       low | medium | high (기본 medium)
//   PER_PHONE_LIMIT     연락처 1개당 생성 수 (기본 3)
//   DAILY_LIMIT         하루 전체 생성 수 상한 (기본 60)
import { json, sha256, normPhone, todayKST, clampDesign, buildPrompt, dataUrlToBlob } from "../_lib.js";

const YEAR = 365 * 24 * 3600;

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY || !env.UBIS) {
    return json({ ok: false, code: "not_configured", message: "AI 시안 기능이 아직 설정되지 않았어요." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요." }, 400);
  }

  const name = String(body.name || "").trim().slice(0, 30);
  const phone = normPhone(body.phone);
  if (!name) return json({ ok: false, code: "name", message: "성함을 입력해 주세요." }, 400);
  if (!phone) return json({ ok: false, code: "phone", message: "휴대폰 번호를 정확히 입력해 주세요." }, 400);
  if (body.consent !== true) return json({ ok: false, code: "consent", message: "개인정보 수집·이용에 동의해 주세요." }, 400);

  const image = dataUrlToBlob(body.image);
  if (!image) return json({ ok: false, code: "image", message: "사진을 다시 올려 주세요. (4MB 이하 이미지)" }, 400);

  const design = clampDesign(body.design);
  const perPhone = Number(env.PER_PHONE_LIMIT || 3);
  const daily = Number(env.DAILY_LIMIT || 60);
  const ph = await sha256("ubis:" + phone);
  const day = todayKST();
  const usedPhone = Number((await env.UBIS.get(`cnt:${ph}`)) || 0);
  const usedDay = Number((await env.UBIS.get(`day:${day}`)) || 0);

  // 상담 연락처는 생성 성공 여부와 관계없이 기록
  const leadKey = `lead:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
  const lead = { name, phone, design, createdAt: new Date().toISOString(), status: "requested" };
  await env.UBIS.put(leadKey, JSON.stringify(lead), { expirationTtl: YEAR });

  if (usedPhone >= perPhone) {
    return json({ ok: false, code: "limit_phone", message: `AI 시안은 연락처당 ${perPhone}장까지 만들 수 있어요. 더 필요하시면 카톡으로 말씀해 주세요.`, remaining: 0 }, 429);
  }
  if (usedDay >= daily) {
    return json({ ok: false, code: "limit_day", message: "오늘 준비된 AI 시안이 모두 소진됐어요. 카톡으로 사진을 보내 주시면 직접 그려 드릴게요." }, 429);
  }

  const size = body.orient === "portrait" ? "1024x1536" : "1536x1024";
  const form = new FormData();
  form.append("model", env.OPENAI_IMAGE_MODEL || "gpt-image-1");
  form.append("image", image, "room." + (image.type.split("/")[1] || "jpg"));
  form.append("prompt", buildPrompt(design));
  form.append("size", size);
  form.append("quality", env.IMAGE_QUALITY || "medium");
  form.append("n", "1");

  let out;
  try {
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    out = await r.json().catch(() => ({}));
    if (!r.ok) {
      lead.status = "failed";
      lead.error = String(out?.error?.code || out?.error?.type || r.status).slice(0, 60);
      await env.UBIS.put(leadKey, JSON.stringify(lead), { expirationTtl: YEAR });
      const safety = /safety|moderation|content_policy/i.test(JSON.stringify(out?.error || ""));
      return json({ ok: false, code: safety ? "safety" : "upstream", message: safety ? "이 사진으로는 시안을 만들 수 없어요. 다른 사진으로 시도해 주세요." : "AI가 잠시 바빠요. 잠시 후 다시 시도해 주세요." }, 502);
    }
  } catch {
    return json({ ok: false, code: "network", message: "AI 연결이 끊겼어요. 잠시 후 다시 시도해 주세요." }, 502);
  }

  const b64 = out?.data?.[0]?.b64_json;
  if (!b64) return json({ ok: false, code: "empty", message: "시안을 받지 못했어요. 다시 시도해 주세요." }, 502);

  // 성공했을 때만 사용량 차감
  await env.UBIS.put(`cnt:${ph}`, String(usedPhone + 1), { expirationTtl: YEAR });
  await env.UBIS.put(`day:${day}`, String(usedDay + 1), { expirationTtl: 3 * 24 * 3600 });
  lead.status = "done";
  await env.UBIS.put(leadKey, JSON.stringify(lead), { expirationTtl: YEAR });

  return json({ ok: true, image: `data:image/png;base64,${b64}`, remaining: Math.max(0, perPhone - usedPhone - 1) });
}

export const onRequest = () => json({ ok: false, message: "POST only" }, 405);
