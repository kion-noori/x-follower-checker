(function () {
  if (window.__xfcHookInstalled) return;
  window.__xfcHookInstalled = true;

  function extractBearerToken(value) {
    if (!value) return null;
    const match = String(value).match(/Bearer\s+(AAAAA[A-Za-z0-9%_-]{20,})/);
    return match ? match[1] : null;
  }

  function storeBearerToken(token) {
    if (!token) return;
    document.documentElement.dataset.xfcBearerToken = token;
  }

  function readFromHeaders(headers) {
    if (!headers) return null;

    if (typeof headers.get === "function") {
      return extractBearerToken(headers.get("authorization"));
    }

    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        if (String(key).toLowerCase() === "authorization") {
          return extractBearerToken(value);
        }
      }
      return null;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (String(key).toLowerCase() === "authorization") {
        return extractBearerToken(value);
      }
    }

    return null;
  }

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    try {
      const directToken = readFromHeaders(init && init.headers);
      if (directToken) {
        storeBearerToken(directToken);
      }

      if (input && typeof input === "object" && typeof input.headers?.get === "function") {
        const requestToken = extractBearerToken(input.headers.get("authorization"));
        if (requestToken) {
          storeBearerToken(requestToken);
        }
      }
    } catch {}

    return originalFetch.apply(this, arguments);
  };

  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
    try {
      if (String(name).toLowerCase() === "authorization") {
        const token = extractBearerToken(value);
        if (token) {
          storeBearerToken(token);
        }
      }
    } catch {}

    return originalSetRequestHeader.apply(this, arguments);
  };
})();
