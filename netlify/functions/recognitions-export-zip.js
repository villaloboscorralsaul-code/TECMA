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

function parseIssuedAtTimestamp(row) {
  const timestamp = Date.parse(String(row?.issued_at || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isMissingRecognitionIdColumn(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message.includes("recognition_id")) {
    return false;
  }

  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
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

async function fetchCompletedProgressRows(supabase) {
  const withRecognitionId = await supabase
    .from("progreso_test")
    .select("usuario_id,recognition_id")
    .eq("estado", STATUS.COMPLETADO);

  if (!withRecognitionId.error) {
    return { rows: withRecognitionId.data || [], error: null };
  }

  if (!isMissingRecognitionIdColumn(withRecognitionId.error)) {
    return { rows: [], error: withRecognitionId.error };
  }

  const fallback = await supabase
    .from("progreso_test")
    .select("usuario_id")
    .eq("estado", STATUS.COMPLETADO);

  if (fallback.error) {
    return { rows: [], error: fallback.error };
  }

  return {
    rows: (fallback.data || []).map((row) => ({
      usuario_id: row.usuario_id,
      recognition_id: null,
    })),
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
    const refresh = String(event?.queryStringParameters?.refresh || "").trim() === "1";

    const { rows: progressRows, error: progressError } = await fetchCompletedProgressRows(supabase);

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    const completedUserIds = Array.from(
      new Set((progressRows || []).map((row) => row.usuario_id).filter(Boolean))
    );

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

    const recognitionById = new Map();
    const latestRecognitionByUser = new Map();
    for (const recognition of recognitionRows) {
      const recId = String(recognition?.id || "").trim();
      const userId = String(recognition?.usuario_id || "").trim();
      if (recId) {
        recognitionById.set(recId, recognition);
      }
      if (!userId) {
        continue;
      }

      const latest = latestRecognitionByUser.get(userId);
      if (!latest) {
        latestRecognitionByUser.set(userId, recognition);
        continue;
      }

      const currentTs = parseIssuedAtTimestamp(latest);
      const nextTs = parseIssuedAtTimestamp(recognition);
      if (nextTs > currentTs) {
        latestRecognitionByUser.set(userId, recognition);
        continue;
      }

      if (nextTs === currentTs) {
        const latestId = String(latest?.id || "");
        if (recId > latestId) {
          latestRecognitionByUser.set(userId, recognition);
        }
      }
    }

    const selectedRecognitions = [];
    const seenRecognitionIds = new Set();
    for (const progressRow of progressRows || []) {
      const userId = String(progressRow?.usuario_id || "").trim();
      if (!userId) {
        continue;
      }

      const preferredRecognitionId = String(progressRow?.recognition_id || "").trim();
      const recognition =
        (preferredRecognitionId && recognitionById.get(preferredRecognitionId)) ||
        latestRecognitionByUser.get(userId) ||
        null;

      if (!recognition) {
        continue;
      }

      const recognitionId = String(recognition.id || "").trim();
      if (recognitionId && seenRecognitionIds.has(recognitionId)) {
        continue;
      }
      if (recognitionId) {
        seenRecognitionIds.add(recognitionId);
      }

      selectedRecognitions.push(recognition);
    }

    if (selectedRecognitions.length === 0) {
      return json(404, { error: "No recognitions available to export" });
    }

    const zip = new JSZip();

    for (const recognition of selectedRecognitions) {
      let outputBuffer = null;
      let fileData = null;
      let fileError = null;

      const downloaded = await supabase.storage.from(RECOGNITION_BUCKET).download(recognition.file_path);
      fileData = downloaded.data;
      fileError = downloaded.error;

      if (refresh) {
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

    if (Object.keys(zip.files).length === 0) {
      return json(404, {
        error:
          "No fue posible construir el ZIP porque ninguno de los reconocimientos tenía archivo PDF disponible.",
      });
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
