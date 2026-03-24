const MIN_POLICY_SECONDS = 12;
const PASSING_SCORE = 4;
const TECMA_LOGO_PATH = "/assets/tecma-logo.png";
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
  userId: "",
  employeeName: "Empleado TECMA",
  employeeCode: "",
  employeeArea: "",
  employeeStatus: "PENDIENTE",
  employeePhotoDataUrl: "",

  rosterLoading: false,
  rosterLoaded: false,
  roster: [],
  rosterMap: new Map(),
  entryBusy: false,
  alreadyCompleted: false,

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
  certificateDownloadUrl: "",
  certificateVerifyUrl: "",
  certificateIssuedAt: "",

  tecmaLogoImage: null,
  tecmaLogoReady: false,
};

const refs = {
  entryScreen: document.querySelector("#entryScreen"),
  programScreen: document.querySelector("#programScreen"),
  employeeSelect: document.querySelector("#employeeSelect"),
  reloadRosterBtn: document.querySelector("#reloadRosterBtn"),
  rosterStatus: document.querySelector("#rosterStatus"),
  selectedUserMeta: document.querySelector("#selectedUserMeta"),
  entryMessage: document.querySelector("#entryMessage"),
  employeePhotoInput: document.querySelector("#employeePhotoInput"),
  entryPhotoPreview: document.querySelector("#entryPhotoPreview"),
  photoStatus: document.querySelector("#photoStatus"),
  entryQr: document.querySelector("#entryQr"),
  scanBtn: document.querySelector("#scanBtn"),

  steps: Array.from(document.querySelectorAll(".step")),
  employeeGreeting: document.querySelector("#employeeGreeting"),
  employeeAvatar: document.querySelector("#employeeAvatar"),
  welcomeStatus: document.querySelector("#welcomeStatus"),
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
  void loadRoster();
}

function bindEvents() {
  refs.employeeSelect.addEventListener("change", handleEmployeeSelection);
  refs.reloadRosterBtn.addEventListener("click", () => {
    void loadRoster(true);
  });
  refs.employeePhotoInput.addEventListener("change", handleEmployeePhotoChange);

  refs.scanBtn.addEventListener("click", () => {
    void handleSessionStart();
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
    void handlePolicyAcceptance();
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
    void showResult();
  });

  refs.retryQuizBtn.addEventListener("click", () => {
    startQuiz();
    setActiveStep("quizStep");
  });

  refs.generateCertBtn.addEventListener("click", () => {
    void handleGenerateCertificate();
  });

  refs.printCertBtn.addEventListener("click", handleDownloadCertificate);

  refs.newSessionBtn.addEventListener("click", () => {
    window.location.href = window.location.pathname;
  });
}

async function loadRoster(force = false) {
  if (state.rosterLoading) {
    return;
  }

  state.rosterLoading = true;
  refs.employeeSelect.disabled = true;
  refs.reloadRosterBtn.disabled = true;
  refs.rosterStatus.textContent = "Consultando lista de usuarios...";

  if (force) {
    refs.reloadRosterBtn.textContent = "Actualizando...";
  }

  try {
    const payload = await apiRequest("/api/roster");
    const users = Array.isArray(payload.users) ? payload.users : [];

    state.roster = users;
    state.rosterMap = new Map(users.map((row) => [row.id, row]));
    state.rosterLoaded = true;

    renderRosterSelect(users);

    if (users.length === 0) {
      refs.rosterStatus.textContent =
        "No hay usuarios cargados. Solicita al administrador registrar el padrón en /admin.";
    } else {
      refs.rosterStatus.textContent = `Padrón listo: ${users.length} usuarios disponibles.`;
    }
  } catch (error) {
    state.rosterLoaded = false;
    refs.employeeSelect.innerHTML = '<option value="">No se pudo cargar el padrón</option>';
    refs.rosterStatus.textContent = `Error al cargar padrón: ${error.message}`;
    setEntryMessage("No fue posible cargar el padrón de usuarios.", "error");
  } finally {
    state.rosterLoading = false;
    refs.employeeSelect.disabled = false;
    refs.reloadRosterBtn.disabled = false;
    refs.reloadRosterBtn.textContent = "Actualizar padrón";
    updateStartButtonState();
  }
}

function renderRosterSelect(users) {
  const previousValue = refs.employeeSelect.value;

  const options = [
    '<option value="">Selecciona tu nombre</option>',
    ...users.map((user) => {
      const statusLabel = user.estado ? ` (${user.estado})` : "";
      return `<option value="${escapeHtml(user.id)}">${escapeHtml(user.nombre)}${escapeHtml(statusLabel)}</option>`;
    }),
  ];

  refs.employeeSelect.innerHTML = options.join("");

  if (previousValue && state.rosterMap.has(previousValue)) {
    refs.employeeSelect.value = previousValue;
    handleEmployeeSelection();
  } else {
    refs.employeeSelect.value = "";
    clearSelectedUserState();
  }
}

function handleEmployeeSelection() {
  const selectedId = refs.employeeSelect.value;

  if (!selectedId || !state.rosterMap.has(selectedId)) {
    clearSelectedUserState();
    updateStartButtonState();
    return;
  }

  const selectedUser = state.rosterMap.get(selectedId);
  state.userId = selectedUser.id;
  state.employeeName = selectedUser.nombre || "Empleado TECMA";
  state.employeeCode = selectedUser.codigo_interno || "";
  state.employeeArea = selectedUser.area || "";
  state.employeeStatus = selectedUser.estado || "PENDIENTE";

  const parts = [
    state.employeeCode ? `Código: ${state.employeeCode}` : null,
    state.employeeArea ? `Área: ${state.employeeArea}` : null,
    `Estado actual: ${state.employeeStatus}`,
  ].filter(Boolean);

  refs.selectedUserMeta.textContent = parts.join(" | ");
  refs.selectedUserMeta.classList.remove("hidden");
  setEntryMessage("");
  updateStartButtonState();
}

function clearSelectedUserState() {
  state.userId = "";
  state.employeeName = "Empleado TECMA";
  state.employeeCode = "";
  state.employeeArea = "";
  state.employeeStatus = "PENDIENTE";

  refs.selectedUserMeta.textContent = "";
  refs.selectedUserMeta.classList.add("hidden");
}

function setEntryMessage(text, tone = "") {
  refs.entryMessage.textContent = text || "";
  refs.entryMessage.classList.remove("error", "success");

  if (tone === "error") {
    refs.entryMessage.classList.add("error");
  }

  if (tone === "success") {
    refs.entryMessage.classList.add("success");
  }
}

async function handleSessionStart() {
  if (state.entryBusy) {
    return;
  }

  if (!state.userId) {
    setEntryMessage("Selecciona tu nombre en el padrón para continuar.", "error");
    return;
  }

  if (!state.employeePhotoDataUrl) {
    refs.photoStatus.textContent = "Captura la fotografía antes de continuar.";
    refs.photoStatus.classList.remove("ok");
    setEntryMessage("La fotografía es obligatoria para emitir certificado.", "error");
    return;
  }

  state.entryBusy = true;
  refs.scanBtn.disabled = true;
  refs.scanBtn.textContent = "Validando acceso...";
  setEntryMessage("Registrando inicio de sesión de cumplimiento...");

  try {
    const payload = await apiRequest("/api/session/start", {
      method: "POST",
      body: {
        user_id: state.userId,
      },
    });

    state.userId = payload.user?.id || state.userId;
    state.employeeName = payload.user?.nombre || state.employeeName;
    state.employeeCode = payload.user?.codigo_interno || "";
    state.employeeArea = payload.user?.area || "";
    state.employeeStatus = payload.estado || "EN_PROCESO";
    state.alreadyCompleted = Boolean(payload.already_completed);

    setEntryMessage("Sesión iniciada correctamente.", "success");
    beginProgram();
  } catch (error) {
    setEntryMessage(`No fue posible iniciar: ${error.message}`, "error");
  } finally {
    state.entryBusy = false;
    refs.scanBtn.textContent = "Iniciar proceso oficial";
    updateStartButtonState();
  }
}

function beginProgram() {
  refs.entryScreen.classList.remove("active");
  refs.programScreen.classList.add("active");
  refs.employeeGreeting.textContent = state.employeeName;
  syncEmployeePhotoInUI();

  if (state.alreadyCompleted) {
    refs.welcomeStatus.textContent =
      "Este colaborador ya cuenta con un certificado emitido. Puede repetir el módulo o avanzar para recuperar evidencia.";
    refs.welcomeStatus.classList.remove("hidden");
  } else {
    refs.welcomeStatus.textContent = "";
    refs.welcomeStatus.classList.add("hidden");
  }

  setActiveStep("welcomeStep");
}

function setActiveStep(stepId) {
  refs.steps.forEach((step) => {
    step.classList.toggle("active", step.id === stepId);
  });
}

function seedEntryQr() {
  const qrUrl = new URL(window.location.origin + window.location.pathname);
  qrUrl.searchParams.set("via", "qr");
  const payload = qrUrl.toString();
  refs.entryQr.dataset.payload = payload;
  drawBrandQr(refs.entryQr, payload);
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

async function handlePolicyAcceptance() {
  if (!state.userId) {
    refs.readStatus.textContent = "No hay usuario activo. Regresa al inicio.";
    return;
  }

  const previousText = refs.acceptBtn.textContent;
  refs.acceptBtn.disabled = true;
  refs.acceptBtn.textContent = "Registrando aceptación...";

  try {
    const payload = await apiRequest("/api/policy/accept", {
      method: "POST",
      body: {
        user_id: state.userId,
      },
    });

    state.acceptedAt = payload.accepted_at ? new Date(payload.accepted_at) : new Date();
    startQuiz();
    setActiveStep("quizStep");
  } catch (error) {
    refs.readStatus.textContent = `No se pudo registrar aceptación: ${error.message}`;
    refs.acceptBtn.disabled = false;
  } finally {
    refs.acceptBtn.textContent = previousText;
  }
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

async function showResult() {
  setActiveStep("resultStep");

  refs.resultSummary.textContent =
    `Obtuviste ${state.score} de ${quizQuestions.length} respuestas correctas. Registrando resultado...`;
  refs.resultStatus.classList.remove("pass", "fail");
  refs.resultStatus.textContent = "Procesando...";
  refs.generateCertBtn.classList.add("hidden");

  try {
    const payload = await apiRequest("/api/quiz/submit", {
      method: "POST",
      body: {
        user_id: state.userId,
        score: state.score,
        answers: state.answers,
      },
    });

    state.passed = Boolean(payload.passed);
    state.employeeStatus = payload.estado || state.employeeStatus;

    if (state.passed) {
      refs.resultStatus.classList.add("pass");
      refs.resultStatus.textContent = "Aprobado: cumples el criterio mínimo (4/5).";
      refs.generateCertBtn.classList.remove("hidden");
      return;
    }

    refs.resultStatus.classList.add("fail");
    refs.resultStatus.textContent =
      "No aprobado: revisa el contenido y realiza un nuevo intento.";
  } catch (error) {
    refs.resultStatus.classList.add("fail");
    refs.resultStatus.textContent = `No fue posible registrar el resultado: ${error.message}`;
  }
}

async function handleGenerateCertificate() {
  if (!state.userId) {
    refs.resultStatus.classList.remove("pass");
    refs.resultStatus.classList.add("fail");
    refs.resultStatus.textContent = "No hay usuario activo para generar certificado.";
    return;
  }

  const previousText = refs.generateCertBtn.textContent;
  refs.generateCertBtn.disabled = true;
  refs.generateCertBtn.textContent = "Generando certificado...";

  try {
    const payload = await apiRequest("/api/certificates/generate", {
      method: "POST",
      body: {
        user_id: state.userId,
        employee_photo_data_url: state.employeePhotoDataUrl,
      },
    });

    if (!payload.certificate) {
      throw new Error("Respuesta inválida al generar certificado");
    }

    renderCertificate(payload.certificate);
    setActiveStep("certificateStep");
  } catch (error) {
    refs.resultStatus.classList.remove("pass");
    refs.resultStatus.classList.add("fail");
    refs.resultStatus.textContent = `No fue posible generar el certificado: ${error.message}`;
  } finally {
    refs.generateCertBtn.disabled = false;
    refs.generateCertBtn.textContent = previousText;
  }
}

function renderCertificate(certificate) {
  const issuedAt = certificate.issued_at ? new Date(certificate.issued_at) : new Date();
  const longDate = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(issuedAt);

  state.folio = String(certificate.folio || "").trim() || createFallbackFolio(issuedAt);
  state.certificateDownloadUrl = String(certificate.download_url || "").trim();
  state.certificateVerifyUrl = String(certificate.verify_url || "").trim();
  state.certificateIssuedAt = issuedAt.toISOString();

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

  const verificationValue = state.certificateVerifyUrl || `Folio: ${state.folio}`;
  refs.certQr.dataset.payload = verificationValue;
  drawBrandQr(refs.certQr, verificationValue);

  if (state.certificateVerifyUrl) {
    refs.verifyUrl.innerHTML = `<a href="${escapeHtml(state.certificateVerifyUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
      state.certificateVerifyUrl
    )}</a>`;
  } else {
    refs.verifyUrl.textContent = `Código de verificación: ${state.folio}`;
  }

  cacheCertificateRecord();
}

function cacheCertificateRecord() {
  if (!state.folio) {
    return;
  }

  try {
    const key = `tecma-cert:${state.folio}`;
    const payload = {
      folio: state.folio,
      employeeName: state.employeeName,
      issuedAt: state.certificateIssuedAt,
      score: state.score,
      policyAcceptedAt: state.acceptedAt ? state.acceptedAt.toISOString() : null,
      userId: state.userId,
      hasPhoto: Boolean(state.employeePhotoDataUrl),
    };

    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignora entornos bloqueados sin storage para no romper el flujo.
  }
}

function handleDownloadCertificate() {
  if (state.certificateDownloadUrl) {
    window.open(state.certificateDownloadUrl, "_blank", "noopener,noreferrer");
    return;
  }

  window.print();
}

function createFallbackFolio(dateObj) {
  const year = dateObj.getFullYear();
  const serial = Math.floor(100000 + Math.random() * 900000);
  return `TECMA-CERT-${year}-${serial}`;
}

function updateStartButtonState() {
  const ready = Boolean(state.userId) && Boolean(state.employeePhotoDataUrl) && !state.entryBusy;
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
    setEntryMessage("");
    updateStartButtonState();
  } catch {
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
  const decorate = canvas.id === "certQr";

  if (
    typeof window !== "undefined" &&
    window.QRCode &&
    typeof window.QRCode.toCanvas === "function"
  ) {
    window.QRCode.toCanvas(
      canvas,
      payload,
      {
        width: canvas.width,
        margin: decorate ? 2 : 4,
        errorCorrectionLevel: decorate ? "H" : "M",
        color: {
          dark: "#1a2b4c",
          light: "#ffffff",
        },
      },
      (error) => {
        if (error) {
          drawBrandQrFallback(canvas, payload, decorate);
          return;
        }

        if (decorate) {
          decorateQrCanvas(canvas);
        }
      }
    );
    return;
  }

  drawBrandQrFallback(canvas, payload, decorate);
}

function drawBrandQrFallback(canvas, payload, decorate = false) {
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

  if (decorate) {
    decorateQrCanvas(canvas);
  }
}

function decorateQrCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const logoRadius = canvas.width * 0.08;

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
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
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

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = isJson && payload && payload.error ? payload.error : "Request failed";
    throw new Error(message);
  }

  return isJson ? payload : {};
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

init();
