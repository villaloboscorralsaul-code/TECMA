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
      .select("estado");

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

    for (const row of progressRows || []) {
      if (row.estado === STATUS.PENDIENTE) counters.pendiente += 1;
      if (row.estado === STATUS.EN_PROCESO) counters.en_proceso += 1;
      if (row.estado === STATUS.COMPLETADO) counters.completado += 1;
      if (row.estado === STATUS.NO_APROBADO) counters.no_aprobado += 1;
    }

    const assigned =
      counters.pendiente +
      counters.en_proceso +
      counters.completado +
      counters.no_aprobado;

    if (counters.total > assigned) {
      counters.pendiente += counters.total - assigned;
    }

    return json(200, counters);
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
