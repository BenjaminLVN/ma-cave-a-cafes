// Ma cave à Délices : lecture par Claude des photos d'étiquette, des pages web et du texte collé.
// La clé Anthropic reste ici, côté serveur (secret ANTHROPIC_API_KEY), jamais dans l'appli.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cave, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // lit ANTHROPIC_API_KEY
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Seules les caves qui existent déjà peuvent utiliser la lecture (évite qu'un inconnu consomme le crédit)
async function caveConnue(cave: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(cave)) return false;
  const { data } = await supa.from("items").select("id").eq("cave", cave).limit(1);
  return !!(data && data.length);
}

// Page web : texte utile de la page (titre, données produit, description, corps)
async function lirePage(url: string) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("url");
  const r = await fetch(u, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
    redirect: "follow", signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("page_" + r.status);
  const html = (await r.text()).slice(0, 2_000_000);
  const meta = (n: string) => (html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)`, "i")) || [])[1] || "";
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n").slice(0, 8000);
  const titre = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const corps = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|tr|dd|dt|section|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 25000);
  let image = meta("og:image");
  try { if (image) image = new URL(image, u).href; } catch { image = ""; }
  const texte = [`Adresse : ${u.href}`, `Titre : ${titre.trim()}`, meta("og:title") && `og:title : ${meta("og:title")}`,
    meta("og:description") || meta("description") ? `Description : ${meta("og:description") || meta("description")}` : "",
    ld && `Données produit (JSON-LD) :\n${ld}`, `Contenu de la page :\n${corps}`].filter(Boolean).join("\n\n");
  return { texte, image };
}

function extraireJson(t: string) {
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return out({ ok: !!Deno.env.get("ANTHROPIC_API_KEY"), images: { maxCount: 4 } });
  const cave = req.headers.get("x-cave") || "";
  if (!(await caveConnue(cave))) return out({ error: "not_granted" }, 403);
  let body: { prompt?: string; images?: { type: string; data: string }[]; url?: string };
  try { body = await req.json(); } catch { return out({ error: "bad_request" }, 400); }
  const prompt = String(body.prompt || "").slice(0, 30000);
  if (!prompt) return out({ error: "bad_request" }, 400);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const im of (body.images || []).slice(0, 4)) {
    const mt = /^image\/(jpeg|png|webp|gif)$/.test(im.type) ? im.type : "image/jpeg";
    content.push({ type: "image", source: { type: "base64", media_type: mt as "image/jpeg", data: im.data } });
  }
  let image = "";
  let texte = prompt;
  if (body.url) {
    try { const p = await lirePage(body.url); image = p.image; texte += "\n\nTexte de la page :\n<<<\n" + p.texte + "\n>>>"; }
    catch { return out({ error: "page_unreadable" }, 422); }
  }
  content.push({ type: "text", text: texte });

  try {
    const msg = await anthropic.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (msg.stop_reason === "refusal") return out({ error: "refused" }, 422);
    const txt = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const data = extraireJson(txt);
    if (!data) return out({ error: "invalid_json" }, 502);
    if (image) data._image = image;
    return out(data);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return out({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.BadRequestError) return out({ error: "image_rejected", detail: String(e.message).slice(0, 300) }, 400);
    if (e instanceof Anthropic.AuthenticationError) return out({ error: "no_key" }, 500);
    return out({ error: "failed", detail: String((e as Error).message).slice(0, 300) }, 502);
  }
});
