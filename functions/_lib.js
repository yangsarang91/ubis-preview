// 공통 유틸 — Cloudflare Pages Functions (Workers 런타임)

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 01012345678 / 010-1234-5678 → 01012345678, 형식이 틀리면 null
export function normPhone(p) {
  const d = String(p || "").replace(/[^0-9]/g, "");
  return /^01[016789][0-9]{7,8}$/.test(d) ? d : null;
}

export function todayKST(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const PRODUCT_EN = {
  pet: "flat slab hinged doors with a smooth PET film finish",
  glass: "glass showcase doors in slim aluminium frames, interior visible through the glass",
  folding: "wide bi-fold doors (folding doors) across each section",
  open: "an open built-in system with no doors, like a walk-in dressroom",
  wallpanel: "handle-less doors that read as a continuous flat wall panel, joints barely visible",
};
const COLOR_EN = {
  white: "matte white",
  ivory: "matte ivory",
  greige: "matte greige (warm light grey-beige)",
  oak: "natural light oak wood grain",
  walnut: "dark walnut wood grain",
  black: "matte black",
};
const MOD_EN = {
  hang: "a long hanging section with one rail under a top shelf",
  double: "a double hanging section with two rails",
  drawer: "two inner drawers at the bottom with a hanging rail above",
  shelf: "adjustable shelves with folded items and boxes",
  display: "a display section with lit glass shelves for bags and accessories, one drawer at the bottom",
};
const MOOD_EN = {
  luxe: "luxury boutique / select-shop mood: dramatic, dark and refined, showroom display lighting",
  hotel: "five-star hotel suite mood: warm, calm, soft indirect lighting",
  gallery: "minimal gallery mood: bright, clean, white, storage disappears into the wall",
  natural: "natural wood mood: cosy, light oak, soft daylight",
  classic: "modern classic mood: calm muted tones with subtle brass/gold accents",
};

const own = (map, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key);
const pick = (map, key, fallback) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback);

export function clampDesign(d = {}) {
  const W = Math.round(Number(d.W));
  const H = Math.round(Number(d.H));
  const mods = Array.isArray(d.mods) ? d.mods.filter((m) => own(MOD_EN, m)).slice(0, 12) : [];
  return {
    product: own(PRODUCT_EN, d.product) ? d.product : "pet",
    color: own(COLOR_EN, d.color) ? d.color : "white",
    W: W >= 600 && W <= 8000 ? W : 2400,
    H: H >= 1800 && H <= 3000 ? H : 2300,
    mods,
    light: !!d.light,
    mood: own(MOOD_EN, d.mood) ? d.mood : null,
    variantName: String(d.variantName || "").slice(0, 30),
    answers: typeof d.answers === "object" && d.answers ? Object.fromEntries(Object.entries(d.answers).slice(0, 8).map(([k, v]) => [String(k).slice(0, 20), String(v).slice(0, 20)])) : {},
  };
}

export function buildPrompt(d) {
  const sections = d.mods.length
    ? d.mods.map((m, i) => `${i + 1}) ${MOD_EN[m]}`).join("; ")
    : "balanced mix of hanging space, drawers and shelves";
  const doorRule =
    d.product === "pet" || d.product === "glass" || d.product === "wallpanel"
      ? `Each section is about ${Math.round(d.W / Math.max(1, d.mods.length || 1))} mm wide; sections wider than 600 mm have two doors, narrower ones a single door.`
      : "";
  return [
    "Edit this photo of a real room. Keep the room exactly as it is: same walls, floor, ceiling, windows, existing lighting, camera position and perspective.",
    `Install a custom floor-to-ceiling built-in wardrobe on the main wall facing the camera. It spans about ${d.W} mm wide and ${d.H} mm high (floor to ceiling), 600 mm deep, fitted flush wall-to-wall with a slim top filler and a recessed baseboard.`,
    `Doors/style: ${pick(PRODUCT_EN, d.product, PRODUCT_EN.pet)}. Finish: ${pick(COLOR_EN, d.color, COLOR_EN.white)}.`,
    `Vertical sections from left to right: ${sections}.`,
    doorRule,
    d.light
      ? "Add warm LED line lighting under the shelves and along the vertical side posts, glowing softly."
      : "No built-in LED lighting.",
    d.mood ? `Overall mood: ${pick(MOOD_EN, d.mood, "")}.` : "",
    "Photorealistic, high-end interior magazine photo quality, correct scale and proportions, natural shadows and reflections. No people, no text, no logos, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

// 데이터 URL(jpeg/png/webp) → Blob. 너무 크면 null
export function dataUrlToBlob(dataUrl, maxBytes = 4 * 1024 * 1024) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const bin = atob(m[2]);
  if (bin.length > maxBytes) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}
