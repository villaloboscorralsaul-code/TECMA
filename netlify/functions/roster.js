const { json, getSupabaseAdmin, getProgressMap, STATUS } = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: users, error } = await supabase
      .from("usuarios")
      .select("id,nombre,codigo_interno,area")
      .order("nombre", { ascending: true });

    if (error) {
      return json(500, { error: error.message });
    }

    const safeUsers = Array.isArray(users) ? users : [];
    const progressMap = await getProgressMap(
      supabase,
      safeUsers.map((user) => user.id)
    );

    const roster = safeUsers.map((user) => {
      const progress = progressMap.get(user.id);

      return {
        id: user.id,
        nombre: user.nombre,
        codigo_interno: user.codigo_interno || null,
        area: user.area || null,
        estado: progress?.estado || STATUS.PENDIENTE,
        has_certificate: Boolean(progress?.certificate_id),
      };
    });

    return json(200, { users: roster });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
