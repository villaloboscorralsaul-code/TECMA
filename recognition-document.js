const refs = {
  status: document.querySelector("#recognitionDocumentStatus"),
  host: document.querySelector("#recognitionDocumentHost"),
};

function setStatus(message, isError = false) {
  if (!refs.status) {
    return;
  }

  refs.status.textContent = message || "";
  refs.status.classList.toggle("error", Boolean(isError && message));
}

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: String(params.get("id") || "").trim(),
    folio: String(params.get("folio") || "").trim(),
    token: String(params.get("token") || "").trim(),
    key: String(params.get("key") || "").trim(),
    mode: String(params.get("mode") || "preview").trim().toLowerCase(),
  };
}

async function loadRecognitionTemplateFromIndex() {
  const response = await fetch("/index.html", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No fue posible cargar la plantilla principal del reconocimiento.");
  }

  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const source = parsed.querySelector("#recognitionPrintArea");

  if (!source) {
    throw new Error("No se encontró la plantilla del reconocimiento en index.html.");
  }

  return source.outerHTML;
}

function buildRecognitionDetailUrl(query) {
  const params = new URLSearchParams();
  if (query.id) {
    params.set("id", query.id);
  }
  if (query.folio) {
    params.set("folio", query.folio);
  }
  if (query.token) {
    params.set("token", query.token);
  }
  if (query.key) {
    params.set("key", query.key);
  }

  return `/api/recognitions/detail?${params.toString()}`;
}

async function fetchRecognitionDetail(query) {
  const url = buildRecognitionDetailUrl(query);
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    let errorMessage = "No fue posible obtener el reconocimiento.";
    try {
      const payload = await response.json();
      errorMessage = payload.error || errorMessage;
    } catch {
      // no-op
    }
    throw new Error(errorMessage);
  }

  const payload = await response.json();
  if (!payload?.recognition) {
    throw new Error("Respuesta inválida al cargar el reconocimiento.");
  }

  return payload.recognition;
}

function formatIssuedDate(issuedAt) {
  const date = issuedAt ? new Date(issuedAt) : new Date();
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function drawQr(canvas, payload) {
  if (!canvas || !payload) {
    return;
  }

  if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
    window.QRCode.toCanvas(
      canvas,
      payload,
      {
        width: canvas.width,
        margin: 2,
        errorCorrectionLevel: "H",
        color: {
          dark: "#1a2b4c",
          light: "#ffffff",
        },
      },
      () => {
        // no-op
      }
    );
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#1a2b4c";
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  ctx.fillStyle = "#1a2b4c";
  ctx.font = "bold 10px Open Sans";
  ctx.fillText("QR", canvas.width / 2 - 10, canvas.height / 2);
}

function renderRecognition(recognition) {
  const nameEl = document.querySelector("#recognitionName");
  const dateEl = document.querySelector("#recognitionDate");
  const folioEl = document.querySelector("#recognitionFolio");
  const photoEl = document.querySelector("#recognitionPhoto");
  const photoFallbackEl = document.querySelector("#recognitionPhotoFallback");
  const verifyUrlEl = document.querySelector("#verifyUrl");
  const qrCanvas = document.querySelector("#recognitionQr");

  if (nameEl) {
    nameEl.textContent = recognition.employee_name || "COLABORADOR";
  }

  if (dateEl) {
    dateEl.textContent = formatIssuedDate(recognition.issued_at);
  }

  if (folioEl) {
    folioEl.textContent = recognition.folio || "-";
  }

  const photoDataUrl = String(recognition.photo_data_url || "").trim();
  if (photoEl && photoFallbackEl) {
    if (photoDataUrl) {
      photoEl.src = photoDataUrl;
      photoEl.classList.remove("hidden");
      photoFallbackEl.classList.add("hidden");
    } else {
      photoEl.src = "";
      photoEl.classList.add("hidden");
      photoFallbackEl.classList.remove("hidden");
    }
  }

  const verifyUrl = String(recognition.verify_url || "").trim();
  if (verifyUrlEl) {
    if (verifyUrl) {
      verifyUrlEl.innerHTML = `<a href="${verifyUrl}" target="_blank" rel="noopener noreferrer">${verifyUrl}</a>`;
    } else {
      verifyUrlEl.textContent = `Folio: ${recognition.folio || "-"}`;
    }
  }

  if (qrCanvas) {
    const payload = verifyUrl || `Folio: ${recognition.folio || ""}`;
    drawQr(qrCanvas, payload);
  }
}

async function downloadAsPdf(recognition) {
  await ensureHtml2Pdf();

  const printArea = document.querySelector("#recognitionPrintArea");
  if (!printArea) {
    throw new Error("No se encontró el área de impresión del reconocimiento.");
  }

  const safeFolio = String(recognition?.folio || "reconocimiento").trim() || "reconocimiento";

  const options = {
    margin: [0, 0, 0, 0],
    filename: `${safeFolio}.pdf`,
    image: { type: "jpeg", quality: 1 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      letterRendering: true,
    },
    jsPDF: {
      unit: "mm",
      format: "letter",
      orientation: "landscape",
    },
    pagebreak: {
      mode: ["avoid-all", "css", "legacy"],
    },
  };

  await window.html2pdf().set(options).from(printArea).save();
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (window.html2pdf) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`No se pudo cargar ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureHtml2Pdf() {
  if (window.html2pdf) {
    return;
  }

  const candidates = [
    "/assets/vendor/html2pdf.bundle.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js",
  ];

  for (const src of candidates) {
    try {
      await loadScriptOnce(src);
      if (window.html2pdf) {
        return;
      }
    } catch {
      // Try next source.
    }
  }

  throw new Error("html2pdf no está disponible para generar el PDF.");
}

async function initRecognitionDocument() {
  const query = parseQuery();

  if (!query.id && !query.folio) {
    setStatus("Falta el identificador del reconocimiento.", true);
    return;
  }

  try {
    setStatus("Cargando plantilla estandarizada...");
    const templateHtml = await loadRecognitionTemplateFromIndex();
    refs.host.innerHTML = templateHtml;

    setStatus("Cargando datos del reconocimiento...");
    const recognition = await fetchRecognitionDetail(query);
    renderRecognition(recognition);

    if (query.mode === "print") {
      setStatus("Enviando a impresión...");
      window.setTimeout(() => {
        window.print();
      }, 280);
      return;
    }

    if (query.mode === "download") {
      setStatus("Generando PDF...");
      await downloadAsPdf(recognition);
      setStatus("PDF generado correctamente.");
      return;
    }

    setStatus("Vista previa lista.");
  } catch (error) {
    setStatus(error.message || "No fue posible preparar el reconocimiento.", true);
  }
}

void initRecognitionDocument();
