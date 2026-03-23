const { json, getSupabaseAdmin } = require("./_lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const token = String(event.queryStringParameters?.token || "").trim();
    const folio = String(event.queryStringParameters?.folio || "").trim();

    if (!token && !folio) {
      return json(400, { error: "token or folio is required" });
    }

    const supabase = getSupabaseAdmin();

    const query = supabase
      .from("certificados")
      .select("id,usuario_id,folio,issued_at,verify_token,score")
      .limit(1);

    const { data: certRows, error: certError } = token
      ? await query.eq("verify_token", token)
      : await query.eq("folio", folio);

    if (certError) {
      return json(500, { error: certError.message });
    }

    const cert = Array.isArray(certRows) ? certRows[0] : null;
    if (!cert) {
      return json(404, {
        valid: false,
        error: "Certificate not found",
      });
    }

    const { data: user, error: userError } = await supabase
      .from("usuarios")
      .select("id,nombre,codigo_interno,area")
      .eq("id", cert.usuario_id)
      .maybeSingle();

    if (userError) {
      return json(500, { error: userError.message });
    }

    return json(200, {
      valid: true,
      certificate: {
        id: cert.id,
        folio: cert.folio,
        issued_at: cert.issued_at,
        score: cert.score,
      },
      user: user
        ? {
            id: user.id,
            nombre: user.nombre,
            codigo_interno: user.codigo_interno,
            area: user.area,
          }
        : null,
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
