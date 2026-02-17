(function initSpeedBoostContentScript() {
  let lastNotifiedUrl = "";

  function notifyIfCanvasCourse() {
    const url = window.location.href;
    // Uncomment to allow multiple notifications for the same course within a short time frame 
    // if (url === lastNotifiedUrl) {
    //   return;
    // }

    const isCanvasCourseUrl = /https:\/\/canyongrove\.instructure\.com\/courses\/\d+/.test(url);
    if (!isCanvasCourseUrl) {
      return;
    }

    lastNotifiedUrl = url;
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