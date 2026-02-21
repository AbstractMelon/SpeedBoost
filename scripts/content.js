(function initSpeedBoostContentScript() {
  function showToast(message, isError = false, timeout = 2600) {
    const existing = document.getElementById("speedboost-toast");
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = "speedboost-toast";
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
    }, timeout);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "speedboost-notify") {
      return;
    }

    const text = typeof message.message === "string" ? message.message : "";
    if (!text) {
      return;
    }

    showToast(text, message.kind === "error", message.timeout);
  });

  function notifyIfCanvasCourse() {
    const url = window.location.href;
    const isCanvasCourseUrl = /https:\/\/canyongrove\.instructure\.com\/courses\/\d+/.test(url);
    if (!isCanvasCourseUrl) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "canvas-course-visited",
      url
    });
  }

  function wrapHistoryMethod(methodName) {
    const original = history[methodName];
    history[methodName] = function wrappedHistoryMethod(...args) {
      const result = original.apply(this, args);
      queueMicrotask(notifyIfCanvasCourse);
      return result;
    };
  }

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  window.addEventListener("popstate", notifyIfCanvasCourse);
  window.addEventListener("hashchange", notifyIfCanvasCourse);

  notifyIfCanvasCourse();
})();