const { json, getSupabaseAdmin, requireAdmin } = require("./_lib/common");
const { getVerifyUrl, normalizeRecognitionFolio } = require("./recognitions-generate");

function isMissingPhotoColumn(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message.includes("photo_data_url")) {
    return false;
  }

  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

async function fetchRecognitionByIdOrFolio(supabase, { id, folio }) {
  if (id) {
    const withPhoto = await supabase
      .from("reconocimientos")
      .select("id,usuario_id,folio,issued_at,verify_token,photo_data_url")
      .eq("id", id)
      .maybeSingle();

    if (!withPhoto.error) {
      return { row: withPhoto.data || null, error: null };
    }

    if (!isMissingPhotoColumn(withPhoto.error)) {
      return { row: null, error: withPhoto.error };
    }

    const fallback = await supabase
      .from("reconocimientos")
      .select("id,usuario_id,folio,issued_at,verify_token")
      .eq("id", id)
      .maybeSingle();

    if (fallback.error) {
      return { row: null, error: fallback.error };
    }

    return {
      row: fallback.data ? { ...fallback.data, photo_data_url: null } : null,
      error: null,
    };
  }

  const withPhoto = await supabase
    .from("reconocimientos")
    .select("id,usuario_id,folio,issued_at,verify_token,photo_data_url")
    .eq("folio", folio)
    .order("issued_at", { ascending: false })
    .limit(1);

  if (!withPhoto.error) {
    return { row: Array.isArray(withPhoto.data) ? withPhoto.data[0] || null : null, error: null };
  }

  if (!isMissingPhotoColumn(withPhoto.error)) {
    return { row: null, error: withPhoto.error };
  }

  const fallback = await supabase
    .from("reconocimientos")
    .select("id,usuario_id,folio,issued_at,verify_token")
    .eq("folio", folio)
    .order("issued_at", { ascending: false })
    .limit(1);

  if (fallback.error) {
    return { row: null, error: fallback.error };
  }

  const fallbackRow = Array.isArray(fallback.data) ? fallback.data[0] || null : null;
  return {
    row: fallbackRow ? { ...fallbackRow, photo_data_url: null } : null,
    error: null,
  };
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return require("node:crypto").timingSafeEqual(left, right);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const id = String(event?.queryStringParameters?.id || "").trim();
    const folio = String(event?.queryStringParameters?.folio || "").trim();
    const token = String(event?.queryStringParameters?.token || "").trim();

    if (!id && !folio) {
      return json(400, { error: "Recognition id or folio is required" });
    }

    const supabase = getSupabaseAdmin();
    const { row: recognition, error: recognitionError } = await fetchRecognitionByIdOrFolio(
      supabase,
      {
        id,
        folio,
      }
    );

    if (recognitionError) {
      return json(500, { error: recognitionError.message });
    }

    if (!recognition) {
      return json(404, { error: "Recognition not found" });
    }

    const tokenMatches = token && constantTimeEquals(token, recognition.verify_token);
    if (!tokenMatches) {
      const guard = requireAdmin(event);
      if (!guard.ok) {
        return guard.response;
      }
    }

    const { data: user, error: userError } = await supabase
      .from("usuarios")
      .select("id,nombre")
      .eq("id", recognition.usuario_id)
      .maybeSingle();

    if (userError) {
      return json(500, { error: userError.message });
    }

    return json(200, {
      recognition: {
        id: recognition.id,
        folio: normalizeRecognitionFolio(recognition.folio) || recognition.folio,
        issued_at: recognition.issued_at,
        verify_url: getVerifyUrl(recognition.verify_token),
        verify_token: recognition.verify_token,
        employee_name: user?.nombre || "COLABORADOR",
        photo_data_url: recognition.photo_data_url || "",
      },
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
