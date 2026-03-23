const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const {
  STATUS,
  CERT_BUCKET,
  json,
  parseBody,
  getSupabaseAdmin,
  randomToken,
  buildFolio,
  nowIso,
  ensureCertificatesBucket,
  createSignedDownloadUrl,
  logAudit,
} = require("./_lib/common");

function getVerifyUrl(token) {
  const baseUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    return `/api/certificates/verify?token=${token}`;
  }
  return `${baseUrl}/api/certificates/verify?token=${token}`;
}

function parseImageDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") {
    return null;
  }

  const match = dataUrl.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    mime: match[1].toLowerCase(),
    base64: match[3],
  };
}

async function buildCertificatePdf({ employeeName, folio, issuedAtIso, score, verifyUrl, photoDataUrl }) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const issuedDateLabel = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(issuedAtIso));

  page.drawRectangle({ x: 24, y: 24, width: 547.28, height: 793.89, borderColor: rgb(0.1, 0.17, 0.3), borderWidth: 2 });
  page.drawRectangle({ x: 30, y: 30, width: 535.28, height: 781.89, borderColor: rgb(0.95, 0.48, 0.13), borderWidth: 1 });

  page.drawText("TECMA", {
    x: 46,
    y: 770,
    size: 26,
    font: fontBold,
    color: rgb(0.1, 0.17, 0.3),
  });

  page.drawText("CERTIFICADO DE CUMPLIMIENTO DE POLITICA SOCIAL T-MEC", {
    x: 46,
    y: 730,
    size: 15,
    font: fontBold,
    color: rgb(0.82, 0.44, 0.12),
  });

  const textLines = [
    `Por la presente se certifica que ${employeeName}.`,
    "Ha leido, comprendido y aprobado el curso sobre la Politica Social del T-MEC,",
    "con especial enfasis en la prevencion del Trabajo Forzado, en cumplimiento con",
    "el Capitulo 23 del Tratado.",
  ];

  let y = 680;
  for (const line of textLines) {
    page.drawText(line, {
      x: 46,
      y,
      size: 12,
      font: fontRegular,
      color: rgb(0.16, 0.22, 0.33),
    });
    y -= 22;
  }

  page.drawText(`Folio: ${folio}`, {
    x: 46,
    y: 560,
    size: 12,
    font: fontBold,
    color: rgb(0.1, 0.17, 0.3),
  });

  page.drawText(`Fecha de finalizacion: ${issuedDateLabel}`, {
    x: 46,
    y: 540,
    size: 11,
    font: fontRegular,
    color: rgb(0.16, 0.22, 0.33),
  });

  page.drawText(`Calificacion: ${score}/5`, {
    x: 46,
    y: 520,
    size: 11,
    font: fontRegular,
    color: rgb(0.18, 0.62, 0.36),
  });

  const parsedImage = parseImageDataUrl(photoDataUrl);
  if (parsedImage) {
    const imageBytes = Buffer.from(parsedImage.base64, "base64");
    let embeddedImage;

    if (parsedImage.mime.includes("png")) {
      embeddedImage = await pdfDoc.embedPng(imageBytes);
    } else {
      embeddedImage = await pdfDoc.embedJpg(imageBytes);
    }

    const desiredHeight = 145;
    const scale = desiredHeight / embeddedImage.height;
    const desiredWidth = embeddedImage.width * scale;

    page.drawRectangle({
      x: 410,
      y: 520,
      width: 150,
      height: 180,
      borderColor: rgb(0.1, 0.17, 0.3),
      borderWidth: 1,
    });

    page.drawImage(embeddedImage, {
      x: 410 + (150 - desiredWidth) / 2,
      y: 540,
      width: desiredWidth,
      height: desiredHeight,
    });

    page.drawText("Fotografia del colaborador", {
      x: 420,
      y: 525,
      size: 9,
      font: fontRegular,
      color: rgb(0.28, 0.35, 0.47),
    });
  }

  page.drawText("Comite de Cumplimiento Social T-MEC", {
    x: 46,
    y: 170,
    size: 11,
    font: fontRegular,
    color: rgb(0.16, 0.22, 0.33),
  });

  page.drawText("____________________________", {
    x: 46,
    y: 186,
    size: 11,
    font: fontRegular,
    color: rgb(0.16, 0.22, 0.33),
  });

  page.drawText(`Verificacion: ${verifyUrl}`, {
    x: 46,
    y: 86,
    size: 9,
    font: fontRegular,
    color: rgb(0.28, 0.35, 0.47),
  });

  return pdfDoc.save();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = parseBody(event);
    const userId = String(body.user_id || "").trim();
    const photoDataUrl = body.employee_photo_data_url || "";

    if (!userId) {
      return json(400, { error: "'user_id' is required" });
    }

    const supabase = getSupabaseAdmin();

    const { data: user, error: userError } = await supabase
      .from("usuarios")
      .select("id,nombre")
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      return json(500, { error: userError.message });
    }

    if (!user) {
      return json(404, { error: "User not found" });
    }

    const { data: latestAttempt, error: attemptError } = await supabase
      .from("intentos_quiz")
      .select("id,score,passed,attempted_at")
      .eq("usuario_id", userId)
      .order("attempted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptError) {
      return json(500, { error: attemptError.message });
    }

    if (!latestAttempt || !latestAttempt.passed) {
      return json(400, {
        error: "User has not passed the quiz yet",
      });
    }

    const { data: existingCert, error: existingError } = await supabase
      .from("certificados")
      .select("id,folio,issued_at,file_path,verify_token")
      .eq("usuario_id", userId)
      .maybeSingle();

    if (existingError) {
      return json(500, { error: existingError.message });
    }

    if (existingCert?.file_path) {
      const completedAt = nowIso();
      await supabase
        .from("progreso_test")
        .update({
          estado: STATUS.COMPLETADO,
          completed_at: completedAt,
          certificate_id: existingCert.id,
          updated_at: completedAt,
        })
        .eq("usuario_id", userId);

      await logAudit(supabase, {
        usuarioId: userId,
        actor: "SYSTEM",
        action: "CERTIFICATE_REUSED",
        metadata: { certificate_id: existingCert.id, folio: existingCert.folio },
      });

      const downloadUrl = await createSignedDownloadUrl(supabase, existingCert.file_path);
      return json(200, {
        certificate: {
          id: existingCert.id,
          folio: existingCert.folio,
          issued_at: existingCert.issued_at,
          verify_url: getVerifyUrl(existingCert.verify_token),
          download_url: downloadUrl,
          existing: true,
        },
      });
    }

    await ensureCertificatesBucket(supabase);

    let createdCertificate = null;
    let uploadPath = null;

    for (let i = 0; i < 4; i += 1) {
      const issuedAt = nowIso();
      const folio = buildFolio(new Date());
      const verifyToken = randomToken(20);
      const verifyUrl = getVerifyUrl(verifyToken);
      const pdfBytes = await buildCertificatePdf({
        employeeName: user.nombre,
        folio,
        issuedAtIso: issuedAt,
        score: latestAttempt.score,
        verifyUrl,
        photoDataUrl,
      });

      const filePath = `user-${user.id}/${folio}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from(CERT_BUCKET)
        .upload(filePath, Buffer.from(pdfBytes), {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        continue;
      }

      const { data: insertedCert, error: insertError } = await supabase
        .from("certificados")
        .insert({
          usuario_id: userId,
          folio,
          verify_token: verifyToken,
          issued_at: issuedAt,
          score: latestAttempt.score,
          file_path: filePath,
        })
        .select("id,folio,issued_at,file_path,verify_token")
        .single();

      if (insertError) {
        await supabase.storage.from(CERT_BUCKET).remove([filePath]);
        continue;
      }

      createdCertificate = insertedCert;
      uploadPath = filePath;
      break;
    }

    if (!createdCertificate || !uploadPath) {
      return json(500, { error: "Unable to generate certificate after retries" });
    }

    const { error: updateProgressError } = await supabase
      .from("progreso_test")
      .update({
        estado: STATUS.COMPLETADO,
        completed_at: nowIso(),
        certificate_id: createdCertificate.id,
        updated_at: nowIso(),
      })
      .eq("usuario_id", userId);

    if (updateProgressError) {
      return json(500, { error: updateProgressError.message });
    }

    await logAudit(supabase, {
      usuarioId: userId,
      actor: "SYSTEM",
      action: "CERTIFICATE_GENERATED",
      metadata: {
        certificate_id: createdCertificate.id,
        folio: createdCertificate.folio,
      },
    });

    const downloadUrl = await createSignedDownloadUrl(supabase, uploadPath);

    return json(201, {
      certificate: {
        id: createdCertificate.id,
        folio: createdCertificate.folio,
        issued_at: createdCertificate.issued_at,
        verify_url: getVerifyUrl(createdCertificate.verify_token),
        download_url: downloadUrl,
        existing: false,
      },
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};
