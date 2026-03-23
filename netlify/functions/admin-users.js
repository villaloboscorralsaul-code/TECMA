const {
  STATUS,
  json,
  getSupabaseAdmin,
  requireAdmin,
  getProgressMap,
} = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const guard = requireAdmin(event);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const desiredStatus = String(event.queryStringParameters?.status || "ALL")
      .toUpperCase()
      .trim();

    const supabase = getSupabaseAdmin();

    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id,nombre,codigo_interno,area,created_at")
      .order("nombre", { ascending: true });

    if (usersError) {
      return json(500, { error: usersError.message });
    }

    const userRows = Array.isArray(users) ? users : [];
    const userIds = userRows.map((user) => user.id);

    const progressMap = await getProgressMap(supabase, userIds);

    let certificateMap = new Map();
    if (userIds.length > 0) {
      const { data: certRows, error: certError } = await supabase
        .from("certificados")
        .select("id,usuario_id,folio,issued_at,file_path")
        .in("usuario_id", userIds);

      if (certError) {
        return json(500, { error: certError.message });
      }

      certificateMap = new Map((certRows || []).map((cert) => [cert.usuario_id, cert]));
    }

    let rows = userRows.map((user) => {
      const progress = progressMap.get(user.id);
      const cert = certificateMap.get(user.id);

      return {
        id: user.id,
        nombre: user.nombre,
        codigo_interno: user.codigo_interno || null,
        area: user.area || null,
        estado: progress?.estado || STATUS.PENDIENTE,
        started_at: progress?.started_at || null,
        policy_accepted_at: progress?.policy_accepted_at || null,
        last_quiz_score: progress?.last_quiz_score ?? null,
        attempt_count: progress?.attempt_count ?? 0,
        completed_at: progress?.completed_at || null,
        certificate_id: cert?.id || null,
        certificate_folio: cert?.folio || null,
        certificate_issued_at: cert?.issued_at || null,
      };
    });

    if (desiredStatus !== "ALL") {
      rows = rows.filter((row) => row.estado === desiredStatus);
    }

    return json(200, {
      rows,
      allowed_statuses: [
        "ALL",
        STATUS.PENDIENTE,
        STATUS.EN_PROCESO,
        STATUS.COMPLETADO,
        STATUS.NO_APROBADO,
      ],
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
