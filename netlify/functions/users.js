const {
  STATUS,
  json,
  parseBody,
  normalizeName,
  sanitizeName,
  sanitizeText,
  getSupabaseAdmin,
  requireAdmin,
  nowIso,
  logAudit,
} = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const guard = requireAdmin(event);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const body = parseBody(event);
    const nombre = sanitizeName(body.nombre);
    const codigoInterno = sanitizeText(body.codigo_interno || "", 80) || null;
    const area = sanitizeText(body.area || "", 120) || null;

    if (!nombre) {
      return json(400, { error: "'nombre' is required" });
    }

    const nombreNormalizado = normalizeName(nombre);
    if (!nombreNormalizado) {
      return json(400, { error: "Invalid nombre value" });
    }

    const supabase = getSupabaseAdmin();

    const { data: createdUser, error: userError } = await supabase
      .from("usuarios")
      .insert({
        nombre,
        nombre_normalizado: nombreNormalizado,
        codigo_interno: codigoInterno,
        area,
        created_at: nowIso(),
      })
      .select("id,nombre,codigo_interno,area,created_at")
      .single();

    if (userError) {
      if (String(userError.message || "").toLowerCase().includes("duplicate")) {
        return json(409, { error: "User with the same name already exists" });
      }
      return json(500, { error: userError.message });
    }

    const { error: progressError } = await supabase.from("progreso_test").insert({
      usuario_id: createdUser.id,
      estado: STATUS.PENDIENTE,
      attempt_count: 0,
      updated_at: nowIso(),
    });

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    await logAudit(supabase, {
      usuarioId: createdUser.id,
      actor: "ADMIN",
      action: "USER_CREATED",
      metadata: { nombre, codigo_interno: codigoInterno, area },
    });

    return json(201, {
      user: {
        ...createdUser,
        estado: STATUS.PENDIENTE,
      },
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
