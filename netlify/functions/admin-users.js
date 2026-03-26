const {
  RECOGNITION_BUCKET,
  STATUS,
  json,
  parseBody,
  getSupabaseAdmin,
  requireAdmin,
  getProgressMap,
  nowIso,
  logAudit,
} = require("./_lib/common");

function getIssuedAtTimestamp(recognition) {
  const timestamp = Date.parse(String(recognition?.issued_at || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pickLatestRecognition(recognitions) {
  if (!Array.isArray(recognitions) || recognitions.length === 0) {
    return null;
  }

  return recognitions.reduce((latest, current) => {
    if (!latest) {
      return current;
    }

    const currentTs = getIssuedAtTimestamp(current);
    const latestTs = getIssuedAtTimestamp(latest);
    if (currentTs > latestTs) {
      return current;
    }

    if (currentTs < latestTs) {
      return latest;
    }

    const currentId = String(current?.id || "");
    const latestId = String(latest?.id || "");
    return currentId > latestId ? current : latest;
  }, null);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "DELETE") {
    return json(405, { error: "Method not allowed" });
  }

  const guard = requireAdmin(event);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const supabase = getSupabaseAdmin();

    if (event.httpMethod === "DELETE") {
      const body = parseBody(event);
      const userId = String(event.queryStringParameters?.user_id || body.user_id || "").trim();

      if (!userId) {
        return json(400, { error: "'user_id' is required" });
      }

      const { data: user, error: userError } = await supabase
        .from("usuarios")
        .select("id,nombre,codigo_interno")
        .eq("id", userId)
        .maybeSingle();

      if (userError) {
        return json(500, { error: userError.message });
      }

      if (!user) {
        return json(404, { error: "User not found" });
      }

      const { data: recognitionRows, error: recognitionError } = await supabase
        .from("reconocimientos")
        .select("id,file_path,folio")
        .eq("usuario_id", userId);

      if (recognitionError) {
        return json(500, { error: recognitionError.message });
      }

      const filePaths = (recognitionRows || [])
        .map((row) => String(row.file_path || "").trim())
        .filter(Boolean);

      let storageWarning = "";
      if (filePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(RECOGNITION_BUCKET)
          .remove(filePaths);

        if (storageError) {
          storageWarning = storageError.message || "No fue posible limpiar todos los archivos del bucket.";
        }
      }

      await logAudit(supabase, {
        usuarioId: userId,
        actor: "ADMIN",
        action: "USER_DELETED",
        metadata: {
          deleted_user_id: userId,
          nombre: user.nombre || null,
          codigo_interno: user.codigo_interno || null,
          removed_recognition_files: filePaths.length,
          storage_warning: storageWarning || null,
          deleted_at: nowIso(),
        },
      });

      const { error: deleteError } = await supabase.from("usuarios").delete().eq("id", userId);
      if (deleteError) {
        return json(500, { error: deleteError.message });
      }

      return json(200, {
        ok: true,
        user: {
          id: user.id,
          nombre: user.nombre || null,
          codigo_interno: user.codigo_interno || null,
        },
        removed_recognition_files: filePaths.length,
        warning: storageWarning || null,
      });
    }

    const desiredStatus = String(event.queryStringParameters?.status || "ALL")
      .toUpperCase()
      .trim();

    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id,nombre,codigo_interno,area,created_at")
      .order("nombre", { ascending: true });

    if (usersError) {
      return json(500, { error: usersError.message });
    }

    const userRows = Array.isArray(users) ? users : [];
    const userIds = userRows.map((user) => user.id);

    const progressMap = await getProgressMap(supabase, userIds);

    let recognitionById = new Map();
    let recognitionByUser = new Map();
    if (userIds.length > 0) {
      const { data: recognitionRows, error: recognitionError } = await supabase
        .from("reconocimientos")
        .select("id,usuario_id,folio,issued_at,file_path")
        .in("usuario_id", userIds);

      if (recognitionError) {
        return json(500, { error: recognitionError.message });
      }

      const safeRows = Array.isArray(recognitionRows) ? recognitionRows : [];
      recognitionById = new Map(
        safeRows.map((recognition) => [String(recognition.id || ""), recognition])
      );
      recognitionByUser = safeRows.reduce((map, recognition) => {
        const userKey = String(recognition.usuario_id || "");
        if (!userKey) {
          return map;
        }
        const current = map.get(userKey) || [];
        current.push(recognition);
        map.set(userKey, current);
        return map;
      }, new Map());
    }

    let rows = userRows.map((user) => {
      const progress = progressMap.get(user.id);
      const preferredRecognitionId = String(progress?.recognition_id || "").trim();
      let recognition = preferredRecognitionId
        ? recognitionById.get(preferredRecognitionId) || null
        : null;

      if (!recognition) {
        recognition = pickLatestRecognition(recognitionByUser.get(String(user.id || "")));
      }

      return {
        id: user.id,
        nombre: user.nombre,
        codigo_interno: user.codigo_interno || null,
        area: user.area || null,
        estado: progress?.estado || STATUS.PENDIENTE,
        started_at: progress?.started_at || null,
        policy_accepted_at: progress?.policy_accepted_at || null,
        last_quiz_score: progress?.last_quiz_score ?? null,
        attempt_count: progress?.attempt_count ?? 0,
        completed_at: progress?.completed_at || null,
        recognition_id: recognition?.id || null,
        recognition_folio: recognition?.folio || null,
        recognition_issued_at: recognition?.issued_at || null,
      };
    });

    if (desiredStatus !== "ALL") {
      rows = rows.filter((row) => row.estado === desiredStatus);
    }

    return json(200, {
      rows,
      allowed_statuses: [
        "ALL",
        STATUS.PENDIENTE,
        STATUS.EN_PROCESO,
        STATUS.COMPLETADO,
        STATUS.NO_APROBADO,
      ],
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
