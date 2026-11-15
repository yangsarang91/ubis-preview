// GET /api/health — AI 시안 기능이 켜져 있는지만 알려줌 (키 값은 절대 노출하지 않음)
import { json } from "../_lib.js";

export const onRequestGet = ({ env }) =>
  json({ ok: true, ai: !!(env.OPENAI_API_KEY && env.UBIS), limit: Number(env.PER_PHONE_LIMIT || 3) });
