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
      return json(400, { error: "Certificate id is required" });
    }

    const supabase = getSupabaseAdmin();

    const { data: cert, error } = await supabase
      .from("certificados")
      .select("id,folio,file_path")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return json(500, { error: error.message });
    }

    if (!cert) {
      return json(404, { error: "Certificate not found" });
    }

    const downloadUrl = await createSignedDownloadUrl(supabase, cert.file_path, 60 * 10);

    return json(200, {
      id: cert.id,
      folio: cert.folio,
      download_url: downloadUrl,
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
