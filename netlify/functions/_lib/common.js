const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const STATUS = {
  PENDIENTE: "PENDIENTE",
  EN_PROCESO: "EN_PROCESO",
  COMPLETADO: "COMPLETADO",
  NO_APROBADO: "NO_APROBADO",
};

const PASSING_SCORE = 4;
const QUIZ_TOTAL_QUESTIONS = 7;
const RECOGNITION_BUCKET = process.env.RECOGNITIONS_BUCKET || "recognitions";

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

function normalizeEmployeeNumber(employeeNumber) {
  return String(employeeNumber || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9]/g, "")
    .slice(0, 20);
}

function buildRecognitionFolio(employeeNumber, year = "2026") {
  const safeEmployeeNumber = normalizeEmployeeNumber(employeeNumber);
  if (!safeEmployeeNumber) {
    throw new Error("Employee number is required to generate folio");
  }

  const safeYear = String(year || "2026").trim() || "2026";
  return `TECMA-RECON-${safeYear}-${safeEmployeeNumber}`;
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

async function ensureRecognitionsBucket(supabase) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    return;
  }

  const exists = Array.isArray(data) && data.some((bucket) => bucket.name === RECOGNITION_BUCKET);
  if (exists) {
    return;
  }

  await supabase.storage.createBucket(RECOGNITION_BUCKET, {
    public: false,
    fileSizeLimit: "10MB",
  });
}

async function createSignedDownloadUrl(supabase, filePath, expiresInSeconds = 60 * 60 * 24 * 7) {
  const { data, error } = await supabase.storage
    .from(RECOGNITION_BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Unable to create signed URL");
  }

  return data.signedUrl;
}

function isMissingColumnError(error, columnName = "recognition_id") {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("does not exist") && message.includes(String(columnName).toLowerCase());
}

function appendRecognitionField(fields) {
  const safeFields = Array.isArray(fields)
    ? fields.map((field) => String(field || "").trim()).filter(Boolean)
    : String(fields || "")
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);

  if (!safeFields.includes("recognition_id")) {
    safeFields.push("recognition_id");
  }

  return safeFields;
}

async function fetchProgressByUser(supabase, userId, fields = ["estado"]) {
  const selectedFields = appendRecognitionField(fields);
  const withRecognition = selectedFields.join(",");

  const initial = await supabase
    .from("progreso_test")
    .select(withRecognition)
    .eq("usuario_id", userId)
    .maybeSingle();

  if (!initial.error) {
    return {
      data: initial.data || null,
      error: null,
      hasRecognitionColumn: true,
    };
  }

  if (!isMissingColumnError(initial.error)) {
    return {
      data: null,
      error: initial.error,
      hasRecognitionColumn: true,
    };
  }

  const fallbackFields = selectedFields.filter((field) => field !== "recognition_id");
  const retry = await supabase
    .from("progreso_test")
    .select(fallbackFields.join(","))
    .eq("usuario_id", userId)
    .maybeSingle();

  if (retry.error) {
    return {
      data: null,
      error: retry.error,
      hasRecognitionColumn: false,
    };
  }

  return {
    data: retry.data ? { ...retry.data, recognition_id: null } : null,
    error: null,
    hasRecognitionColumn: false,
  };
}

function hasRecognition(progress) {
  return Boolean(progress?.recognition_id);
}

async function markProgressCompleted(supabase, { userId, completedAt, recognitionId }) {
  const payload = {
    estado: STATUS.COMPLETADO,
    completed_at: completedAt,
    recognition_id: recognitionId,
    updated_at: completedAt,
  };

  const initial = await supabase.from("progreso_test").update(payload).eq("usuario_id", userId);

  if (!initial.error) {
    return { error: null, hasRecognitionColumn: true };
  }

  if (!isMissingColumnError(initial.error)) {
    return { error: initial.error, hasRecognitionColumn: true };
  }

  const fallbackPayload = {
    estado: STATUS.COMPLETADO,
    completed_at: completedAt,
    updated_at: completedAt,
  };

  const retry = await supabase.from("progreso_test").update(fallbackPayload).eq("usuario_id", userId);
  return { error: retry.error || null, hasRecognitionColumn: false };
}

async function getProgressMap(supabase, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const initial = await supabase
    .from("progreso_test")
    .select("usuario_id,estado,started_at,policy_accepted_at,last_quiz_score,attempt_count,completed_at,recognition_id")
    .in("usuario_id", userIds);

  if (!initial.error && Array.isArray(initial.data)) {
    return new Map(initial.data.map((row) => [row.usuario_id, row]));
  }

  if (!isMissingColumnError(initial.error)) {
    return new Map();
  }

  const retry = await supabase
    .from("progreso_test")
    .select("usuario_id,estado,started_at,policy_accepted_at,last_quiz_score,attempt_count,completed_at")
    .in("usuario_id", userIds);

  if (retry.error || !Array.isArray(retry.data)) {
    return new Map();
  }

  return new Map(
    retry.data.map((row) => [
      row.usuario_id,
      {
        ...row,
        recognition_id: null,
      },
    ])
  );
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
  QUIZ_TOTAL_QUESTIONS,
  RECOGNITION_BUCKET,
  json,
  parseBody,
  normalizeName,
  sanitizeName,
  sanitizeText,
  getSupabaseAdmin,
  requireAdmin,
  randomToken,
  buildRecognitionFolio,
  slugify,
  nowIso,
  ensureRecognitionsBucket,
  createSignedDownloadUrl,
  fetchProgressByUser,
  hasRecognition,
  markProgressCompleted,
  getProgressMap,
  logAudit,
};
