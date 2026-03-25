const {
  STATUS,
  json,
  parseBody,
  getSupabaseAdmin,
  nowIso,
  logAudit,
} = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = parseBody(event);
    const userId = String(body.user_id || "").trim();

    if (!userId) {
      return json(400, { error: "'user_id' is required" });
    }

    const supabase = getSupabaseAdmin();

    const { data: user, error: userError } = await supabase
      .from("usuarios")
      .select("id,nombre,codigo_interno,area")
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      return json(500, { error: userError.message });
    }

    if (!user) {
      return json(404, { error: "User not found" });
    }

    const now = nowIso();

    const { data: progress, error: progressError } = await supabase
      .from("progreso_test")
      .select("estado,started_at,completed_at,recognition_id")
      .eq("usuario_id", userId)
      .maybeSingle();

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    let nextState = STATUS.EN_PROCESO;

    if (!progress) {
      const { error: createProgressError } = await supabase.from("progreso_test").insert({
        usuario_id: userId,
        estado: STATUS.EN_PROCESO,
        started_at: now,
        attempt_count: 0,
        updated_at: now,
      });

      if (createProgressError) {
        return json(500, { error: createProgressError.message });
      }
    } else if (progress.estado === STATUS.COMPLETADO || progress.recognition_id) {
      await logAudit(supabase, {
        usuarioId: userId,
        actor: "SYSTEM",
        action: "SESSION_BLOCKED_COMPLETED",
        metadata: {
          reason: "FLOW_ALREADY_COMPLETED",
        },
      });

      return json(403, {
        blocked: true,
        error:
          "Este colaborador ya completó el flujo y cuenta con un reconocimiento emitido. No es posible rehacer el proceso.",
      });
    } else {
      const { error: updateProgressError } = await supabase
        .from("progreso_test")
        .update({
          estado: STATUS.EN_PROCESO,
          started_at: progress.started_at || now,
          updated_at: now,
        })
        .eq("usuario_id", userId);

      if (updateProgressError) {
        return json(500, { error: updateProgressError.message });
      }
    }

    await logAudit(supabase, {
      usuarioId: userId,
      actor: "USER",
      action: "SESSION_STARTED",
      metadata: {},
    });

    return json(200, {
      user: {
        id: user.id,
        nombre: user.nombre,
        codigo_interno: user.codigo_interno || null,
        area: user.area || null,
      },
      estado: nextState,
      already_completed: false,
      blocked: false,
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
