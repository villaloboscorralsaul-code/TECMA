const state = {
  adminKey: "",
  users: [],
  alerts: [],
  overview: null,
  loading: false,
};
const REQUEST_TIMEOUT_MS = 45000;
const QUIZ_TOTAL_QUESTIONS = 7;

const refs = {
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

function init() {
  const params = new URLSearchParams(window.location.search);
  state.adminKey = (params.get("key") || "").trim();

  if (!state.adminKey) {
    refs.accessInfo.textContent = "Acceso bloqueado: agrega la llave en el query string.";
    refs.accessError.classList.remove("hidden");
    disableActions();
    return;
  }

  refs.accessInfo.textContent = "Acceso admin validado por llave en URL.";
  bindEvents();
  refreshAll();
}

function bindEvents() {
  refs.refreshBtn.addEventListener("click", refreshAll);
  refs.statusFilter.addEventListener("change", loadUsers);
  refs.downloadZipBtn.addEventListener("click", downloadZip);

  refs.addUserForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createUser();
  });
}

function disableActions() {
  refs.refreshBtn.disabled = true;
  refs.downloadZipBtn.disabled = true;
  refs.addUserForm.querySelector("button[type='submit']").disabled = true;
}

function buildApiUrl(path) {
  const prefix = path.includes("?") ? "&" : "?";
  return `${path}${prefix}key=${encodeURIComponent(state.adminKey)}`;
}

function setAdminMessage(message) {
  refs.addUserMessage.textContent = message || "";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
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
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.blob();
}

async function refreshAll() {
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
      const code = row.codigo_interno || "-";
      const area = row.area || "-";
      const userId = row.id || "";
      const recognitionId = normalizeRecognitionId(row.recognition_id);
      const recognitionBtnDisabled = recognitionId ? "" : "disabled";

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
              <button class="small-btn" data-action="download-one" data-recognition-id="${recognitionId}" ${recognitionBtnDisabled}>
                Descargar
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
      if (!recognitionId) return;
      await downloadOne(recognitionId, button);
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

async function downloadOne(recognitionId, triggerButton) {
  const safeRecognitionId = normalizeRecognitionId(recognitionId);
  if (!safeRecognitionId) {
    setAdminMessage("El reconocimiento seleccionado no tiene un ID válido para descargar.");
    return;
  }

  const originalText = triggerButton ? triggerButton.textContent : "Descargar";
  let pendingWindow = null;

  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Preparando...";
  }

  try {
    pendingWindow = window.open("", "_blank", "noopener,noreferrer");
  } catch {
    pendingWindow = null;
  }

  try {
    setAdminMessage("Generando enlace de descarga...");
    const data = await apiRequest(`/api/recognitions/${encodeURIComponent(safeRecognitionId)}/download`);
    if (!data.download_url) {
      throw new Error("No se recibió URL de descarga.");
    }

    if (pendingWindow && !pendingWindow.closed) {
      pendingWindow.location.href = data.download_url;
    } else {
      openDownloadUrl(data.download_url);
    }

    setAdminMessage(`Descarga iniciada${data.folio ? ` (${data.folio})` : ""}.`);
  } catch (err) {
    if (pendingWindow && !pendingWindow.closed) {
      pendingWindow.close();
    }
    setAdminMessage(`Error al descargar reconocimiento: ${err.message}`);
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = originalText;
    }
  }
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

    const zipUrl = buildApiUrl("/api/recognitions/export-zip");
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

init();
