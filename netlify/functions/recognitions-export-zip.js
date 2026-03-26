const JSZip = require("jszip");
const {
  STATUS,
  RECOGNITION_BUCKET,
  json,
  getSupabaseAdmin,
  requireAdmin,
  slugify,
} = require("./_lib/common");
const {
  buildRecognitionPdf,
  getVerifyUrl,
  normalizeRecognitionFolio,
} = require("./recognitions-generate");

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

async function fetchRecognitionsForUsers(supabase, userIds) {
  const withPhoto = await supabase
    .from("reconocimientos")
    .select("id,usuario_id,folio,file_path,issued_at,score,verify_token,photo_data_url")
    .in("usuario_id", userIds);

  if (!withPhoto.error) {
    return { rows: withPhoto.data || [], error: null };
  }

  if (!isMissingPhotoColumn(withPhoto.error)) {
    return { rows: [], error: withPhoto.error };
  }

  const fallback = await supabase
    .from("reconocimientos")
    .select("id,usuario_id,folio,file_path,issued_at,score,verify_token")
    .in("usuario_id", userIds);

  if (fallback.error) {
    return { rows: [], error: fallback.error };
  }

  return {
    rows: (fallback.data || []).map((row) => ({ ...row, photo_data_url: null })),
    error: null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const guard = requireAdmin(event);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const supabase = getSupabaseAdmin();
    const refresh = true;

    const { data: progressRows, error: progressError } = await supabase
      .from("progreso_test")
      .select("usuario_id")
      .eq("estado", STATUS.COMPLETADO);

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    const completedUserIds = (progressRows || []).map((row) => row.usuario_id);

    if (completedUserIds.length === 0) {
      return json(404, { error: "No completed users found" });
    }

    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id,nombre")
      .in("id", completedUserIds);

    if (usersError) {
      return json(500, { error: usersError.message });
    }

    const userMap = new Map((users || []).map((row) => [row.id, row.nombre]));

    const { rows: recognitionRows, error: recognitionError } = await fetchRecognitionsForUsers(
      supabase,
      completedUserIds
    );

    if (recognitionError) {
      return json(500, { error: recognitionError.message });
    }

    if (!recognitionRows || recognitionRows.length === 0) {
      return json(404, { error: "No recognitions available to export" });
    }

    const zip = new JSZip();

    for (const recognition of recognitionRows) {
      let outputBuffer = null;
      let fileData = null;
      let fileError = null;

      const downloaded = await supabase.storage.from(RECOGNITION_BUCKET).download(recognition.file_path);
      fileData = downloaded.data;
      fileError = downloaded.error;

      if (refresh && !fileError) {
        const legacyPdfBytes = fileData ? Buffer.from(await fileData.arrayBuffer()) : null;
        const refreshedPdf = await buildRecognitionPdf({
          employeeName: userMap.get(recognition.usuario_id) || "Colaborador",
          folio: recognition.folio,
          issuedAtIso: recognition.issued_at || new Date().toISOString(),
          score: Number.isFinite(Number(recognition.score)) ? Number(recognition.score) : null,
          verifyUrl: getVerifyUrl(recognition.verify_token),
          photoDataUrl: recognition.photo_data_url || "",
          legacyPdfBytes,
        });

        const { error: refreshUploadError } = await supabase.storage
          .from(RECOGNITION_BUCKET)
          .upload(recognition.file_path, Buffer.from(refreshedPdf), {
            contentType: "application/pdf",
            upsert: true,
          });

        if (refreshUploadError) {
          return json(500, {
            error: `No se pudo actualizar el reconocimiento ${recognition.folio}: ${refreshUploadError.message}`,
          });
        }
        outputBuffer = Buffer.from(refreshedPdf);
      }

      if (!outputBuffer && (fileError || !fileData)) {
        continue;
      }

      const employeeName = userMap.get(recognition.usuario_id) || "usuario";
      const safeName = slugify(employeeName) || "usuario";
      const safeFolio = normalizeRecognitionFolio(recognition.folio) || recognition.folio;
      const filename = `${safeFolio}-${safeName}.pdf`;
      const buffer = outputBuffer || Buffer.from(await fileData.arrayBuffer());

      zip.file(filename, buffer);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    if (!zipBuffer || zipBuffer.length === 0) {
      return json(500, { error: "ZIP generation failed" });
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="tecma-reconocimientos-completados.zip"',
        "cache-control": "no-store",
      },
      isBase64Encoded: true,
      body: zipBuffer.toString("base64"),
    };
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
