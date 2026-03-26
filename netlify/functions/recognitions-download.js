const {
  RECOGNITION_BUCKET,
  json,
  getSupabaseAdmin,
  requireAdmin,
  createSignedDownloadUrl,
} = require("./_lib/common");
const {
  buildRecognitionPdf,
  getVerifyUrl,
  normalizeRecognitionFolio,
} = require("./recognitions-generate");

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
  if (!message.includes("photo_data_url")) {
    return false;
  }

  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
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
    const refresh = String(event?.queryStringParameters?.refresh || "").trim() === "1";
    const directDownload = String(event?.queryStringParameters?.direct || "").trim() === "1";

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

    let freshPdfBuffer = null;

    if (refresh) {
      const { data: user, error: userError } = await supabase
        .from("usuarios")
        .select("id,nombre")
        .eq("id", recognition.usuario_id)
        .maybeSingle();

      if (userError) {
        return json(500, { error: userError.message });
      }

      if (!user) {
        return json(404, { error: "User not found for this recognition" });
      }

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
      freshPdfBuffer = Buffer.from(refreshedPdf);

      const { error: refreshUploadError } = await supabase.storage
        .from(RECOGNITION_BUCKET)
        .upload(recognition.file_path, freshPdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (refreshUploadError) {
        return json(500, { error: refreshUploadError.message });
      }
    }

    const safeFolio = normalizeRecognitionFolio(recognition.folio);

    if (directDownload) {
      if (freshPdfBuffer) {
        return {
          statusCode: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${safeFolio || "reconocimiento"}.pdf"`,
            "cache-control": "no-store",
          },
          isBase64Encoded: true,
          body: freshPdfBuffer.toString("base64"),
        };
      }

      const { data: fileData, error: fileError } = await supabase.storage
        .from(RECOGNITION_BUCKET)
        .download(recognition.file_path);

      if (fileError || !fileData) {
        return json(500, { error: fileError?.message || "No fue posible descargar el archivo PDF." });
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${safeFolio || "reconocimiento"}.pdf"`,
          "cache-control": "no-store",
        },
        isBase64Encoded: true,
        body: buffer.toString("base64"),
      };
    }

    const downloadUrl = await createSignedDownloadUrl(supabase, recognition.file_path, 60 * 10);

    return json(200, {
      id: recognition.id,
      folio: safeFolio || recognition.folio,
      download_url: downloadUrl,
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
