const form = document.getElementById("settings-form");
const emailInput = document.getElementById("email");
const bearerTokenInput = document.getElementById("bearerToken");
const statusElement = document.getElementById("status");

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#b91c1c" : "#047857";
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(["email", "bearerToken"]);

  emailInput.value = data.email || "";
  bearerTokenInput.value = data.bearerToken || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const bearerToken = bearerTokenInput.value.trim();

  if (!email || !bearerToken) {
    setStatus("Email and token are required.", true);
    return;
  }

  try {
    await chrome.storage.sync.set({ email, bearerToken });
    setStatus("Saved.");
  } catch {
    setStatus("Failed to save settings.", true);
  }
});

loadSettings().catch(() => {
  setStatus("Failed to load saved settings.", true);
});