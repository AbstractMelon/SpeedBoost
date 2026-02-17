const form = document.getElementById("settings-form");
const emailInput = document.getElementById("email");
const bearerTokenInput = document.getElementById("bearerToken");
const statusElement = document.getElementById("status");

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

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#b91c1c" : "#047857";
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(["email", "bearerToken", "userId", "submittedById"]);

  emailInput.value = data.email || "";
  bearerTokenInput.value = data.bearerToken || "";

  emailInput.readOnly = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const bearerToken = bearerTokenInput.value.trim();
  const derived = deriveIdentityFromToken(bearerToken);

  if (!bearerToken) {
    setStatus("Bearer token is required.", true);
    return;
  }

  if (!derived) {
    setStatus("Token must include valid email and appUserId claims.", true);
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
    setStatus("Saved.");
  } catch {
    setStatus("Failed to save settings.", true);
  }
});

loadSettings().catch(() => {
  setStatus("Failed to load saved settings.", true);
});