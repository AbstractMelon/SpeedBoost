const BOOST_API_COURSES_URL = "https://boost.lifted-management.com/api/Canvas/courses/";
const BOOST_COURSE_VISIT_BASE_URL = "https://boost.lifted-management.com/courses?course=";

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

async function getSettings() {
  const data = await chrome.storage.sync.get(["email", "bearerToken"]);

  return {
    email: typeof data.email === "string" ? data.email.trim() : "",
    bearerToken: typeof data.bearerToken === "string" ? data.bearerToken.trim() : ""
  };
}

async function fetchCourses(email, bearerToken) {
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

  return response.json();
}

async function pingBoostCourse(courseName) {
  const url = `${BOOST_COURSE_VISIT_BASE_URL}${encodeURIComponent(courseName)}`;

  await fetch(url, {
    method: "GET",
    mode: "no-cors",
    credentials: "include"
  });
}

function shouldSkipTab(tabId, courseId) {
  if (typeof tabId !== "number") {
    return false;
  }

  const previous = lastTriggerByTab.get(tabId);

  if (!previous || previous.courseId !== courseId) {
    return false;
  }

  return Date.now() - previous.timestamp < 60_000;
}

function markTriggered(tabId, courseId) {
  if (typeof tabId !== "number") {
    return;
  }

  lastTriggerByTab.set(tabId, {
    courseId,
    timestamp: Date.now()
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "canvas-course-visited") {
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
      const { email, bearerToken } = await getSettings();
      if (!email || !bearerToken) {
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          message: "Missing email or bearer token"
        });
        return;
      }

      const courses = await fetchCourses(email, bearerToken);
      if (!Array.isArray(courses)) {
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          message: "Courses response was not an array"
        });
        return;
      }

      const matchedCourse = courses.find((course) => Number(course?.courseId) === courseId);
      if (!matchedCourse || !matchedCourse.name) {
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          message: `Course ${courseId} not found in Boost courses list`
        });
        return;
      }

      await pingBoostCourse(matchedCourse.name);
      markTriggered(tabId, courseId);
      await saveLastStatus({
        ok: true,
        at: Date.now(),
        courseId,
        courseName: matchedCourse.name,
        message: "Boost ping sent"
      });
    } catch (error) {
      console.error("SpeedBoost: failed to process Canvas course visit", error);
      await saveLastStatus({
        ok: false,
        at: Date.now(),
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  })();
});