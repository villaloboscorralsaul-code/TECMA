const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const STATUS = {
  PENDIENTE: "PENDIENTE",
  EN_PROCESO: "EN_PROCESO",
  COMPLETADO: "COMPLETADO",
  NO_APROBADO: "NO_APROBADO",
};

const PASSING_SCORE = 4;
const CERT_BUCKET = process.env.CERTIFICATES_BUCKET || "certificates";

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event) {
  if (!event || !event.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function normalizeName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function sanitizeText(value, max = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getAdminKeyFromEvent(event) {
  const queryKey = event?.queryStringParameters?.key;
  const headerKey = event?.headers?.["x-admin-key"] || event?.headers?.["X-Admin-Key"];
  return queryKey || headerKey || "";
}

function requireAdmin(event) {
  const expected = process.env.ADMIN_ACCESS_KEY;

  if (!expected) {
    return {
      ok: false,
      response: json(500, {
        error: "ADMIN_ACCESS_KEY is not configured.",
      }),
    };
  }

  const received = getAdminKeyFromEvent(event);

  if (!received || received !== expected) {
    return {
      ok: false,
      response: json(401, {
        error: "Unauthorized admin access.",
      }),
    };
  }

  return { ok: true };
}

function randomToken(size = 16) {
  return crypto.randomBytes(size).toString("hex");
}

function buildFolio(dateObj = new Date()) {
  const yyyy = dateObj.getFullYear();
  const serial = Math.floor(100000 + Math.random() * 900000);
  return `TECMA-CERT-${yyyy}-${serial}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureCertificatesBucket(supabase) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    return;
  }

  const exists = Array.isArray(data) && data.some((bucket) => bucket.name === CERT_BUCKET);
  if (exists) {
    return;
  }

  await supabase.storage.createBucket(CERT_BUCKET, {
    public: false,
    fileSizeLimit: "10MB",
  });
}

async function createSignedDownloadUrl(supabase, filePath, expiresInSeconds = 60 * 60 * 24 * 7) {
  const { data, error } = await supabase.storage
    .from(CERT_BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Unable to create signed URL");
  }

  return data.signedUrl;
}

async function getProgressMap(supabase, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("progreso_test")
    .select("usuario_id,estado,started_at,policy_accepted_at,last_quiz_score,attempt_count,completed_at,certificate_id")
    .in("usuario_id", userIds);

  if (error || !Array.isArray(data)) {
    return new Map();
  }

  return new Map(data.map((row) => [row.usuario_id, row]));
}

async function logAudit(supabase, { usuarioId = null, actor = "SYSTEM", action, metadata = {} }) {
  if (!action) {
    return;
  }

  await supabase.from("eventos_auditoria").insert({
    usuario_id: usuarioId,
    actor,
    accion: action,
    metadata,
    created_at: nowIso(),
  });
}

module.exports = {
  STATUS,
  PASSING_SCORE,
  CERT_BUCKET,
  json,
  parseBody,
  normalizeName,
  sanitizeName,
  sanitizeText,
  getSupabaseAdmin,
  requireAdmin,
  randomToken,
  buildFolio,
  slugify,
  nowIso,
  ensureCertificatesBucket,
  createSignedDownloadUrl,
  getProgressMap,
  logAudit,
};
