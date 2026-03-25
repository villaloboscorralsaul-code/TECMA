const {
  json,
  getSupabaseAdmin,
  requireAdmin,
  createSignedDownloadUrl,
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
    const id = String(event.queryStringParameters?.id || "").trim();

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
