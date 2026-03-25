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
    const now = nowIso();

    const { data: progress, error: progressError } = await supabase
      .from("progreso_test")
      .select("estado,recognition_id")
      .eq("usuario_id", userId)
      .maybeSingle();

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    if (progress?.estado === STATUS.COMPLETADO || progress?.recognition_id) {
      await logAudit(supabase, {
        usuarioId: userId,
        actor: "SYSTEM",
        action: "POLICY_ACCEPT_BLOCKED_COMPLETED",
        metadata: {},
      });
      return json(403, {
        blocked: true,
        error: "El flujo ya fue completado y no se puede volver a registrar.",
      });
    }

    if (!progress) {
      const { error: createError } = await supabase.from("progreso_test").insert({
        usuario_id: userId,
        estado: STATUS.EN_PROCESO,
        policy_accepted_at: now,
        attempt_count: 0,
        updated_at: now,
      });

      if (createError) {
        return json(500, { error: createError.message });
      }
    } else {
      const nextState = progress.estado === STATUS.COMPLETADO ? STATUS.COMPLETADO : STATUS.EN_PROCESO;

      const { error: updateError } = await supabase
        .from("progreso_test")
        .update({
          estado: nextState,
          policy_accepted_at: now,
          updated_at: now,
        })
        .eq("usuario_id", userId);

      if (updateError) {
        return json(500, { error: updateError.message });
      }
    }

    await logAudit(supabase, {
      usuarioId: userId,
      actor: "USER",
      action: "POLICY_ACCEPTED",
      metadata: {},
    });

    return json(200, { ok: true, accepted_at: now });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
