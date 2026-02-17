const form = document.getElementById("settings-form");
const emailInput = document.getElementById("email");
const bearerTokenInput = document.getElementById("bearerToken");
const saveStatusElement = document.getElementById("save-status");
const lastStatusElement = document.getElementById("last-status");

function decodeJwtPayload(token) {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function deriveIdentityFromToken(token) {
  const payload = decodeJwtPayload(token);
  const email = typeof payload?.email === "string" ? payload.email.trim() : "";
  const userId = Number(payload?.appUserId);

  if (!email || !Number.isFinite(userId)) {
    return null;
  }

  return {
    email,
    userId,
    submittedById: userId
  };
}

function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Unknown";
  }
}

function renderLastStatus(status) {
  if (!status) {
    lastStatusElement.textContent = "No attempts yet.";
    lastStatusElement.className = "status";
    return;
  }

  const when = formatTimestamp(status.at);
  const base = `Last attempt: ${when}`;

  if (status.ok) {
    const coursePart = status.courseName
      ? ` | Course: ${status.courseName}${status.courseId ? ` (#${status.courseId})` : ""}`
      : "";
    lastStatusElement.textContent = `${base} | Success${coursePart}`;
    lastStatusElement.className = "status success";
    return;
  }

  const messagePart = status.message ? ` | ${status.message}` : "";
  lastStatusElement.textContent = `${base} | Failed${messagePart}`;
  lastStatusElement.className = "status failure";
}

function setSaveStatus(message, isError = false) {
  saveStatusElement.textContent = message;
  saveStatusElement.style.color = isError ? "#b91c1c" : "#047857";
}

async function loadData() {
  const [settings, localData] = await Promise.all([
    chrome.storage.sync.get(["email", "bearerToken", "userId", "submittedById"]),
    chrome.storage.local.get(["lastStatus"])
  ]);

  emailInput.value = settings.email || "";
  bearerTokenInput.value = settings.bearerToken || "";
  emailInput.readOnly = true;
  renderLastStatus(localData.lastStatus || null);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const bearerToken = bearerTokenInput.value.trim();
  const derived = deriveIdentityFromToken(bearerToken);

  if (!bearerToken) {
    setSaveStatus("Bearer token is required.", true);
    return;
  }

  if (!derived) {
    setSaveStatus("Token must include valid email and appUserId claims.", true);
    return;
  }

  emailInput.value = derived.email;

  try {
    await chrome.storage.sync.set({
      email: derived.email,
      bearerToken,
      userId: derived.userId,
      submittedById: derived.submittedById
    });
    setSaveStatus("Saved.");
  } catch {
    setSaveStatus("Failed to save.", true);
  }
});

loadData().catch(() => {
  setSaveStatus("Failed to load data.", true);
});