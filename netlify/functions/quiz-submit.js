const {
  STATUS,
  PASSING_SCORE,
  json,
  parseBody,
  getSupabaseAdmin,
  fetchProgressByUser,
  hasRecognition,
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
    const score = Number(body.score);
    const answers = Array.isArray(body.answers) ? body.answers : [];

    if (!userId) {
      return json(400, { error: "'user_id' is required" });
    }

    if (!Number.isFinite(score) || score < 0) {
      return json(400, { error: "'score' must be a valid number" });
    }

    const passed = score >= PASSING_SCORE;
    const supabase = getSupabaseAdmin();
    const now = nowIso();

    const { data: progress, error: progressError } = await fetchProgressByUser(
      supabase,
      userId,
      ["estado", "attempt_count"]
    );

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    if (progress?.estado === STATUS.COMPLETADO || hasRecognition(progress)) {
      return json(403, {
        blocked: true,
        error: "El flujo ya está completado y bloqueado para nuevos intentos.",
      });
    }

    const { error: attemptError } = await supabase.from("intentos_quiz").insert({
      usuario_id: userId,
      score,
      passed,
      answers,
      attempted_at: now,
    });

    if (attemptError) {
      return json(500, { error: attemptError.message });
    }

    const nextStatus = passed ? STATUS.EN_PROCESO : STATUS.NO_APROBADO;

    if (!progress) {
      const { error: createProgressError } = await supabase.from("progreso_test").insert({
        usuario_id: userId,
        estado: nextStatus,
        last_quiz_score: score,
        attempt_count: 1,
        updated_at: now,
      });

      if (createProgressError) {
        return json(500, { error: createProgressError.message });
      }
    } else {
      const { error: updateProgressError } = await supabase
        .from("progreso_test")
        .update({
          estado: nextStatus,
          last_quiz_score: score,
          attempt_count: (progress.attempt_count || 0) + 1,
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
      action: "QUIZ_SUBMITTED",
      metadata: { score, passed },
    });

    if (!passed) {
      await logAudit(supabase, {
        usuarioId: userId,
        actor: "SYSTEM",
        action: "QUIZ_FAILED_ALERT",
        metadata: { score, required: PASSING_SCORE },
      });
    }

    return json(200, {
      passed,
      score,
      passing_score: PASSING_SCORE,
      estado: nextStatus,
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
