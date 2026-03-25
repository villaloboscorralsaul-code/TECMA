const { STATUS, json, getSupabaseAdmin, requireAdmin } = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const guard = requireAdmin(event);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const supabase = getSupabaseAdmin();

    const { count: totalUsers, error: totalError } = await supabase
      .from("usuarios")
      .select("id", { count: "exact", head: true });

    if (totalError) {
      return json(500, { error: totalError.message });
    }

    const { data: progressRows, error: progressError } = await supabase
      .from("progreso_test")
      .select("usuario_id,estado,started_at,updated_at,last_quiz_score,attempt_count");

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    const counters = {
      total: totalUsers || 0,
      pendiente: 0,
      en_proceso: 0,
      completado: 0,
      no_aprobado: 0,
    };

    const alertCandidates = [];

    for (const row of progressRows || []) {
      if (row.estado === STATUS.PENDIENTE) counters.pendiente += 1;
      if (row.estado === STATUS.EN_PROCESO) counters.en_proceso += 1;
      if (row.estado === STATUS.COMPLETADO) counters.completado += 1;
      if (row.estado === STATUS.NO_APROBADO) counters.no_aprobado += 1;

      if (row.estado === STATUS.EN_PROCESO || row.estado === STATUS.NO_APROBADO) {
        alertCandidates.push(row);
      }
    }

    const assigned =
      counters.pendiente +
      counters.en_proceso +
      counters.completado +
      counters.no_aprobado;

    if (counters.total > assigned) {
      counters.pendiente += counters.total - assigned;
    }

    const alertUserIds = Array.from(new Set(alertCandidates.map((row) => row.usuario_id).filter(Boolean)));
    let userMap = new Map();
    if (alertUserIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("usuarios")
        .select("id,nombre,codigo_interno,area")
        .in("id", alertUserIds);

      if (usersError) {
        return json(500, { error: usersError.message });
      }

      userMap = new Map((users || []).map((user) => [user.id, user]));
    }

    const alerts = alertCandidates
      .sort((a, b) => new Date(b.updated_at || b.started_at || 0) - new Date(a.updated_at || a.started_at || 0))
      .slice(0, 30)
      .map((row) => {
        const user = userMap.get(row.usuario_id) || {};
        const scoreLabel = Number.isFinite(Number(row.last_quiz_score))
          ? `${row.last_quiz_score}/7`
          : "sin calificación";
        const startedAt = row.started_at ? new Date(row.started_at).toISOString() : null;
        const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : null;

        if (row.estado === STATUS.NO_APROBADO) {
          return {
            type: "NO_APROBADO",
            severity: "high",
            usuario_id: row.usuario_id,
            nombre: user.nombre || "Colaborador sin nombre",
            codigo_interno: user.codigo_interno || null,
            area: user.area || null,
            attempt_count: row.attempt_count || 0,
            score: row.last_quiz_score ?? null,
            updated_at: updatedAt,
            message: `No aprobó la evaluación (${scoreLabel}).`,
          };
        }

        return {
          type: "INCOMPLETO",
          severity: "medium",
          usuario_id: row.usuario_id,
          nombre: user.nombre || "Colaborador sin nombre",
          codigo_interno: user.codigo_interno || null,
          area: user.area || null,
          attempt_count: row.attempt_count || 0,
          score: row.last_quiz_score ?? null,
          started_at: startedAt,
          updated_at: updatedAt,
          message: "Proceso iniciado pero no completado.",
        };
      });

    return json(200, {
      ...counters,
      alerts_count: alerts.length,
      alerts,
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
