// Tablero de agendas: lee #comercial-agenda en Slack y cruza cada agenda
// con su etapa en el pipeline "Agendas" de GoHighLevel. Solo lectura.
import { timingSafeEqual } from "node:crypto";

const env = (k, d) => process.env[k] || d;
const SLACK_TOKEN = env("SLACK_TOKEN");
const SLACK_CHANNEL = env("SLACK_CHANNEL", "C0AFUUR37ND");
const GHL_TOKEN = env("GHL_TOKEN");
const GHL_LOCATION = env("GHL_LOCATION", "x7nYndpXUc1dmpunATsZ");
const GHL_PIPELINE = env("GHL_PIPELINE", "Hdnl2Kgw5kRk1rCNrwYW");          // Agendas
const GHL_PIPE_WEBINAR = env("GHL_PIPE_WEBINAR", "kY28NRmKxkvrkAUm1tOq"); // WEBINAR
const GHL_PIPE_SEG = env("GHL_PIPE_SEG", "5pgmx29qxGQt7GpypecG");         // Seguimientos
const PASSWORD = env("DASHBOARD_PASSWORD");
const MAX_DAYS = 31;
const DAY = 864e5;

const cache = new Map(); // caché corta por instancia
const CACHE_MS = 5 * 60 * 1000;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function passOk(given) {
  if (!PASSWORD || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- fechas (hora de Argentina, UTC-3) ---------- */
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const dayStart = (k) => new Date(k + "T00:00:00-03:00").getTime();
const dayKey = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);
const hhmm = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(11, 16);

/* ---------- texto ---------- */
const norm = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s) => norm(s).split(" ").filter((w) => w.length > 1);

/* ---------- Slack ---------- */
function messageText(m) {
  let t = m.text || "";
  for (const b of m.blocks || []) {
    if (b.text?.text) t += "\n" + b.text.text;
    for (const f of b.fields || []) if (f.text) t += "\n" + f.text;
  }
  for (const a of m.attachments || []) t += "\n" + (a.text || "") + "\n" + (a.fallback || "");
  return t;
}
// Ads: "Sesión Asesoría Founders - X" · Bio: "... Founders IG - X" o "... Founders S- X" · Webinar: "Auditoría Founders - X"
const TITLE_RE = /T[ií]tulo:?\*?:?\s*(?:(Sesi[oó]n Asesor[ií]a)|(Auditor[ií]a)) Founders(?:\s+(IG|S))?\s*-\s*([^\n*]+)/i;

async function slackAgendas(from, to) {
  const oldest = dayStart(from) / 1000, latest = (dayStart(to) + DAY) / 1000;
  const out = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const u = new URL("https://slack.com/api/conversations.history");
    u.searchParams.set("channel", SLACK_CHANNEL);
    u.searchParams.set("oldest", String(oldest));
    u.searchParams.set("latest", String(latest));
    u.searchParams.set("limit", "200");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } });
    const j = await r.json();
    if (!j.ok) throw { where: "slack", code: j.error || `http_${r.status}` };
    for (const m of j.messages || []) {
      const mt = TITLE_RE.exec(messageText(m));
      if (!mt) continue; // ignora pruebas y mensajes que no son agendas
      const ms = Math.round(parseFloat(m.ts) * 1000);
      out.push({
        name: mt[4].replace(/\s+/g, " ").trim(),
        src: mt[2] ? "W" : mt[3] ? "B" : "A",
        day: dayKey(ms), time: hhmm(ms), ts: ms,
      });
    }
    cursor = j.response_metadata?.next_cursor || "";
    if (!j.has_more || !cursor) break;
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/* ---------- GoHighLevel ---------- */
async function ghl(path, params) {
  const u = new URL("https://services.leadconnectorhq.com" + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  // Si GHL responde 429 (demasiadas consultas juntas), espera y reintenta.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(u, {
      headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-07-28", Accept: "application/json" },
    });
    if (r.status === 429 && attempt < 3) {
      const ra = parseFloat(r.headers.get("retry-after") || "");
      const wait = Math.min(Number.isFinite(ra) ? ra * 1000 : 800 * (attempt + 1), 2500);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (!r.ok) throw { where: "ghl", code: `http_${r.status}`, detail: (await r.text()).slice(0, 300) };
    return r.json();
  }
}
async function stageMap() {
  const j = await ghl("/opportunities/pipelines", { locationId: GHL_LOCATION });
  const pipes = j.pipelines || [];
  if (!pipes.some((x) => x.id === GHL_PIPELINE)) throw { where: "ghl", code: "pipeline_not_found" };
  // Mapa de todas las etapas de los pipelines que usa el tablero.
  const use = new Set([GHL_PIPELINE, GHL_PIPE_WEBINAR, GHL_PIPE_SEG]);
  return Object.fromEntries(pipes.filter((x) => use.has(x.id)).flatMap((x) => (x.stages || []).map((s) => [s.id, s.name])));
}
function slim(o, stages) {
  return {
    name: o.name || "",
    contact: o.contact?.name || "",
    email: o.contact?.email || "",
    tags: (o.contact?.tags || []).map((x) => norm(x)),
    pipeline: o.pipelineId || "",
    stage: stages[o.pipelineStageId] || "Sin etapa",
    created: Date.parse(o.createdAt || o.dateAdded || 0) || 0,
    changed: Date.parse(o.lastStageChangeAt || o.updatedAt || o.createdAt || 0) || 0,
    source: o.source || "",
  };
}
async function searchOpps(stages, { q, sinceMs, max = 1500, pipelineId = GHL_PIPELINE }) {
  const out = [];
  let startAfter, startAfterId;
  for (let page = 0; page < Math.ceil(max / 100); page++) {
    const j = await ghl("/opportunities/search", {
      location_id: GHL_LOCATION, pipeline_id: pipelineId, limit: 100, q, startAfter, startAfterId,
    });
    const items = j.opportunities || [];
    for (const o of items) out.push(slim(o, stages));
    startAfter = j.meta?.startAfter; startAfterId = j.meta?.startAfterId;
    const oldest = items.length ? Math.min(...items.map((o) => Date.parse(o.createdAt || 0) || 0)) : 0;
    if (!items.length || !startAfterId || (sinceMs && oldest < sinceMs)) break;
  }
  return sinceMs ? out.filter((o) => o.created >= sinceMs) : out;
}

/* ---------- cruce ---------- */
function stageCat(n) {
  const s = norm(n);
  if (s.startsWith("nutricion") || /^(asistencia|no asistio|sena|venta)/.test(s)) return "con";
  if (s.startsWith("descualificado") && s.includes("nicho")) return "pn";
  if (s.startsWith("descualificado")) return "pi";
  if (s.startsWith("cancelado")) return "ca";
  if (s.startsWith("triaje")) return "tri";
  if (s.startsWith("nuevo lead") || s.startsWith("lead confirmar")) return "sin";
  return "abi";
}
function matches(name, o) {
  const t = toks(name);
  if (!t.length) return false;
  const ct = new Set([...toks(o.contact), ...toks(o.name)]);
  return t.length === 1 ? ct.has(t[0]) : ct.has(t[0]) && ct.has(t[t.length - 1]);
}
function pick(ag, cands) {
  if (!cands.length) return null;
  const best = [...cands].sort((a, b) => Math.abs(a.created - ag.ts) - Math.abs(b.created - ag.ts))[0];
  if (toks(ag.name).length === 1 && Math.abs(best.created - ag.ts) > 3 * DAY)
    return { opp: best, why: "Nombre de una sola palabra y la oportunidad no es de esa fecha" };
  if (best.created < ag.ts - 3 * DAY && best.changed < ag.ts)
    return { opp: best, why: "La única oportunidad con ese nombre es vieja y no se movió desde que agendó" };
  return { opp: best, why: null };
}

// Quien agendó varias veces en el período se cuenta una sola vez (la más reciente).
function dedupe(agendas) {
  const seen = new Set();
  return agendas.filter((a) => { const k = a.src + "|" + norm(a.name); if (seen.has(k)) return false; seen.add(k); return true; });
}
const row = (a, extra) => ({ name: a.name, src: a.src, day: a.day, time: a.time, email: "", why: null, ...extra });

// Leads de webinar sin oportunidad en Agendas: se miran WEBINAR y Seguimientos.
function webinarRow(a, webinarPool, segPool) {
  const w = pick(a, webinarPool.filter((o) => matches(a.name, o)));
  if (w && !w.why) {
    const s = norm(w.opp.stage), base = { email: w.opp.email };
    if (s.startsWith("low ticket")) return row(a, { ...base, stage: "Low ticket", cat: "form" });
    if (s.startsWith("datos erroneos")) return row(a, { ...base, stage: "Datos erróneos", cat: "de" });
    if (s.startsWith("descualificado")) return row(a, { ...base, stage: "Descualificado por nicho", cat: "pn" });
    if (s.startsWith("new lead")) return row(a, { ...base, stage: "New Lead (webinar)", cat: "sin" });
    if (s.startsWith("agendado")) return row(a, { ...base, stage: "Agendado (webinar)", cat: "rev", why: "Figura como Agendado en WEBINAR pero no se encontró su oportunidad en Agendas" });
    return row(a, { ...base, stage: w.opp.stage + " (webinar)", cat: "rev", why: "Etapa del pipeline WEBINAR que el tablero no conoce" });
  }
  const g = pick(a, segPool.filter((o) => matches(a.name, o)));
  if (g && !g.why) {
    const s = norm(g.opp.stage);
    if (s.includes("perdido") || s.includes("descualificado") || g.opp.tags.some((x) => x.includes("descualificado webinar")))
      return row(a, { email: g.opp.email, stage: "Descalificado por el form", cat: "form" });
    return row(a, { email: g.opp.email, stage: g.opp.stage + " (Seguimientos)", cat: "rev", why: "Está en Seguimientos en una etapa que no es de descalificados" });
  }
  return row(a, { stage: "No encontrada en GHL", cat: "rev", why: "No está en Agendas, WEBINAR ni Seguimientos" });
}

async function build(from, to) {
  const [rawAgendas, stages] = await Promise.all([slackAgendas(from, to), stageMap()]);
  const agendas = dedupe(rawAgendas);
  if (!agendas.length) return [];
  const since = dayStart(from) - 3 * DAY;
  const hasWeb = agendas.some((a) => a.src === "W");
  // Cada pipeline completo, de una vez (evita cientos de búsquedas sueltas).
  const [pool, webinarPool, segPool] = await Promise.all([
    searchOpps(stages, { sinceMs: since }),
    hasWeb ? searchOpps(stages, { sinceMs: since, pipelineId: GHL_PIPE_WEBINAR }) : [],
    hasWeb ? searchOpps(stages, { sinceMs: since, pipelineId: GHL_PIPE_SEG, max: 3000 }) : [],
  ]);
  // Búsqueda individual por apellido solo para Ads/Bio que no aparecieron (máximo 20).
  const pending = agendas.filter((a) => a.src !== "W" && !pool.some((o) => matches(a.name, o)));
  const extra = [];
  const queries = [...new Set(pending.map((a) => { const w = a.name.split(/\s+/).filter((x) => x.length > 1); return w[w.length - 1]; }).filter(Boolean))].slice(0, 20);
  for (let i = 0; i < queries.length; i += 4) {
    const batch = await Promise.all(queries.slice(i, i + 4).map((q) => searchOpps(stages, { q, max: 200 })));
    batch.forEach((b) => extra.push(...b));
  }
  const all = [...pool, ...extra];
  return agendas.map((a) => {
    const p = pick(a, all.filter((o) => matches(a.name, o)));
    if (p && !p.why) { const stage = p.opp.stage.replace(/\s*\|S$/, ""); return row(a, { email: p.opp.email, stage, cat: stageCat(stage) }); }
    if (a.src === "W") return webinarRow(a, webinarPool, segPool);
    if (p) { const stage = p.opp.stage.replace(/\s*\|S$/, ""); return row(a, { email: p.opp.email, stage, cat: "rev", why: p.why }); }
    return row(a, { stage: "No encontrada en GHL", cat: "rev", why: "No hay ninguna oportunidad en Agendas con ese nombre" });
  });
}

export default async (req) => {
  if (!SLACK_TOKEN || !GHL_TOKEN || !PASSWORD) return json(500, { error: "config", message: "Faltan variables de entorno en Netlify (SLACK_TOKEN, GHL_TOKEN o DASHBOARD_PASSWORD)." });
  if (!passOk(req.headers.get("x-pass"))) return json(401, { error: "auth", message: "Contraseña incorrecta." });
  const url = new URL(req.url);
  let from = url.searchParams.get("from"), to = url.searchParams.get("to");
  if (!isDay(from) || !isDay(to)) return json(400, { error: "range", message: "Fechas inválidas." });
  if (from > to) [from, to] = [to, from];
  if ((dayStart(to) - dayStart(from)) / DAY + 1 > MAX_DAYS) from = dayKey(dayStart(to) - (MAX_DAYS - 1) * DAY + 12 * 3600e3);
  const key = from + "|" + to;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS && !url.searchParams.has("fresh")) return json(200, { from, to, updatedAt: hit.at, rows: hit.rows });
  try {
    const rows = await build(from, to);
    const at = Date.now();
    cache.set(key, { at, rows });
    return json(200, { from, to, updatedAt: at, rows });
  } catch (e) {
    const where = e?.where || "server";
    const msgs = {
      not_in_channel: "La app de Slack no está en #comercial-agenda. Invitala al canal.",
      channel_not_found: "La app de Slack no ve el canal. Invitala a #comercial-agenda.",
      missing_scope: "Al token de Slack le falta el permiso groups:history.",
      invalid_auth: "El token de Slack es inválido.",
      token_revoked: "El token de Slack fue revocado.",
      http_401: "El token de GoHighLevel es inválido o venció.",
      http_403: "Al token de GoHighLevel le faltan permisos (ver oportunidades).",
      http_429: "GoHighLevel recibió demasiadas consultas juntas. Esperá un minuto y tocá Actualizar.",
      pipeline_not_found: "No se encontró el pipeline Agendas en GoHighLevel.",
    };
    return json(502, { error: where, code: e?.code, message: msgs[e?.code] || `Falló ${where === "slack" ? "Slack" : where === "ghl" ? "GoHighLevel" : "el servidor"} (${e?.code || e?.message || "error"}).` });
  }
};

export const config = { path: "/api/agendas" };
