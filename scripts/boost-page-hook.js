(() => {
  if (window.__speedBoostPageHookInstalled) {
    return;
  }
  window.__speedBoostPageHookInstalled = true;

  const TYPE = "speedboost-page-token";

  const isJwtLike = (value) => typeof value === "string" && /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(value.trim());

  const fromAuthHeader = (value) => {
    if (typeof value !== "string") {
      return "";
    }

    const match = value.match(/^Bearer\s+(.+)$/i);
    const token = (match ? match[1] : value).trim();
    return isJwtLike(token) ? token : "";
  };

  const emit = (token, source) => {
    if (!token) {
      return;
    }

    window.postMessage({ type: TYPE, token, source }, window.location.origin);
  };

  const readHeaders = (headers) => {
    if (!headers) {
      return "";
    }

    if (typeof headers.get === "function") {
      return fromAuthHeader(headers.get("Authorization") || headers.get("authorization") || "");
    }

    if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (!Array.isArray(pair) || pair.length < 2) {
          continue;
        }

        if (String(pair[0]).toLowerCase() === "authorization") {
          return fromAuthHeader(String(pair[1]));
        }
      }
      return "";
    }

    if (typeof headers === "object") {
      const auth = headers.Authorization || headers.authorization;
      return fromAuthHeader(auth ? String(auth) : "");
    }

    return "";
  };

  const patchFetch = () => {
    if (typeof window.fetch !== "function") {
      return;
    }

    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(...args) {
      try {
        const request = args[0];
        const init = args[1];
        let token = "";

        if (request && typeof request === "object" && request.headers) {
          token = readHeaders(request.headers);
        }

        if (!token && init && typeof init === "object") {
          token = readHeaders(init.headers);
        }

        if (token) {
          emit(token, "fetch");
        }
      } catch {}

      return originalFetch.apply(this, args);
    };
  };

  const patchXhr = () => {
    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || typeof proto.setRequestHeader !== "function") {
      return;
    }

    const originalSetRequestHeader = proto.setRequestHeader;
    proto.setRequestHeader = function patchedSetRequestHeader(name, value) {
      try {
        if (String(name).toLowerCase() === "authorization") {
          const token = fromAuthHeader(String(value));
          if (token) {
            emit(token, "xhr");
          }
        }
      } catch {}

      return originalSetRequestHeader.apply(this, [name, value]);
    };
  };

  const probeGlobals = () => {
    try {
      if (window.keycloak && window.keycloak.token) {
        emit(fromAuthHeader(window.keycloak.token), "keycloak-global");
      }
    } catch {}

    try {
      if (window.userState && window.userState.bearerToken) {
        emit(fromAuthHeader(window.userState.bearerToken), "userState-global");
      }
    } catch {}
  };

  patchFetch();
  patchXhr();
  probeGlobals();
  setInterval(probeGlobals, 15000);
})();
