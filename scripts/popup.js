const emailInput = document.getElementById("email");
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

async function loadData() {
  const [settings, localData] = await Promise.all([
    chrome.storage.sync.get(["email"]),
    chrome.storage.local.get(["lastStatus"])
  ]);

  emailInput.value = settings.email || "Not synced yet";
  renderLastStatus(localData.lastStatus || null);
}

loadData().catch(() => {
  emailInput.value = "Failed to load";
});