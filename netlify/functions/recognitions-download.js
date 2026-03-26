const {
  RECOGNITION_BUCKET,
  json,
  getSupabaseAdmin,
  requireAdmin,
  createSignedDownloadUrl,
} = require("./_lib/common");
const { buildRecognitionPdf, getVerifyUrl } = require("./recognitions-generate");

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

function isMissingPhotoColumn(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("does not exist") && message.includes("photo_data_url");
}

async function fetchRecognitionByLookup(supabase, { id, folio }) {
  const hasFolio = Boolean(String(folio || "").trim());

  const applyLookup = (query) => {
    if (hasFolio) {
      return query.eq("folio", String(folio).trim());
    }
    return query.eq("id", String(id || "").trim());
  };

  const withPhoto = await applyLookup(
    supabase
      .from("reconocimientos")
      .select("id,folio,file_path,issued_at,score,verify_token,usuario_id,photo_data_url")
  ).maybeSingle();

  if (!withPhoto.error) {
    return { data: withPhoto.data || null, error: null };
  }

  if (!isMissingPhotoColumn(withPhoto.error)) {
    return { data: null, error: withPhoto.error };
  }

  const fallback = await applyLookup(
    supabase
      .from("reconocimientos")
      .select("id,folio,file_path,issued_at,score,verify_token,usuario_id")
  ).maybeSingle();

  if (fallback.error) {
    return { data: null, error: fallback.error };
  }

  return {
    data: fallback.data ? { ...fallback.data, photo_data_url: null } : null,
    error: null,
  };
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
    const folio = String(event?.queryStringParameters?.folio || "").trim();
    const refresh = String(event?.queryStringParameters?.refresh || "1").trim() !== "0";

    if (!id && !folio) {
      return json(400, { error: "Recognition id is required" });
    }

    const supabase = getSupabaseAdmin();

    const { data: recognition, error } = await fetchRecognitionByLookup(supabase, { id, folio });

    if (error) {
      return json(500, { error: error.message });
    }

    if (!recognition) {
      return json(404, { error: "Recognition not found" });
    }

    if (refresh) {
      try {
        const { data: user, error: userError } = await supabase
          .from("usuarios")
          .select("id,nombre")
          .eq("id", recognition.usuario_id)
          .maybeSingle();

        if (!userError && user) {
          let legacyPdfBytes = null;
          try {
            const legacyFile = await supabase.storage
              .from(RECOGNITION_BUCKET)
              .download(recognition.file_path);
            if (legacyFile.data) {
              legacyPdfBytes = Buffer.from(await legacyFile.data.arrayBuffer());
            }
          } catch {
            legacyPdfBytes = null;
          }

          const refreshedPdf = await buildRecognitionPdf({
            employeeName: user.nombre,
            folio: recognition.folio,
            issuedAtIso: recognition.issued_at || new Date().toISOString(),
            score: Number.isFinite(Number(recognition.score)) ? Number(recognition.score) : null,
            verifyUrl: getVerifyUrl(recognition.verify_token),
            photoDataUrl: recognition.photo_data_url || "",
            legacyPdfBytes,
          });

          await supabase.storage
            .from(RECOGNITION_BUCKET)
            .upload(recognition.file_path, Buffer.from(refreshedPdf), {
              contentType: "application/pdf",
              upsert: true,
            });
        }
      } catch {
        // Si falla la regeneración, se usa el archivo previo para no romper descarga.
      }
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
