const JSZip = require("jszip");
const {
  STATUS,
  RECOGNITION_BUCKET,
  json,
  getSupabaseAdmin,
  requireAdmin,
  slugify,
} = require("./_lib/common");

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

    const { data: recognitionRows, error: recognitionError } = await supabase
      .from("reconocimientos")
      .select("id,usuario_id,folio,file_path")
      .in("usuario_id", completedUserIds);

    if (recognitionError) {
      return json(500, { error: recognitionError.message });
    }

    if (!recognitionRows || recognitionRows.length === 0) {
      return json(404, { error: "No recognitions available to export" });
    }

    const zip = new JSZip();

    for (const recognition of recognitionRows) {
      const { data: fileData, error: fileError } = await supabase.storage
        .from(RECOGNITION_BUCKET)
        .download(recognition.file_path);

      if (fileError || !fileData) {
        continue;
      }

      const employeeName = userMap.get(recognition.usuario_id) || "usuario";
      const safeName = slugify(employeeName) || "usuario";
      const filename = `${recognition.folio}-${safeName}.pdf`;
      const buffer = Buffer.from(await fileData.arrayBuffer());

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
