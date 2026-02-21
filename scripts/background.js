const BOOST_API_COURSES_URL = "https://boost.lifted-management.com/api/Canvas/courses/";
const BOOST_ATTENDANCE_URL = "https://boost.lifted-management.com/api/Attendance";

const lastTriggerByTab = new Map();

async function saveLastStatus(status) {
  await chrome.storage.local.set({ lastStatus: status });
}

function extractCourseId(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/courses\/(\d+)/);

    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function toValidNumber(value) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function decodeJwtPayload(token) {
  if (typeof token !== "string" || !token.trim()) {
    return null;
  }

  const parts = token.trim().split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function getSettings() {
  const data = await chrome.storage.sync.get(["bearerToken", "email", "userId"]);
  const bearerToken = typeof data.bearerToken === "string" ? data.bearerToken.trim() : "";
  const jwtPayload = decodeJwtPayload(bearerToken);

  const email = (typeof jwtPayload?.email === "string" ? jwtPayload.email.trim() : "") ||
                (typeof data.email === "string" ? data.email.trim() : "");
  const userId = toValidNumber(jwtPayload?.appUserId) ?? toValidNumber(data.userId);

  return { email, bearerToken, userId };
}

async function fetchCourses(email, bearerToken) {
  // Try to use cached courses first (valid for 1 hour)
  const cached = await chrome.storage.local.get(["courses", "coursesAt"]);
  if (cached.courses && cached.coursesAt && Date.now() - cached.coursesAt < 3_600_000) {
    return cached.courses;
  }

  const response = await fetch(BOOST_API_COURSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });

  if (!response.ok) {
    throw new Error(`Courses request failed (${response.status})`);
  }

  const courses = await response.json();

  // Cache the new list
  await chrome.storage.local.set({
    courses,
    coursesAt: Date.now()
  });

  return courses;
}

async function postAttendance({ bearerToken, userId, notes }) {
  const payload = {
    userId,
    submittedById: userId,
    type: "participation",
    notes,
    attendanceDate: new Date().toISOString()
  };

  const response = await fetch(BOOST_ATTENDANCE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const detail = responseText ? `: ${responseText.slice(0, 180)}` : "";
    throw new Error(`Attendance request failed (${response.status})${detail}`);
  }
}

function shouldSkipTab(tabId, courseId) {
  if (typeof tabId !== "number") {
    return false;
  }

  const previous = lastTriggerByTab.get(tabId);

  if (!previous || previous.courseId !== courseId) {
    return false;
  }

  return true;
}

function markTriggered(tabId, courseId) {
  if (typeof tabId !== "number") {
    return;
  }

  lastTriggerByTab.set(tabId, {
    courseId
  });
}

async function resolveMatchedCourse(email, bearerToken, courseId) {
  const courses = await fetchCourses(email, bearerToken);
  if (!Array.isArray(courses)) {
    throw new Error("Courses response was not an array");
  }

  return courses.find((course) => Number(course?.courseId) === courseId) || null;
}

async function notifyTab(tabId, kind, message, timeout = 2600) {
  if (typeof tabId !== "number") {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "speedboost-notify",
      kind,
      message,
      timeout
    });
  } catch {
    // Ignore if content script isn't available on the tab.
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  lastTriggerByTab.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return;
  }

  if (message.type === "boost-token-updated") {
    const token = typeof message.token === "string" ? message.token.trim() : "";
    const payload = decodeJwtPayload(token);

    if (!token || !payload) {
      return false;
    }

    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const userId = toValidNumber(payload.appUserId);

    if (!email || userId === null) {
      return false;
    }

    chrome.storage.sync.set({ bearerToken: token, email, userId }).then(() => {
      saveLastStatus({
        ok: true,
        at: Date.now(),
        message: `Token synced: ${email}`
      }).catch(() => {});

      if (typeof sendResponse === "function") {
        sendResponse({ ok: true, email });
      }
    }).catch((error) => {
      if (typeof sendResponse === "function") {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to save token"
        });
      }
    });

    return true;
  }

  if (message.type !== "canvas-course-visited") {
    return;
  }

  const courseId = extractCourseId(message.url);
  if (!courseId) {
    return;
  }

  const tabId = sender?.tab?.id;
  if (shouldSkipTab(tabId, courseId)) {
    return;
  }

  (async () => {
    try {
      const { email, bearerToken, userId } = await getSettings();
      if (!email || !bearerToken) {
        await notifyTab(tabId, "error", "SpeedBoost: Token is missing/expired. Open Boost to auto-fetch a fresh token.", 4000);
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          message: "Token is missing/expired. Open Boost once to auto-fetch a fresh token."
        });
        return;
      }

      const matchedCourse = await resolveMatchedCourse(email, bearerToken, courseId);
      const courseName = matchedCourse?.name || `Course #${courseId}`;

      if (!matchedCourse) {
        await notifyTab(tabId, "error", `SpeedBoost: attendance not sent (course ${courseId} not found)`);
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          message: `Course ${courseId} not found in Boost courses list`
        });
        return;
      }

      if (userId === null) {
        await notifyTab(tabId, "error", "SpeedBoost: attendance not sent (missing user ID)");
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          courseId,
          courseName,
          message: "Missing userId in settings - re-open Boost to re-sync token."
        });
        return;
      }

      const notes = `[SpeedBoost] Viewed Course: ${courseName}`;

      await postAttendance({ bearerToken, userId, notes });

      await notifyTab(tabId, "success", `Attendance sent for ${courseName}`);

      markTriggered(tabId, courseId);

      await saveLastStatus({
        ok: true,
        at: Date.now(),
        courseId,
        courseName,
        message: notes
      });
    } catch (error) {
      console.error("SpeedBoost: failed to process Canvas course visit", error);
      await notifyTab(tabId, "error", `SpeedBoost: attendance failed (${error instanceof Error ? error.message : "Unknown error"})`);
      await saveLastStatus({
        ok: false,
        at: Date.now(),
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  })();
});