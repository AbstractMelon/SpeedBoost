(function initBoostTokenSync() {
  const PAGE_MESSAGE_TYPE = "speedboost-page-token";
  const SENT_CACHE_KEY = "speedBoostLastSentToken";
  let lastSentToken = "";
  let hasSyncedToken = false;
  let tokenFailureNotified = false;

  function isJwtLike(value) {
    return typeof value === "string" && /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(value.trim());
  }

  function decodeJwtPayload(token) {
    if (!isJwtLike(token)) {
      return null;
    }

    const parts = token.trim().split(".");

    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function showNotification(message, isError = false) {
    const existing = document.getElementById("speedboost-token-toast");
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = "speedboost-token-toast";
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.right = "16px";
    toast.style.bottom = "16px";
    toast.style.zIndex = "2147483647";
    toast.style.padding = "10px 12px";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "13px";
    toast.style.fontFamily = "Arial, sans-serif";
    toast.style.color = "#ffffff";
    toast.style.background = isError ? "#991b1b" : "#047857";
    toast.style.boxShadow = "0 6px 16px rgba(0,0,0,0.25)";

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2600);
  }

  function getIdentityFromToken(token) {
    const payload = decodeJwtPayload(token);
    const email = typeof payload?.email === "string" ? payload.email.trim() : "";
    const userId = Number(payload?.appUserId);

    if (!email || !Number.isFinite(userId)) {
      return null;
    }

    return {
      email,
      userId
    };
  }

  function extractBearerToken(value) {
    if (typeof value !== "string") {
      return "";
    }

    const match = value.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1].trim() : value.trim();
    return isJwtLike(token) ? token : "";
  }

  function findJwtInStorage(storage) {
    if (!storage) {
      return "";
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }

      const rawValue = storage.getItem(key);
      const direct = extractBearerToken(rawValue);
      if (direct && getIdentityFromToken(direct)) {
        return direct;
      }

      if (typeof rawValue === "string") {
        const nestedMatch = rawValue.match(/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/);
        const nested = extractBearerToken(nestedMatch ? nestedMatch[0] : "");
        if (nested && getIdentityFromToken(nested)) {
          return nested;
        }
      }
    }

    return "";
  }

  function getLastSentToken() {
    return sessionStorage.getItem(SENT_CACHE_KEY) || "";
  }

  function setLastSentToken(token) {
    sessionStorage.setItem(SENT_CACHE_KEY, token);
    lastSentToken = token;
  }

  function sendTokenToBackground(token, reason) {
    const identity = getIdentityFromToken(token);
    if (!identity) {
      return;
    }

    const cached = lastSentToken || getLastSentToken();
    if (token === cached) {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "boost-token-updated",
        token,
        reason
      },
      (response) => {
        if (chrome.runtime.lastError) {
          return;
        }

        if (response?.ok) {
          setLastSentToken(token);
          hasSyncedToken = true;
          showNotification(`SpeedBoost connected as ${identity.email}`);
          return;
        }

        if (response?.error) {
          showNotification(`SpeedBoost token sync failed: ${response.error}`, true);
        }
      }
    );
  }

  function syncFromStorage(reason) {
    const token = findJwtInStorage(localStorage) || findJwtInStorage(sessionStorage);
    if (!token) {
      return;
    }

    sendTokenToBackground(token, reason);
  }

  function injectPageTokenWatcher() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("scripts/boost-page-hook.js");
    script.async = false;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.addEventListener("load", () => {
      script.remove();
    });
    script.addEventListener("error", () => {
      script.remove();
      showNotification("SpeedBoost failed to inject token watcher", true);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    const data = event.data;
    if (!data || data.type !== PAGE_MESSAGE_TYPE) {
      return;
    }

    const token = extractBearerToken(data.token || "");
    if (!token) {
      return;
    }

    sendTokenToBackground(token, `page-${data.source || "message"}`);
  });

  injectPageTokenWatcher();
  syncFromStorage("initial-load");

  setTimeout(() => {
    if (hasSyncedToken || tokenFailureNotified) {
      return;
    }

    const found = findJwtInStorage(localStorage) || findJwtInStorage(sessionStorage);
    if (!found) {
      tokenFailureNotified = true;
      showNotification("SpeedBoost could not find your Boost token yet. Navigate in Boost and try again.", true);
    }
  }, 12000);

  window.addEventListener("focus", () => {
    syncFromStorage("window-focus");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncFromStorage("visibility");
    }
  });

  setInterval(() => {
    syncFromStorage("interval");
  }, 10000);
})();
