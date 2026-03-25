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
      .from("reconocimientos")
      .select("id,usuario_id,folio,issued_at,verify_token,score")
      .limit(1);

    const { data: recognitionRows, error: recognitionError } = token
      ? await query.eq("verify_token", token)
      : await query.eq("folio", folio);

    if (recognitionError) {
      return json(500, { error: recognitionError.message });
    }

    const recognition = Array.isArray(recognitionRows) ? recognitionRows[0] : null;
    if (!recognition) {
      return json(404, {
        valid: false,
        error: "Recognition not found",
      });
    }

    const { data: user, error: userError } = await supabase
      .from("usuarios")
      .select("id,nombre,codigo_interno,area")
      .eq("id", recognition.usuario_id)
      .maybeSingle();

    if (userError) {
      return json(500, { error: userError.message });
    }

    return json(200, {
      valid: true,
      recognition: {
        id: recognition.id,
        folio: recognition.folio,
        issued_at: recognition.issued_at,
        score: recognition.score,
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
