const MIN_POLICY_SECONDS = 12;
const PASSING_SCORE = 4;
const TECMA_LOGO_PATH = "assets/tecma-logo.png";
const PHOTO_MAX_EDGE = 960;

const quizQuestions = [
  {
    id: "q1",
    prompt: "¿Cuál de las siguientes situaciones describe trabajo forzado?",
    options: [
      "Horario flexible acordado voluntariamente.",
      "Retención de pasaporte para obligar permanencia.",
      "Capacitación obligatoria pagada.",
      "Rotación de turnos con consentimiento.",
    ],
    answer: 1,
    correctHint: "La retención de documentos personales es una señal de coerción.",
    wrongHint: "Revisa el principio de trabajo libre y voluntario.",
  },
  {
    id: "q2",
    prompt: "Si un supervisor detecta indicios de coerción laboral, ¿qué debe hacer primero?",
    options: [
      "Ignorar hasta tener pruebas absolutas.",
      "Reportar de inmediato al canal de cumplimiento.",
      "Publicarlo en chat grupal.",
      "Resolverlo sin registrar evidencia.",
    ],
    answer: 1,
    correctHint: "El reporte inmediato activa protocolos de protección y trazabilidad.",
    wrongHint: "El protocolo exige reporte formal inmediato y documentado.",
  },
  {
    id: "q3",
    prompt: "Según la política, la retención de documentos personales del empleado:",
    options: [
      "Está permitida con autorización verbal.",
      "Está prohibida bajo cualquier circunstancia coercitiva.",
      "Es válida durante auditorías internas.",
      "Depende del área administrativa.",
    ],
    answer: 1,
    correctHint: "La retención indebida de documentos está expresamente prohibida.",
    wrongHint: "La política establece prohibición absoluta de retención coercitiva.",
  },
  {
    id: "q4",
    prompt: "¿Qué garantiza el canal de denuncia TECMA?",
    options: [
      "Publicidad del denunciante para transparencia.",
      "Confidencialidad y protección contra represalias.",
      "Respuesta solo anual.",
      "Aplicación exclusiva a personal directivo.",
    ],
    answer: 1,
    correctHint: "La confidencialidad y la no represalia son garantías centrales.",
    wrongHint: "Sin confidencialidad y protección no existe canal efectivo de denuncia.",
  },
  {
    id: "q5",
    prompt: "¿Cuál es el criterio de aprobación del módulo?",
    options: [
      "3 de 5 respuestas correctas.",
      "4 de 5 respuestas correctas.",
      "5 de 5 obligatorio.",
      "Solo completar sin importar respuestas.",
    ],
    answer: 1,
    correctHint: "El mínimo de aprobación está definido en 4 aciertos de 5.",
    wrongHint: "El umbral de aprobación oficial en esta versión es 4/5.",
  },
];

const state = {
  sessionToken: "",
  employeeName: "Empleado TECMA",
  employeePhotoDataUrl: "",
  policyTimerDone: false,
  policyScrolledToEnd: false,
  policySecondsLeft: MIN_POLICY_SECONDS,
  policyTimerId: null,
  currentQuestion: 0,
  score: 0,
  answers: [],
  passed: false,
  acceptedAt: null,
  folio: "",
  tecmaLogoImage: null,
  tecmaLogoReady: false,
};

const refs = {
  entryScreen: document.querySelector("#entryScreen"),
  programScreen: document.querySelector("#programScreen"),
  employeeNameInput: document.querySelector("#employeeName"),
  employeePhotoInput: document.querySelector("#employeePhotoInput"),
  entryPhotoPreview: document.querySelector("#entryPhotoPreview"),
  photoStatus: document.querySelector("#photoStatus"),
  entryQr: document.querySelector("#entryQr"),
  scanBtn: document.querySelector("#scanBtn"),

  steps: Array.from(document.querySelectorAll(".step")),
  employeeGreeting: document.querySelector("#employeeGreeting"),
  employeeAvatar: document.querySelector("#employeeAvatar"),
  goPolicyBtn: document.querySelector("#goPolicyBtn"),

  policyScroll: document.querySelector("#policyScroll"),
  readStatus: document.querySelector("#readStatus"),
  commitCheck: document.querySelector("#commitCheck"),
  acceptBtn: document.querySelector("#acceptBtn"),

  quizCounter: document.querySelector("#quizCounter"),
  quizQuestion: document.querySelector("#quizQuestion"),
  quizOptions: document.querySelector("#quizOptions"),
  quizFeedback: document.querySelector("#quizFeedback"),
  quizProgressSegments: Array.from(document.querySelectorAll("#quizProgress .segment")),
  submitAnswerBtn: document.querySelector("#submitAnswerBtn"),
  nextQuestionBtn: document.querySelector("#nextQuestionBtn"),

  resultSummary: document.querySelector("#resultSummary"),
  resultStatus: document.querySelector("#resultStatus"),
  retryQuizBtn: document.querySelector("#retryQuizBtn"),
  generateCertBtn: document.querySelector("#generateCertBtn"),

  certName: document.querySelector("#certName"),
  certPhoto: document.querySelector("#certPhoto"),
  certPhotoFallback: document.querySelector("#certPhotoFallback"),
  certDate: document.querySelector("#certDate"),
  certFolio: document.querySelector("#certFolio"),
  certQr: document.querySelector("#certQr"),
  verifyUrl: document.querySelector("#verifyUrl"),
  printCertBtn: document.querySelector("#printCertBtn"),
  newSessionBtn: document.querySelector("#newSessionBtn"),

  year: document.querySelector("#year"),
};

function init() {
  refs.year.textContent = String(new Date().getFullYear());
  bindEvents();
  preloadBrandAssets();
  seedEntryQr();
  updateStartButtonState();

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const name = params.get("name");

  if (token) {
    state.sessionToken = token;
    state.employeeName = sanitizeName(name) || "Empleado TECMA";
    beginProgram();
  }
}

function bindEvents() {
  refs.employeeNameInput.addEventListener("input", updateStartButtonState);
  refs.employeePhotoInput.addEventListener("change", handleEmployeePhotoChange);

  refs.scanBtn.addEventListener("click", () => {
    state.employeeName = sanitizeName(refs.employeeNameInput.value) || "Empleado TECMA";

    if (!state.employeePhotoDataUrl) {
      refs.photoStatus.textContent = "Captura la fotografía antes de continuar.";
      refs.photoStatus.classList.remove("ok");
      updateStartButtonState();
      return;
    }

    state.sessionToken = createSessionToken();
    updateUrlWithSession();
    beginProgram();
  });

  refs.goPolicyBtn.addEventListener("click", () => {
    setActiveStep("policyStep");
    startPolicyTimer();
    refs.policyScroll.focus({ preventScroll: true });
  });

  refs.policyScroll.addEventListener("scroll", handlePolicyScroll);

  refs.commitCheck.addEventListener("change", () => {
    refs.acceptBtn.disabled = !isPolicyReady() || !refs.commitCheck.checked;
  });

  refs.acceptBtn.addEventListener("click", () => {
    state.acceptedAt = new Date();
    startQuiz();
    setActiveStep("quizStep");
  });

  refs.quizOptions.addEventListener("change", () => {
    refs.submitAnswerBtn.disabled = !getSelectedOptionValue();
  });

  refs.submitAnswerBtn.addEventListener("click", submitCurrentAnswer);

  refs.nextQuestionBtn.addEventListener("click", () => {
    if (state.currentQuestion < quizQuestions.length - 1) {
      state.currentQuestion += 1;
      renderQuestion();
      return;
    }
    showResult();
  });

  refs.retryQuizBtn.addEventListener("click", () => {
    startQuiz();
    setActiveStep("quizStep");
  });

  refs.generateCertBtn.addEventListener("click", () => {
    renderCertificate();
    setActiveStep("certificateStep");
  });

  refs.printCertBtn.addEventListener("click", () => window.print());

  refs.newSessionBtn.addEventListener("click", () => {
    const clearUrl = `${window.location.pathname}`;
    window.history.replaceState({}, "", clearUrl);
    window.location.reload();
  });
}

function beginProgram() {
  refs.entryScreen.classList.remove("active");
  refs.programScreen.classList.add("active");
  refs.employeeGreeting.textContent = state.employeeName;
  syncEmployeePhotoInUI();
  setActiveStep("welcomeStep");
}

function setActiveStep(stepId) {
  refs.steps.forEach((step) => {
    step.classList.toggle("active", step.id === stepId);
  });
}

function seedEntryQr() {
  const seedText = `${window.location.origin}${window.location.pathname}::TECMA`;
  refs.entryQr.dataset.payload = seedText;
  drawBrandQr(refs.entryQr, seedText);
}

function startPolicyTimer() {
  if (state.policyTimerId) {
    return;
  }

  state.policyTimerDone = false;
  state.policyScrolledToEnd = false;
  state.policySecondsLeft = MIN_POLICY_SECONDS;
  refs.commitCheck.checked = false;
  refs.commitCheck.disabled = true;
  refs.acceptBtn.disabled = true;
  refs.policyScroll.scrollTop = 0;
  updateReadStatus();

  state.policyTimerId = window.setInterval(() => {
    if (state.policySecondsLeft > 0) {
      state.policySecondsLeft -= 1;
    }

    if (state.policySecondsLeft === 0) {
      state.policyTimerDone = true;
      window.clearInterval(state.policyTimerId);
      state.policyTimerId = null;
    }

    updateReadStatus();
  }, 1000);
}

function handlePolicyScroll() {
  const el = refs.policyScroll;
  const reachedBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;

  if (reachedBottom) {
    state.policyScrolledToEnd = true;
    updateReadStatus();
  }
}

function isPolicyReady() {
  return state.policyTimerDone && state.policyScrolledToEnd;
}

function updateReadStatus() {
  const scrollText = state.policyScrolledToEnd
    ? "Lectura completa registrada."
    : "Desplázate hasta el final del documento.";

  const timerText = state.policyTimerDone
    ? "Tiempo mínimo cumplido."
    : `Tiempo restante: ${state.policySecondsLeft}s.`;

  refs.readStatus.textContent = `${scrollText} ${timerText}`;

  const ready = isPolicyReady();
  refs.commitCheck.disabled = !ready;
  refs.acceptBtn.disabled = !ready || !refs.commitCheck.checked;
}

function startQuiz() {
  state.currentQuestion = 0;
  state.score = 0;
  state.answers = [];
  state.passed = false;
  renderQuestion();
}

function renderQuestion() {
  const question = quizQuestions[state.currentQuestion];
  refs.quizCounter.textContent = `Pregunta ${state.currentQuestion + 1} de ${quizQuestions.length}`;
  refs.quizQuestion.textContent = question.prompt;

  refs.quizOptions.innerHTML = question.options
    .map((option, idx) => {
      return `
        <label class="option-item" for="opt-${question.id}-${idx}">
          <input id="opt-${question.id}-${idx}" type="radio" name="choice" value="${idx}" />
          <span>${option}</span>
        </label>
      `;
    })
    .join("");

  refs.quizFeedback.className = "feedback";
  refs.quizFeedback.textContent = "";

  refs.submitAnswerBtn.classList.remove("hidden");
  refs.submitAnswerBtn.disabled = true;
  refs.nextQuestionBtn.classList.add("hidden");

  paintProgress();
}

function paintProgress() {
  const answeredCount = state.answers.length;

  refs.quizProgressSegments.forEach((segment, idx) => {
    segment.classList.remove("done", "active");

    if (idx < answeredCount) {
      segment.classList.add("done");
      return;
    }

    if (idx === answeredCount) {
      segment.classList.add("active");
    }
  });
}

function getSelectedOptionValue() {
  const selected = refs.quizOptions.querySelector("input[name='choice']:checked");
  return selected ? selected.value : "";
}

function submitCurrentAnswer() {
  const selectedValue = getSelectedOptionValue();

  if (selectedValue === "") {
    return;
  }

  const selected = Number(selectedValue);
  const question = quizQuestions[state.currentQuestion];
  const isCorrect = selected === question.answer;

  state.answers.push({
    questionId: question.id,
    selected,
    isCorrect,
  });

  if (isCorrect) {
    state.score += 1;
  }

  refs.quizFeedback.className = `feedback visible ${isCorrect ? "correct" : "incorrect"}`;
  refs.quizFeedback.textContent = isCorrect
    ? `Correcto (hoja de maple): ${question.correctHint}`
    : `Incorrecto (águila): ${question.wrongHint}`;

  refs.submitAnswerBtn.classList.add("hidden");
  refs.nextQuestionBtn.classList.remove("hidden");
  refs.nextQuestionBtn.textContent =
    state.currentQuestion === quizQuestions.length - 1 ? "Ver resultado" : "Siguiente pregunta";

  paintProgress();
}

function showResult() {
  state.passed = state.score >= PASSING_SCORE;
  setActiveStep("resultStep");

  refs.resultSummary.textContent = `Obtuviste ${state.score} de ${quizQuestions.length} respuestas correctas.`;

  refs.resultStatus.classList.remove("pass", "fail");

  if (state.passed) {
    refs.resultStatus.classList.add("pass");
    refs.resultStatus.textContent = "Aprobado: cumples el criterio mínimo (4/5).";
    refs.generateCertBtn.classList.remove("hidden");
  } else {
    refs.resultStatus.classList.add("fail");
    refs.resultStatus.textContent = "No aprobado: revisa el contenido y realiza un nuevo intento.";
    refs.generateCertBtn.classList.add("hidden");
  }
}

function renderCertificate() {
  const now = new Date();
  const longDate = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(now);

  if (!state.folio) {
    state.folio = createFolio(now);
  }

  refs.certName.textContent = state.employeeName;
  if (state.employeePhotoDataUrl) {
    refs.certPhoto.src = state.employeePhotoDataUrl;
    refs.certPhoto.classList.remove("hidden");
    refs.certPhotoFallback.classList.add("hidden");
  } else {
    refs.certPhoto.src = "";
    refs.certPhoto.classList.add("hidden");
    refs.certPhotoFallback.classList.remove("hidden");
  }
  refs.certDate.textContent = longDate;
  refs.certFolio.textContent = state.folio;

  const verificationCode = `VALIDACION TECMA | ${state.folio} | ${state.employeeName} | ${now.toISOString()}`;
  refs.verifyUrl.textContent = `Código de verificación: ${state.folio}`;
  refs.certQr.dataset.payload = verificationCode;
  drawBrandQr(refs.certQr, verificationCode);

  cacheCertificateRecord(now.toISOString());
}

function cacheCertificateRecord(issuedAtIso) {
  try {
    const key = `tecma-cert:${state.folio}`;
    const payload = {
      folio: state.folio,
      employeeName: state.employeeName,
      issuedAt: issuedAtIso,
      score: state.score,
      policyAcceptedAt: state.acceptedAt ? state.acceptedAt.toISOString() : null,
      sessionToken: state.sessionToken,
      hasPhoto: Boolean(state.employeePhotoDataUrl),
    };

    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    // Ignora entornos bloqueados sin storage para no romper el flujo.
  }
}

function createSessionToken() {
  const random = Math.random().toString(36).slice(2, 9).toUpperCase();
  return `TECMA-${Date.now().toString(36).toUpperCase()}-${random}`;
}

function createFolio(dateObj) {
  const year = dateObj.getFullYear();
  const serial = Math.floor(1000 + Math.random() * 9000);
  return `TECMA-CERT-${year}-${serial}`;
}

function updateUrlWithSession() {
  const url = new URL(window.location.href);
  url.searchParams.set("token", state.sessionToken);
  url.searchParams.set("name", state.employeeName);
  window.history.replaceState({}, "", url.toString());
}

function sanitizeName(value) {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 90);
}

function updateStartButtonState() {
  const cleanName = sanitizeName(refs.employeeNameInput.value);
  const ready = Boolean(cleanName) && Boolean(state.employeePhotoDataUrl);
  refs.scanBtn.disabled = !ready;
}

async function handleEmployeePhotoChange(event) {
  const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;

  if (!file) {
    state.employeePhotoDataUrl = "";
    refs.entryPhotoPreview.src = "";
    refs.entryPhotoPreview.classList.add("hidden");
    refs.photoStatus.textContent = "Foto pendiente de captura.";
    refs.photoStatus.classList.remove("ok");
    updateStartButtonState();
    return;
  }

  if (!file.type.startsWith("image/")) {
    refs.photoStatus.textContent = "El archivo debe ser una imagen válida.";
    refs.photoStatus.classList.remove("ok");
    updateStartButtonState();
    return;
  }

  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    const optimizedDataUrl = await optimizeImage(rawDataUrl, PHOTO_MAX_EDGE);

    state.employeePhotoDataUrl = optimizedDataUrl;
    refs.entryPhotoPreview.src = optimizedDataUrl;
    refs.entryPhotoPreview.classList.remove("hidden");
    refs.photoStatus.textContent = "Foto capturada correctamente.";
    refs.photoStatus.classList.add("ok");
    updateStartButtonState();
  } catch (error) {
    state.employeePhotoDataUrl = "";
    refs.entryPhotoPreview.src = "";
    refs.entryPhotoPreview.classList.add("hidden");
    refs.photoStatus.textContent = "No fue posible procesar la fotografía.";
    refs.photoStatus.classList.remove("ok");
    updateStartButtonState();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function optimizeImage(dataUrl, maxEdge = PHOTO_MAX_EDGE) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      const scale = Math.min(1, maxEdge / Math.max(width, height));

      if (scale >= 0.999) {
        resolve(dataUrl);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };

    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function syncEmployeePhotoInUI() {
  if (!state.employeePhotoDataUrl) {
    refs.employeeAvatar.classList.add("hidden");
    return;
  }

  refs.employeeAvatar.src = state.employeePhotoDataUrl;
  refs.employeeAvatar.classList.remove("hidden");
}

function preloadBrandAssets() {
  const logo = new Image();
  logo.onload = () => {
    state.tecmaLogoImage = logo;
    state.tecmaLogoReady = true;
    redrawQrCanvases();
  };
  logo.src = TECMA_LOGO_PATH;
}

function redrawQrCanvases() {
  [refs.entryQr, refs.certQr].forEach((canvas) => {
    if (!canvas || !canvas.dataset.payload) {
      return;
    }
    drawBrandQr(canvas, canvas.dataset.payload);
  });
}

function drawBrandQr(canvas, payload) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const size = 29;
  const margin = 10;
  const moduleSize = (canvas.width - margin * 2) / size;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let seed = hashCode(payload) || 1;
  const nextBit = () => {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967295;
  };

  const isFinderArea = (x, y) => {
    const inTopLeft = x < 7 && y < 7;
    const inTopRight = x > size - 8 && y < 7;
    const inBottomLeft = x < 7 && y > size - 8;
    return inTopLeft || inTopRight || inBottomLeft;
  };

  ctx.fillStyle = "#1a2b4c";

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isFinderArea(x, y)) {
        continue;
      }

      const draw = nextBit() > 0.5;
      if (!draw) {
        continue;
      }

      ctx.fillRect(
        margin + x * moduleSize,
        margin + y * moduleSize,
        Math.ceil(moduleSize),
        Math.ceil(moduleSize)
      );
    }
  }

  drawFinderPattern(ctx, margin, moduleSize, 0, 0);
  drawFinderPattern(ctx, margin, moduleSize, size - 7, 0);
  drawFinderPattern(ctx, margin, moduleSize, 0, size - 7);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const logoRadius = canvas.width * 0.16;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX, centerY, logoRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#f47a20";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (state.tecmaLogoReady && state.tecmaLogoImage) {
    const logoWidth = logoRadius * 2.45;
    const ratio = state.tecmaLogoImage.height / state.tecmaLogoImage.width;
    const logoHeight = logoWidth * ratio;
    ctx.drawImage(
      state.tecmaLogoImage,
      centerX - logoWidth / 2,
      centerY - logoHeight / 2,
      logoWidth,
      logoHeight
    );
  } else {
    ctx.fillStyle = "#1a2b4c";
    ctx.font = `700 ${Math.round(canvas.width * 0.078)}px Open Sans, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TECMA", centerX, centerY);
  }

  ctx.strokeStyle = "#1a2b4c";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);

  ctx.fillStyle = "#f47a20";
  ctx.fillRect(3, 3, canvas.width - 6, 6);

  ctx.fillStyle = "#2e9d5d";
  ctx.fillRect(3, canvas.height - 9, (canvas.width - 6) / 2, 6);

  ctx.fillStyle = "#1a2b4c";
  ctx.fillRect(3 + (canvas.width - 6) / 2, canvas.height - 9, (canvas.width - 6) / 2, 6);
}

function drawFinderPattern(ctx, margin, moduleSize, gridX, gridY) {
  const x = margin + gridX * moduleSize;
  const y = margin + gridY * moduleSize;
  const outer = moduleSize * 7;
  const middle = moduleSize * 5;
  const inner = moduleSize * 3;

  ctx.fillStyle = "#1a2b4c";
  ctx.fillRect(x, y, outer, outer);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + moduleSize, y + moduleSize, middle, middle);

  ctx.fillStyle = "#1a2b4c";
  ctx.fillRect(x + moduleSize * 2, y + moduleSize * 2, inner, inner);
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

init();
