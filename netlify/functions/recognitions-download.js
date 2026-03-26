const {
  json,
  getSupabaseAdmin,
  requireAdmin,
  createSignedDownloadUrl,
} = require("./_lib/common");

function extractRecognitionId(event) {
  const queryId = String(event?.queryStringParameters?.id || "").trim();
  if (queryId) {
    return queryId;
  }

  const pathParamId = String(event?.pathParameters?.id || "").trim();
  if (pathParamId) {
    return pathParamId;
  }

  const rawPath = String(event?.path || event?.rawUrl || "").trim();
  const match = rawPath.match(/\/api\/recognitions\/([^/]+)\/download/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return String(match[1]).trim();
    }
  }

  return "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const guard = requireAdmin(event);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const id = extractRecognitionId(event);

    if (!id) {
      return json(400, { error: "Recognition id is required" });
    }

    const supabase = getSupabaseAdmin();

    const { data: recognition, error } = await supabase
      .from("reconocimientos")
      .select("id,folio,file_path")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return json(500, { error: error.message });
    }

    if (!recognition) {
      return json(404, { error: "Recognition not found" });
    }

    const downloadUrl = await createSignedDownloadUrl(supabase, recognition.file_path, 60 * 10);

    return json(200, {
      id: recognition.id,
      folio: recognition.folio,
      download_url: downloadUrl,
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
