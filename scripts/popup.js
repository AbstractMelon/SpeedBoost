const form = document.getElementById("settings-form");
const emailInput = document.getElementById("email");
const bearerTokenInput = document.getElementById("bearerToken");
const saveStatusElement = document.getElementById("save-status");
const lastStatusElement = document.getElementById("last-status");

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
    chrome.storage.sync.get(["email", "bearerToken"]),
    chrome.storage.local.get(["lastStatus"])
  ]);

  emailInput.value = settings.email || "";
  bearerTokenInput.value = settings.bearerToken || "";
  renderLastStatus(localData.lastStatus || null);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const bearerToken = bearerTokenInput.value.trim();

  if (!email || !bearerToken) {
    setSaveStatus("Email and token are required.", true);
    return;
  }

  try {
    await chrome.storage.sync.set({ email, bearerToken });
    setSaveStatus("Saved.");
  } catch {
    setSaveStatus("Failed to save.", true);
  }
});

loadData().catch(() => {
  setSaveStatus("Failed to load data.", true);
});