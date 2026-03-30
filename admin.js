const state = {
  adminKey: "",
  isAuthenticated: false,
  sessionEmail: "",
  users: [],
  alerts: [],
  overview: null,
  loading: false,
};

const REQUEST_TIMEOUT_MS = 45000;
const QUIZ_TOTAL_QUESTIONS = 7;

const refs = {
  adminLoginSection: document.querySelector("#adminLoginSection"),
  adminSecureArea: document.querySelector("#adminSecureArea"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminEmail: document.querySelector("#adminEmail"),
  adminPassword: document.querySelector("#adminPassword"),
  adminLoginBtn: document.querySelector("#adminLoginBtn"),
  adminLoginMessage: document.querySelector("#adminLoginMessage"),
  logoutBtn: document.querySelector("#logoutBtn"),

  accessInfo: document.querySelector("#accessInfo"),
  accessError: document.querySelector("#accessError"),

  kpiTotal: document.querySelector("#kpiTotal"),
  kpiPendiente: document.querySelector("#kpiPendiente"),
  kpiProceso: document.querySelector("#kpiProceso"),
  kpiNoAprobado: document.querySelector("#kpiNoAprobado"),
  kpiCompletado: document.querySelector("#kpiCompletado"),
  alertsSummary: document.querySelector("#alertsSummary"),
  alertsList: document.querySelector("#alertsList"),

  addUserForm: document.querySelector("#addUserForm"),
  newUserName: document.querySelector("#newUserName"),
  newUserCode: document.querySelector("#newUserCode"),
  newUserArea: document.querySelector("#newUserArea"),
  addUserMessage: document.querySelector("#addUserMessage"),

  statusFilter: document.querySelector("#statusFilter"),
  refreshBtn: document.querySelector("#refreshBtn"),
  downloadZipBtn: document.querySelector("#downloadZipBtn"),
  usersTableBody: document.querySelector("#usersTableBody"),
};

async function init() {
  bindEvents();

  const params = new URLSearchParams(window.location.search);
  state.adminKey = String(params.get("key") || "").trim();

  if (state.adminKey) {
    state.isAuthenticated = true;
    showSecurePanel("Acceso validado por llave de administrador en URL.");
    await refreshAll();
    return;
  }

  await restoreSession();
}

function bindEvents() {
  refs.refreshBtn?.addEventListener("click", refreshAll);
  refs.statusFilter?.addEventListener("change", loadUsers);
  refs.downloadZipBtn?.addEventListener("click", downloadZip);

  refs.addUserForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createUser();
  });

  refs.adminLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loginAdmin();
  });

  refs.logoutBtn?.addEventListener("click", async () => {
    await logoutAdmin();
  });
}

async function restoreSession() {
  showLoginPanel("Verificando sesión...");

  try {
    const payload = await apiRequest("/api/admin/auth/session", {
      skipAuthReset: true,
    });

    if (payload?.authenticated) {
      state.sessionEmail = String(payload.email || "").trim();
      state.isAuthenticated = true;
      const emailText = state.sessionEmail ? ` (${state.sessionEmail})` : "";
      showSecurePanel(`Sesión activa${emailText}.`);
      await refreshAll();
      return;
    }
  } catch {
    // Continue to login state.
  }

  state.isAuthenticated = false;
  state.sessionEmail = "";
  showLoginPanel("Inicia sesión para acceder al panel administrativo.");
}

function showLoginPanel(message = "") {
  refs.adminLoginSection?.classList.remove("hidden");
  refs.adminSecureArea?.classList.add("hidden");
  disableActions();
  setLoginMessage(message, false);

  if (refs.accessError) {
    refs.accessError.classList.add("hidden");
    refs.accessError.textContent = "";
  }

  if (refs.accessInfo) {
    refs.accessInfo.textContent = "";
  }
}

function showSecurePanel(message = "") {
  refs.adminLoginSection?.classList.add("hidden");
  refs.adminSecureArea?.classList.remove("hidden");
  setLoginMessage("", false);
  enableActions();

  if (refs.accessInfo) {
    refs.accessInfo.textContent = message || "Sesión admin activa.";
  }

  if (refs.accessError) {
    refs.accessError.classList.add("hidden");
    refs.accessError.textContent = "";
  }
}

function enableActions() {
  refs.refreshBtn.disabled = false;
  refs.downloadZipBtn.disabled = false;
  const submitButton = refs.addUserForm?.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = false;
  }
}

function disableActions() {
  refs.refreshBtn.disabled = true;
  refs.downloadZipBtn.disabled = true;
  const submitButton = refs.addUserForm?.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
  }
}

function resetAuthState(message) {
  state.isAuthenticated = false;
  state.sessionEmail = "";
  state.loading = false;

  if (refs.accessError) {
    refs.accessError.textContent = message || "Sesión expirada. Inicia sesión nuevamente.";
    refs.accessError.classList.remove("hidden");
  }

  showLoginPanel("Tu sesión expiró. Ingresa de nuevo para continuar.");
}

function buildApiUrl(path) {
  if (!state.adminKey) {
    return path;
  }

  const prefix = path.includes("?") ? "&" : "?";
  return `${path}${prefix}key=${encodeURIComponent(state.adminKey)}`;
}

function setAdminMessage(message) {
  refs.addUserMessage.textContent = message || "";
}

function setLoginMessage(message, isError = false) {
  if (!refs.adminLoginMessage) {
    return;
  }

  refs.adminLoginMessage.textContent = message || "";
  refs.adminLoginMessage.classList.toggle("error", Boolean(isError && message));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado. Intenta nuevamente.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function openDownloadUrl(url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}

async function apiRequest(path, options = {}) {
  const response = await fetchWithTimeout(buildApiUrl(path), {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // no-op
    }

    if (response.status === 401 && !state.adminKey && !options.skipAuthReset) {
      resetAuthState(message);
    }

    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.blob();
}

async function loginAdmin() {
  const email = String(refs.adminEmail?.value || "").trim();
  const password = String(refs.adminPassword?.value || "");

  if (!email) {
    setLoginMessage("Captura el correo de administrador.", true);
    return;
  }

  if (!password) {
    setLoginMessage("Captura la contraseña.", true);
    return;
  }

  const originalText = refs.adminLoginBtn?.textContent || "Entrar al panel";
  if (refs.adminLoginBtn) {
    refs.adminLoginBtn.disabled = true;
    refs.adminLoginBtn.textContent = "Validando...";
  }

  try {
    setLoginMessage("Validando credenciales...");

    const payload = await apiRequest("/api/admin/auth/login", {
      method: "POST",
      body: {
        email,
        password,
      },
      skipAuthReset: true,
    });

    state.isAuthenticated = true;
    state.sessionEmail = String(payload?.email || email).trim().toLowerCase();
    const emailText = state.sessionEmail ? ` (${state.sessionEmail})` : "";
    showSecurePanel(`Sesión activa${emailText}.`);

    if (refs.adminLoginForm) {
      refs.adminLoginForm.reset();
    }

    await refreshAll();
  } catch (err) {
    setLoginMessage(`Acceso denegado: ${err.message}`, true);
  } finally {
    if (refs.adminLoginBtn) {
      refs.adminLoginBtn.disabled = false;
      refs.adminLoginBtn.textContent = originalText;
    }
  }
}

async function logoutAdmin() {
  try {
    if (!state.adminKey) {
      await apiRequest("/api/admin/auth/logout", {
        method: "POST",
        skipAuthReset: true,
      });
    }
  } catch {
    // no-op
  }

  state.adminKey = "";
  const cleanUrl = `${window.location.pathname}`;
  window.history.replaceState({}, document.title, cleanUrl);
  showLoginPanel("Sesión cerrada correctamente.");
}

async function refreshAll() {
  if (!state.isAuthenticated) {
    return;
  }

  try {
    setLoading(true);
    await Promise.all([loadOverview(), loadUsers()]);
  } catch (err) {
    setAdminMessage(`Error: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

function setLoading(flag) {
  state.loading = flag;
  refs.refreshBtn.disabled = flag;
  refs.downloadZipBtn.disabled = flag;
}

async function loadOverview() {
  const data = await apiRequest("/api/admin/overview");
  state.overview = data;
  state.alerts = Array.isArray(data.alerts) ? data.alerts : [];

  refs.kpiTotal.textContent = String(data.total || 0);
  refs.kpiPendiente.textContent = String(data.pendiente || 0);
  refs.kpiProceso.textContent = String(data.en_proceso || 0);
  refs.kpiNoAprobado.textContent = String(data.no_aprobado || 0);
  refs.kpiCompletado.textContent = String(data.completado || 0);
  renderAlerts();
}

async function loadUsers() {
  const filter = refs.statusFilter.value || "ALL";
  const data = await apiRequest(`/api/admin/users?status=${encodeURIComponent(filter)}`);
  state.users = data.rows || [];
  renderUsers();
}

function renderUsers() {
  if (state.users.length === 0) {
    refs.usersTableBody.innerHTML = `
      <tr>
        <td colspan="8">No hay usuarios para este filtro.</td>
      </tr>
    `;
    return;
  }

  refs.usersTableBody.innerHTML = state.users
    .map((row) => {
      const scoreText =
        row.last_quiz_score == null ? "-" : `${row.last_quiz_score}/${QUIZ_TOTAL_QUESTIONS}`;
      const folioText = row.recognition_folio || "-";
      const recognitionFolio = row.recognition_folio || "";
      const code = row.codigo_interno || "-";
      const area = row.area || "-";
      const userId = row.id || "";
      const recognitionId = normalizeRecognitionId(row.recognition_id);
      const recognitionBtnDisabled = recognitionId || recognitionFolio ? "" : "disabled";

      return `
        <tr>
          <td>${escapeHtml(row.nombre)}</td>
          <td>${escapeHtml(code)}</td>
          <td>${escapeHtml(area)}</td>
          <td><span class="status-pill status-${row.estado}">${escapeHtml(row.estado)}</span></td>
          <td>${escapeHtml(scoreText)}</td>
          <td>${escapeHtml(String(row.attempt_count || 0))}</td>
          <td>${escapeHtml(folioText)}</td>
          <td>
            <div class="actions">
              <button
                class="small-btn"
                data-action="download-one"
                data-recognition-id="${recognitionId}"
                data-recognition-folio="${escapeHtml(recognitionFolio)}"
                ${recognitionBtnDisabled}
              >
                Descargar
              </button>
              <button
                class="small-btn"
                data-action="print-one"
                data-recognition-id="${recognitionId}"
                data-recognition-folio="${escapeHtml(recognitionFolio)}"
                ${recognitionBtnDisabled}
              >
                Imprimir
              </button>
              <button
                class="small-btn small-btn-danger"
                data-action="delete-user"
                data-user-id="${escapeHtml(userId)}"
                data-user-name="${escapeHtml(row.nombre || "")}" 
                data-user-code="${escapeHtml(code)}"
              >
                Eliminar
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  refs.usersTableBody.querySelectorAll("[data-action='download-one']").forEach((button) => {
    button.addEventListener("click", async () => {
      const recognitionId = normalizeRecognitionId(button.getAttribute("data-recognition-id"));
      const recognitionFolio = String(button.getAttribute("data-recognition-folio") || "").trim();
      if (!recognitionId && !recognitionFolio) return;
      await downloadOne(recognitionId, recognitionFolio, button);
    });
  });

  refs.usersTableBody.querySelectorAll("[data-action='print-one']").forEach((button) => {
    button.addEventListener("click", async () => {
      const recognitionId = normalizeRecognitionId(button.getAttribute("data-recognition-id"));
      const recognitionFolio = String(button.getAttribute("data-recognition-folio") || "").trim();
      if (!recognitionId && !recognitionFolio) return;
      await printOne(recognitionId, recognitionFolio, button);
    });
  });

  refs.usersTableBody.querySelectorAll("[data-action='delete-user']").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = button.getAttribute("data-user-id");
      const userName = button.getAttribute("data-user-name");
      const userCode = button.getAttribute("data-user-code");
      if (!userId) return;
      await deleteUser(userId, userName, userCode, button);
    });
  });
}

function renderAlerts() {
  const alerts = state.alerts || [];
  refs.alertsSummary.textContent = alerts.length
    ? `Alertas activas: ${alerts.length}`
    : "Sin alertas activas por el momento.";

  if (!alerts.length) {
    refs.alertsList.innerHTML = `<div class="alert-item alert-ok">Sin registros críticos en este momento.</div>`;
    return;
  }

  refs.alertsList.innerHTML = alerts
    .map((alert) => {
      const updated = alert.updated_at ? new Date(alert.updated_at).toLocaleString("es-MX") : "-";
      const code = alert.codigo_interno ? ` · ${escapeHtml(alert.codigo_interno)}` : "";
      const attemptCount = Number(alert.attempt_count || 0);
      const attemptsText = attemptCount > 0 ? ` · Intentos: ${attemptCount}` : "";
      const severityClass = alert.severity === "high" ? "alert-high" : "alert-medium";
      return `
        <article class="alert-item ${severityClass}">
          <p class="alert-title">${escapeHtml(alert.type)} · ${escapeHtml(alert.nombre || "Sin nombre")}${code}</p>
          <p>${escapeHtml(alert.message || "-")}${attemptsText}</p>
          <p class="alert-date">Última actualización: ${escapeHtml(updated)}</p>
        </article>
      `;
    })
    .join("");
}

async function createUser() {
  const nombre = refs.newUserName.value.trim();
  const codigoInterno = refs.newUserCode.value.trim();
  const area = refs.newUserArea.value.trim();

  if (!nombre) {
    setAdminMessage("Captura el nombre del usuario.");
    return;
  }

  if (!codigoInterno) {
    setAdminMessage("Captura el número de empleado.");
    return;
  }

  if (!/^[0-9]+$/.test(codigoInterno)) {
    setAdminMessage("El número de empleado debe contener solo dígitos.");
    return;
  }

  try {
    setAdminMessage("Guardando usuario...");

    await apiRequest("/api/users", {
      method: "POST",
      body: {
        nombre,
        codigo_interno: codigoInterno,
        area,
      },
    });

    refs.addUserForm.reset();
    setAdminMessage("Usuario agregado correctamente.");
    await refreshAll();
  } catch (err) {
    setAdminMessage(`Error al crear usuario: ${err.message}`);
  }
}

async function downloadOne(recognitionId, recognitionFolio, triggerButton) {
  const safeRecognitionId = normalizeRecognitionId(recognitionId);
  const safeRecognitionFolio = String(recognitionFolio || "").trim();
  if (!safeRecognitionId && !safeRecognitionFolio) {
    setAdminMessage("El reconocimiento seleccionado no tiene identificador válido para descargar.");
    return;
  }

  const originalText = triggerButton ? triggerButton.textContent : "Descargar";

  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Preparando...";
  }

  try {
    setAdminMessage("Abriendo descarga con plantilla estandarizada...");
    openRecognitionDocument({
      mode: "download",
      recognitionId: safeRecognitionId,
      recognitionFolio: safeRecognitionFolio,
    });
    setAdminMessage("Descarga iniciada.");
  } catch (err) {
    setAdminMessage(`Error al descargar reconocimiento: ${err.message}`);
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = originalText;
    }
  }
}

async function printOne(recognitionId, recognitionFolio, triggerButton) {
  const safeRecognitionId = normalizeRecognitionId(recognitionId);
  const safeRecognitionFolio = String(recognitionFolio || "").trim();
  if (!safeRecognitionId && !safeRecognitionFolio) {
    setAdminMessage("El reconocimiento seleccionado no tiene identificador válido para imprimir.");
    return;
  }

  const originalText = triggerButton ? triggerButton.textContent : "Imprimir";
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Abriendo...";
  }

  try {
    setAdminMessage("Abriendo plantilla estandarizada para impresión...");
    openRecognitionDocument({
      mode: "print",
      recognitionId: safeRecognitionId,
      recognitionFolio: safeRecognitionFolio,
    });
  } catch (err) {
    setAdminMessage(`Error al imprimir reconocimiento: ${err.message}`);
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = originalText;
    }
  }
}

function openRecognitionDocument({ mode = "preview", recognitionId = "", recognitionFolio = "" }) {
  const params = new URLSearchParams();
  params.set("mode", mode);

  if (recognitionId) {
    params.set("id", recognitionId);
  } else if (recognitionFolio) {
    params.set("folio", recognitionFolio);
  }

  if (state.adminKey) {
    params.set("key", state.adminKey);
  }

  openDownloadUrl(`/recognition-document.html?${params.toString()}`);
}

function normalizeRecognitionId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower === "null" || lower === "undefined") return "";
  return normalized;
}

async function deleteUser(userId, userName, userCode, triggerButton) {
  const safeName = String(userName || "este colaborador").trim() || "este colaborador";
  const safeCode = String(userCode || "").trim();
  const label = safeCode && safeCode !== "-" ? `${safeName} (${safeCode})` : safeName;
  const confirmed = window.confirm(
    `¿Seguro que deseas eliminar a ${label}? Esta acción borrará su progreso, intentos y reconocimientos vinculados.`
  );

  if (!confirmed) {
    return;
  }

  const originalText = triggerButton ? triggerButton.textContent : "Eliminar";
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Eliminando...";
  }

  try {
    setAdminMessage(`Eliminando usuario ${label}...`);
    const data = await apiRequest(`/api/admin/users?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    const warningSuffix = data.warning ? ` Aviso: ${data.warning}` : "";
    setAdminMessage(`Usuario eliminado correctamente.${warningSuffix}`);
    await refreshAll();
  } catch (err) {
    setAdminMessage(`Error al eliminar usuario: ${err.message}`);
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = originalText;
    }
  }
}

async function downloadZip() {
  try {
    refs.downloadZipBtn.disabled = true;
    refs.downloadZipBtn.textContent = "Abriendo descarga...";
    setAdminMessage("Se abrirá una pestaña para preparar el ZIP.");

    const zipUrl = buildApiUrl("/api/recognitions/export-zip?refresh=1");
    openDownloadUrl(zipUrl);
  } catch (err) {
    setAdminMessage(`Error ZIP: ${err.message}`);
  } finally {
    window.setTimeout(() => {
      refs.downloadZipBtn.disabled = false;
      refs.downloadZipBtn.textContent = "Descargar ZIP de reconocimientos completados";
    }, 900);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

void init();
