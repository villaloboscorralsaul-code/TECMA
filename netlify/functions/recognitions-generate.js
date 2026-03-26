const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const {
  STATUS,
  RECOGNITION_BUCKET,
  QUIZ_TOTAL_QUESTIONS,
  json,
  parseBody,
  getSupabaseAdmin,
  fetchProgressByUser,
  hasRecognition,
  markProgressCompleted,
  randomToken,
  buildRecognitionFolio,
  nowIso,
  ensureRecognitionsBucket,
  createSignedDownloadUrl,
  logAudit,
} = require("./_lib/common");

function getVerifyUrl(token) {
  const baseUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    return `/api/recognitions/verify?token=${token}`;
  }
  return `${baseUrl}/api/recognitions/verify?token=${token}`;
}

function getPublicAssetBaseUrl() {
  return (process.env.PUBLIC_SITE_URL || process.env.URL || "").replace(/\/$/, "");
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

function getAssetCandidates(filename) {
  return [
    path.resolve(__dirname, "..", "..", "assets", filename),
    path.resolve(__dirname, "..", "..", filename),
  ];
}

async function embedLocalPng(pdfDoc, filename) {
  for (const assetPath of getAssetCandidates(filename)) {
    try {
      if (!fs.existsSync(assetPath)) {
        continue;
      }

      const bytes = fs.readFileSync(assetPath);
      return await pdfDoc.embedPng(bytes);
    } catch {
      // Continue with next candidate.
    }
  }

  return null;
}

async function embedRemotePng(pdfDoc, filename) {
  const baseUrl = getPublicAssetBaseUrl();
  if (!baseUrl || typeof fetch !== "function") {
    return null;
  }

  const candidates = [
    `${baseUrl}/assets/${filename}`,
    `${baseUrl}/${filename}`,
  ];

  for (const assetUrl of candidates) {
    try {
      const response = await fetch(assetUrl, { redirect: "follow" });
      if (!response.ok) {
        continue;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      return await pdfDoc.embedPng(bytes);
    } catch {
      // Continue with next candidate.
    }
  }

  return null;
}

async function embedAssetPng(pdfDoc, filename) {
  return (await embedLocalPng(pdfDoc, filename)) || (await embedRemotePng(pdfDoc, filename));
}

function wrapText(font, text, fontSize, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines = [];
  let current = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }

  lines.push(current);
  return lines;
}

function drawCenteredText(page, text, { font, size, color, y }) {
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = (page.getWidth() - textWidth) / 2;
  page.drawText(text, { x, y, size, font, color });
}

function drawCenteredTextInBox(page, text, { font, size, color, x, width, y }) {
  const textWidth = font.widthOfTextAtSize(text, size);
  const textX = x + (width - textWidth) / 2;
  page.drawText(text, { x: textX, y, size, font, color });
}

function drawFlagPill(page, { x, y, label, type, font, textColor, width = 48, height = 20, textSize = 8.2 }) {
  const stripeWidth = width / 3;

  let left = rgb(0.0, 0.41, 0.28);
  let center = rgb(1, 1, 1);
  let right = rgb(0.84, 0.23, 0.20);

  if (type === "USA") {
    left = rgb(0.19, 0.30, 0.52);
    center = rgb(1, 1, 1);
    right = rgb(0.79, 0.24, 0.22);
  }

  if (type === "CAN") {
    left = rgb(0.81, 0.24, 0.21);
    center = rgb(1, 1, 1);
    right = rgb(0.81, 0.24, 0.21);
  }

  page.drawRectangle({
    x,
    y,
    width: stripeWidth,
    height,
    color: left,
  });
  page.drawRectangle({
    x: x + stripeWidth,
    y,
    width: stripeWidth,
    height,
    color: center,
  });
  page.drawRectangle({
    x: x + stripeWidth * 2,
    y,
    width: stripeWidth,
    height,
    color: right,
  });

  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.78, 0.82, 0.90),
    borderWidth: 0.8,
  });

  const textWidth = font.widthOfTextAtSize(label, textSize);
  const textX = x + (width - textWidth) / 2;
  const textY = y + (height - textSize) / 2 + 1;
  page.drawText(label, {
    x: textX,
    y: textY,
    size: textSize,
    font,
    color: textColor,
  });
}

function drawDashedLine(page, { x1, x2, y, color, thickness = 1, dash = 6, gap = 4 }) {
  let cursor = x1;
  while (cursor < x2) {
    const end = Math.min(cursor + dash, x2);
    page.drawLine({
      start: { x: cursor, y },
      end: { x: end, y },
      thickness,
      color,
    });
    cursor = end + gap;
  }
}

async function buildVerifyQrImage(pdfDoc, payload) {
  try {
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 260,
      color: {
        dark: "#1a2b4c",
        light: "#ffffff",
      },
    });

    const base64 = String(dataUrl).split(",")[1];
    if (!base64) {
      return null;
    }

    return await pdfDoc.embedPng(Buffer.from(base64, "base64"));
  } catch {
    return null;
  }
}

function fitImageContain(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return {
    width: image.width * scale,
    height: image.height * scale,
  };
}

async function buildRecognitionPdf({
  employeeName,
  folio,
  issuedAtIso,
  score,
  verifyUrl,
  photoDataUrl,
  legacyPdfBytes = null,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();

  const colors = {
    white: rgb(1, 1, 1),
    paper: rgb(0.985, 0.987, 0.995),
    navy: rgb(0.10, 0.17, 0.30),
    navySoft: rgb(0.17, 0.28, 0.47),
    orange: rgb(0.95, 0.48, 0.13),
    line: rgb(0.75, 0.80, 0.88),
    text: rgb(0.15, 0.22, 0.35),
    green: rgb(0.18, 0.62, 0.36),
  };

  const issuedDateLabel = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(issuedAtIso));
  const safeEmployeeName = String(employeeName || "COLABORADOR")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const safeScore = Number.isFinite(Number(score)) ? Number(score) : null;

  const logoImage = await embedAssetPng(pdfDoc, "tecma-logo.png");
  const watermarkImage = await embedAssetPng(pdfDoc, "tecma-badge.png");
  const headerBadgeImage = await embedAssetPng(pdfDoc, "tecma-badge-alt.png");

  let employeePhoto = null;
  const parsedImage = parseImageDataUrl(photoDataUrl);
  if (parsedImage) {
    const imageBytes = Buffer.from(parsedImage.base64, "base64");
    try {
      employeePhoto = parsedImage.mime.includes("png")
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);
    } catch {
      employeePhoto = null;
    }
  }

  let legacyPhotoSlice = null;
  if (!employeePhoto && legacyPdfBytes) {
    try {
      const legacyDoc = await PDFDocument.load(legacyPdfBytes);
      const legacyPage = legacyDoc.getPage(0);
      legacyPhotoSlice = await pdfDoc.embedPage(legacyPage, {
        left: 441,
        bottom: 564,
        right: 541,
        top: 682,
      });
    } catch {
      legacyPhotoSlice = null;
    }
  }

  const outer = { x: 20, y: 20, width: pageWidth - 40, height: pageHeight - 40 };
  const inner = { x: 28, y: 28, width: pageWidth - 56, height: pageHeight - 56 };

  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: colors.paper });
  page.drawRectangle({
    x: outer.x,
    y: outer.y,
    width: outer.width,
    height: outer.height,
    borderColor: colors.navy,
    borderWidth: 2.2,
  });
  page.drawRectangle({
    x: inner.x,
    y: inner.y,
    width: inner.width,
    height: inner.height,
    borderColor: colors.orange,
    borderWidth: 1.2,
  });

  const header = {
    x: inner.x + 1,
    y: pageHeight - 84,
    width: inner.width - 2,
    height: 52,
  };
  page.drawRectangle({
    x: header.x,
    y: header.y,
    width: header.width,
    height: header.height,
    color: colors.navy,
  });
  page.drawRectangle({
    x: header.x,
    y: header.y,
    width: header.width,
    height: header.height / 2,
    color: colors.navySoft,
    opacity: 0.55,
  });

  const logoFrame = { x: inner.x + 12, y: header.y + 8, width: 165, height: 36 };
  page.drawRectangle({
    x: logoFrame.x,
    y: logoFrame.y,
    width: logoFrame.width,
    height: logoFrame.height,
    color: colors.white,
    borderColor: rgb(0.80, 0.84, 0.91),
    borderWidth: 0.8,
  });

  if (logoImage) {
    const fitted = fitImageContain(logoImage, logoFrame.width - 14, logoFrame.height - 10);
    page.drawImage(logoImage, {
      x: logoFrame.x + (logoFrame.width - fitted.width) / 2,
      y: logoFrame.y + (logoFrame.height - fitted.height) / 2,
      width: fitted.width,
      height: fitted.height,
    });
  } else {
    page.drawText("TECMA", {
      x: logoFrame.x + 12,
      y: logoFrame.y + 8,
      size: 22,
      font: fontBold,
      color: colors.navy,
    });
  }

  page.drawText("Programa de Cumplimiento Social", {
    x: logoFrame.x + logoFrame.width + 10,
    y: header.y + 31,
    size: 11.2,
    font: fontBold,
    color: colors.white,
  });
  page.drawText("Tratado entre México, Estados Unidos y Canadá", {
    x: logoFrame.x + logoFrame.width + 10,
    y: header.y + 12,
    size: 8.4,
    font: fontRegular,
    color: rgb(0.85, 0.90, 0.98),
  });

  const flagsX = inner.x + inner.width - 166;
  drawFlagPill(page, {
    x: flagsX,
    y: header.y + 16,
    label: "MEX",
    type: "MEX",
    font: fontBold,
    textColor: colors.navy,
    width: 48,
    height: 20,
    textSize: 8.2,
  });
  drawFlagPill(page, {
    x: flagsX + 52,
    y: header.y + 16,
    label: "USA",
    type: "USA",
    font: fontBold,
    textColor: colors.navy,
    width: 48,
    height: 20,
    textSize: 8.2,
  });
  drawFlagPill(page, {
    x: flagsX + 104,
    y: header.y + 16,
    label: "CAN",
    type: "CAN",
    font: fontBold,
    textColor: colors.navy,
    width: 48,
    height: 20,
    textSize: 8.2,
  });

  if (headerBadgeImage) {
    const badgeFit = fitImageContain(headerBadgeImage, 34, 34);
    page.drawRectangle({
      x: inner.x + inner.width - 56,
      y: header.y + 9,
      width: 38,
      height: 38,
      color: colors.white,
      borderColor: rgb(0.78, 0.82, 0.90),
      borderWidth: 0.8,
    });
    page.drawImage(headerBadgeImage, {
      x: inner.x + inner.width - 54 + (34 - badgeFit.width) / 2,
      y: header.y + 11 + (34 - badgeFit.height) / 2,
      width: badgeFit.width,
      height: badgeFit.height,
    });
  }

  if (watermarkImage) {
    const watermarkSize = fitImageContain(watermarkImage, 260, 260);
    page.drawImage(watermarkImage, {
      x: (pageWidth - watermarkSize.width) / 2,
      y: (pageHeight - watermarkSize.height) / 2 - 70,
      width: watermarkSize.width,
      height: watermarkSize.height,
      opacity: 0.07,
    });
  }

  drawCenteredText(page, "RECONOCIMIENTO DE CUMPLIMIENTO DE POLÍTICA SOCIAL T-MEC", {
    font: fontBold,
    size: 14,
    color: rgb(0.82, 0.44, 0.12),
    y: 686,
  });

  const textX = 46;
  const textTopY = 648;
  const textWidth = 350;
  const bodyText = `Por medio del presente se reconoce que ${safeEmployeeName}, colaborador(a) de TECMA Transportation Services S. de R.L. de C.V., realizó la lectura del documento y la visualización del video correspondiente a la Política Social, como parte de las actividades internas de difusión, conocimiento y fortalecimiento de la cultura de cumplimiento de la empresa con especial énfasis en la prevención del Trabajo Forzado e Infantil, en cumplimiento con el Capítulo 23 del Tratado del T-MEC.`;
  const lines = wrapText(fontRegular, bodyText, 11.8, textWidth);
  let cursorY = textTopY;
  for (const line of lines) {
    page.drawText(line, {
      x: textX,
      y: cursorY,
      size: 11.8,
      font: fontRegular,
      color: colors.text,
    });
    cursorY -= 19;
  }

  const photoCard = { x: 420, y: 505, width: 142, height: 220 };
  page.drawRectangle({
    x: photoCard.x,
    y: photoCard.y,
    width: photoCard.width,
    height: photoCard.height,
    color: rgb(0.95, 0.96, 0.99),
    borderColor: colors.line,
    borderWidth: 1.1,
  });

  drawFlagPill(page, {
    x: photoCard.x + 13,
    y: photoCard.y + photoCard.height - 30,
    label: "MEX",
    type: "MEX",
    font: fontBold,
    textColor: colors.navy,
    width: 36,
    height: 20,
    textSize: 7.4,
  });
  drawFlagPill(page, {
    x: photoCard.x + 53,
    y: photoCard.y + photoCard.height - 30,
    label: "USA",
    type: "USA",
    font: fontBold,
    textColor: colors.navy,
    width: 36,
    height: 20,
    textSize: 7.4,
  });
  drawFlagPill(page, {
    x: photoCard.x + 93,
    y: photoCard.y + photoCard.height - 30,
    label: "CAN",
    type: "CAN",
    font: fontBold,
    textColor: colors.navy,
    width: 36,
    height: 20,
    textSize: 7.4,
  });

  const photoFrame = { x: photoCard.x + 18, y: photoCard.y + 56, width: 106, height: 124 };
  page.drawRectangle({
    x: photoFrame.x,
    y: photoFrame.y,
    width: photoFrame.width,
    height: photoFrame.height,
    borderColor: colors.navy,
    borderWidth: 1.5,
  });

  if (employeePhoto) {
    const fittedPhoto = fitImageContain(employeePhoto, photoFrame.width - 6, photoFrame.height - 6);
    page.drawImage(employeePhoto, {
      x: photoFrame.x + (photoFrame.width - fittedPhoto.width) / 2,
      y: photoFrame.y + (photoFrame.height - fittedPhoto.height) / 2,
      width: fittedPhoto.width,
      height: fittedPhoto.height,
    });
  } else if (legacyPhotoSlice) {
    page.drawPage(legacyPhotoSlice, {
      x: photoFrame.x + 3,
      y: photoFrame.y + 3,
      width: photoFrame.width - 6,
      height: photoFrame.height - 6,
    });
  } else {
    page.drawRectangle({
      x: photoFrame.x + 3,
      y: photoFrame.y + 3,
      width: photoFrame.width - 6,
      height: photoFrame.height - 6,
      color: rgb(0.90, 0.92, 0.97),
    });
    drawCenteredTextInBox(page, "SIN FOTO", {
      font: fontBold,
      size: 12,
      color: colors.navySoft,
      x: photoFrame.x,
      width: photoFrame.width,
      y: photoFrame.y + photoFrame.height / 2 - 6,
    });
  }

  drawCenteredTextInBox(page, "FOTOGRAFÍA DEL COLABORADOR", {
    font: fontBold,
    size: 7.8,
    color: rgb(0.27, 0.35, 0.52),
    x: photoCard.x,
    width: photoCard.width,
    y: photoCard.y + 12,
  });

  drawDashedLine(page, {
    x1: 46,
    x2: inner.x + inner.width - 20,
    y: 470,
    color: colors.line,
    thickness: 1,
  });

  page.drawText("Fecha de finalización:", {
    x: 46,
    y: 438,
    size: 11.2,
    font: fontBold,
    color: colors.navy,
  });
  page.drawText(issuedDateLabel, {
    x: 166,
    y: 438,
    size: 11.2,
    font: fontRegular,
    color: colors.text,
  });

  page.drawText("Folio:", {
    x: 46,
    y: 404,
    size: 11.2,
    font: fontBold,
    color: colors.navy,
  });
  page.drawText(folio, {
    x: 84,
    y: 404,
    size: 11.2,
    font: fontRegular,
    color: colors.text,
  });

  page.drawText(
    safeScore == null
      ? "Calificación: registrada"
      : `Calificación: ${safeScore}/${QUIZ_TOTAL_QUESTIONS}`,
    {
      x: 46,
      y: 370,
      size: 11.2,
      font: fontBold,
      color: colors.green,
    }
  );

  page.drawLine({
    start: { x: 46, y: 196 },
    end: { x: 212, y: 196 },
    thickness: 1.2,
    color: colors.navySoft,
  });
  page.drawText("Comité de Cumplimiento Social T-MEC", {
    x: 46,
    y: 175,
    size: 10.5,
    font: fontRegular,
    color: colors.text,
  });

  page.drawLine({
    start: { x: 332, y: 196 },
    end: { x: 548, y: 196 },
    thickness: 1.2,
    color: colors.navySoft,
  });
  page.drawText("GEORGINA SÁNCHEZ", {
    x: 332,
    y: 175,
    size: 10.5,
    font: fontRegular,
    color: colors.text,
  });
  page.drawText("Representante Legal", {
    x: 332,
    y: 160,
    size: 10,
    font: fontRegular,
    color: colors.text,
  });

  page.drawLine({
    start: { x: 46, y: 110 },
    end: { x: inner.x + inner.width - 20, y: 110 },
    thickness: 0.9,
    color: colors.line,
  });

  const verifyQrImage = await buildVerifyQrImage(pdfDoc, verifyUrl);
  if (verifyQrImage) {
    page.drawImage(verifyQrImage, {
      x: 46,
      y: 40,
      width: 66,
      height: 66,
    });
    page.drawRectangle({
      x: 46,
      y: 40,
      width: 66,
      height: 66,
      borderColor: colors.navy,
      borderWidth: 1,
    });
  } else {
    page.drawRectangle({
      x: 46,
      y: 40,
      width: 66,
      height: 66,
      color: colors.white,
      borderColor: colors.navy,
      borderWidth: 1,
    });
  }

  const verifyLabel = `Verificación: ${verifyUrl}`;
  const verifyLines = wrapText(fontRegular, verifyLabel, 8.5, 410);
  let verifyY = 88;
  for (const line of verifyLines.slice(0, 3)) {
    page.drawText(line, {
      x: 122,
      y: verifyY,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.29, 0.36, 0.50),
    });
    verifyY -= 11;
  }

  return pdfDoc.save();
}

async function fetchRecognitionByUserWithPhoto(supabase, userId) {
  const withPhoto = await supabase
    .from("reconocimientos")
    .select("id,folio,issued_at,file_path,verify_token,photo_data_url")
    .eq("usuario_id", userId)
    .maybeSingle();

  if (!withPhoto.error) {
    return { data: withPhoto.data || null, error: null, hasPhotoColumn: true };
  }

  const message = String(withPhoto.error.message || "").toLowerCase();
  if (!(message.includes("does not exist") && message.includes("photo_data_url"))) {
    return { data: null, error: withPhoto.error, hasPhotoColumn: true };
  }

  const fallback = await supabase
    .from("reconocimientos")
    .select("id,folio,issued_at,file_path,verify_token")
    .eq("usuario_id", userId)
    .maybeSingle();

  if (fallback.error) {
    return { data: null, error: fallback.error, hasPhotoColumn: false };
  }

  return {
    data: fallback.data ? { ...fallback.data, photo_data_url: null } : null,
    error: null,
    hasPhotoColumn: false,
  };
}

async function insertRecognitionWithPhotoSupport(supabase, payload) {
  const withPhoto = await supabase
    .from("reconocimientos")
    .insert(payload)
    .select("id,folio,issued_at,file_path,verify_token,photo_data_url")
    .single();

  if (!withPhoto.error) {
    return { data: withPhoto.data, error: null, hasPhotoColumn: true };
  }

  const message = String(withPhoto.error.message || "").toLowerCase();
  if (!(message.includes("does not exist") && message.includes("photo_data_url"))) {
    return { data: null, error: withPhoto.error, hasPhotoColumn: true };
  }

  const { photo_data_url, ...fallbackPayload } = payload;
  void photo_data_url;

  const fallback = await supabase
    .from("reconocimientos")
    .insert(fallbackPayload)
    .select("id,folio,issued_at,file_path,verify_token")
    .single();

  if (fallback.error) {
    return { data: null, error: fallback.error, hasPhotoColumn: false };
  }

  return {
    data: { ...fallback.data, photo_data_url: null },
    error: null,
    hasPhotoColumn: false,
  };
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
      .select("id,nombre,codigo_interno")
      .eq("id", userId)
      .maybeSingle();

    if (userError) {
      return json(500, { error: userError.message });
    }

    if (!user) {
      return json(404, { error: "User not found" });
    }

    if (!String(user.codigo_interno || "").trim()) {
      return json(400, {
        error:
          "No se puede generar el reconocimiento: el número de empleado (codigo_interno) es obligatorio.",
      });
    }

    const { data: progress, error: progressError } = await fetchProgressByUser(supabase, userId, [
      "estado",
    ]);

    if (progressError) {
      return json(500, { error: progressError.message });
    }

    if (progress?.estado === STATUS.COMPLETADO || hasRecognition(progress)) {
      return json(403, {
        blocked: true,
        error:
          "Este colaborador ya completó el flujo y cuenta con reconocimiento emitido. No es posible rehacer el proceso.",
      });
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

    const {
      data: existingRecognition,
      error: existingError,
    } = await fetchRecognitionByUserWithPhoto(supabase, userId);

    if (existingError) {
      return json(500, { error: existingError.message });
    }

    if (existingRecognition?.file_path) {
      const completedAt = nowIso();

      await ensureRecognitionsBucket(supabase);

      let legacyPdfBytes = null;
      if (existingRecognition.file_path) {
        try {
          const legacyFile = await supabase.storage
            .from(RECOGNITION_BUCKET)
            .download(existingRecognition.file_path);
          if (legacyFile.data) {
            legacyPdfBytes = Buffer.from(await legacyFile.data.arrayBuffer());
          }
        } catch {
          legacyPdfBytes = null;
        }
      }

      const refreshedPdf = await buildRecognitionPdf({
        employeeName: user.nombre,
        folio: existingRecognition.folio,
        issuedAtIso: existingRecognition.issued_at || completedAt,
        score: latestAttempt.score,
        verifyUrl: getVerifyUrl(existingRecognition.verify_token),
        photoDataUrl: photoDataUrl || existingRecognition.photo_data_url || "",
        legacyPdfBytes,
      });

      const { error: refreshUploadError } = await supabase.storage
        .from(RECOGNITION_BUCKET)
        .upload(existingRecognition.file_path, Buffer.from(refreshedPdf), {
          contentType: "application/pdf",
          upsert: true,
        });

      if (refreshUploadError) {
        return json(500, { error: refreshUploadError.message });
      }

      const { error: refreshProgressError } = await markProgressCompleted(supabase, {
        userId,
        completedAt,
        recognitionId: existingRecognition.id,
      });

      if (refreshProgressError) {
        return json(500, { error: refreshProgressError.message });
      }

      await logAudit(supabase, {
        usuarioId: userId,
        actor: "SYSTEM",
        action: "RECOGNITION_REFRESHED",
        metadata: { recognition_id: existingRecognition.id, folio: existingRecognition.folio },
      });

      const downloadUrl = await createSignedDownloadUrl(supabase, existingRecognition.file_path);
      return json(200, {
        recognition: {
          id: existingRecognition.id,
          folio: existingRecognition.folio,
          issued_at: existingRecognition.issued_at,
          verify_url: getVerifyUrl(existingRecognition.verify_token),
          download_url: downloadUrl,
          existing: true,
        },
      });
    }

    await ensureRecognitionsBucket(supabase);

    const issuedAt = nowIso();
    const folio = buildRecognitionFolio(user.codigo_interno, "2026");
    const verifyToken = randomToken(20);
    const verifyUrl = getVerifyUrl(verifyToken);
    const pdfBytes = await buildRecognitionPdf({
      employeeName: user.nombre,
      folio,
      issuedAtIso: issuedAt,
      score: latestAttempt.score,
      verifyUrl,
      photoDataUrl,
    });
    const filePath = `user-${user.id}/${folio}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from(RECOGNITION_BUCKET)
      .upload(filePath, Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return json(500, { error: uploadError.message });
    }

    const { data: createdRecognition, error: insertError } = await insertRecognitionWithPhotoSupport(
      supabase,
      {
        usuario_id: userId,
        folio,
        verify_token: verifyToken,
        issued_at: issuedAt,
        score: latestAttempt.score,
        file_path: filePath,
        photo_data_url: photoDataUrl || null,
      }
    );

    if (insertError) {
      await supabase.storage.from(RECOGNITION_BUCKET).remove([filePath]);
      const lowerMessage = String(insertError.message || "").toLowerCase();
      if (lowerMessage.includes("duplicate")) {
        return json(409, {
          error:
            "No se pudo generar el reconocimiento porque el folio ya existe. Verifica que el número de empleado sea único.",
        });
      }
      return json(500, { error: insertError.message });
    }

    const completedAt = nowIso();
    const { error: updateProgressError } = await markProgressCompleted(supabase, {
      userId,
      completedAt,
      recognitionId: createdRecognition.id,
    });

    if (updateProgressError) {
      return json(500, { error: updateProgressError.message });
    }

    await logAudit(supabase, {
      usuarioId: userId,
      actor: "SYSTEM",
      action: "RECOGNITION_GENERATED",
      metadata: {
        recognition_id: createdRecognition.id,
        folio: createdRecognition.folio,
      },
    });

    const downloadUrl = await createSignedDownloadUrl(supabase, filePath);

    return json(201, {
      recognition: {
        id: createdRecognition.id,
        folio: createdRecognition.folio,
        issued_at: createdRecognition.issued_at,
        verify_url: getVerifyUrl(createdRecognition.verify_token),
        download_url: downloadUrl,
        existing: false,
      },
    });
  } catch (err) {
    return json(500, { error: err.message || "Unexpected error" });
  }
};

module.exports.buildRecognitionPdf = buildRecognitionPdf;
module.exports.getVerifyUrl = getVerifyUrl;
