const BOOST_API_COURSES_URL = "https://boost.lifted-management.com/api/Canvas/courses/";
const BOOST_ATTENDANCE_URLS = [
  "https://boost.lifted-management.com/api/Attendance",
  "https://boost.lifted-management.com/Attendance"
];

const lastTriggerByTab = new Map();
const lastCurriculumTriggerByTab = new Map();

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

function pickFirstNumber(...values) {
  for (const value of values) {
    const parsed = toValidNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

async function getSettings() {
  const data = await chrome.storage.sync.get(["bearerToken", "email", "userId", "submittedById"]);
  const bearerToken = typeof data.bearerToken === "string" ? data.bearerToken.trim() : "";
  const jwtPayload = decodeJwtPayload(bearerToken);

  const tokenEmail = typeof jwtPayload?.email === "string" ? jwtPayload.email.trim() : "";
  const tokenUserId = toValidNumber(jwtPayload?.appUserId);

  const storedEmail = typeof data.email === "string" ? data.email.trim() : "";
  const storedUserId = toValidNumber(data.userId);
  const storedSubmittedById = toValidNumber(data.submittedById);

  const resolvedEmail = tokenEmail || storedEmail;
  const resolvedUserId = tokenUserId ?? storedUserId;
  const resolvedSubmittedById = tokenUserId ?? storedSubmittedById ?? resolvedUserId;

  return {
    email: resolvedEmail,
    bearerToken,
    userId: resolvedUserId,
    submittedById: resolvedSubmittedById
  };
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

function resolveUserIds(settings, matchedCourse) {
  const matchedUserId = pickFirstNumber(
    matchedCourse?.userId,
    matchedCourse?.studentId,
    matchedCourse?.learnerId,
    matchedCourse?.student?.id,
    matchedCourse?.user?.id
  );
  const matchedSubmittedById = pickFirstNumber(
    matchedCourse?.submittedById,
    matchedCourse?.submittedBy?.id,
    matchedCourse?.user?.id,
    matchedCourse?.instructorId
  );

  const userId = pickFirstNumber(settings.userId, matchedUserId, matchedSubmittedById);
  const submittedById = pickFirstNumber(settings.submittedById, matchedSubmittedById, userId);

  return {
    userId,
    submittedById
  };
}

async function postAttendance({ bearerToken, userId, submittedById, notes }) {
  const payload = {
    userId,
    type: "participation",
    notes,
    submittedById,
    attendanceDate: new Date().toISOString()
  };

  let lastErrorStatus = 0;

  for (const endpoint of BOOST_ATTENDANCE_URLS) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return;
    }

    lastErrorStatus = response.status;
    if (response.status !== 404 && response.status !== 405) {
      const responseText = await response.text().catch(() => "");
      const detail = responseText ? `: ${responseText.slice(0, 180)}` : "";
      throw new Error(`Attendance request failed (${response.status})${detail}`);
    }
  }

  throw new Error(`Attendance request failed (${lastErrorStatus || "unknown"})`);
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

function shouldSkipCurriculum(tabId, courseId, curriculumKey) {
  if (typeof tabId !== "number" || !curriculumKey) {
    return false;
  }

  const previous = lastCurriculumTriggerByTab.get(tabId);
  if (!previous || previous.courseId !== courseId) {
    return false;
  }

  return previous.loggedCurriculums.has(curriculumKey);
}

function markCurriculumTriggered(tabId, courseId, curriculumKey) {
  if (typeof tabId !== "number" || !curriculumKey) {
    return;
  }

  let previous = lastCurriculumTriggerByTab.get(tabId);
  if (!previous || previous.courseId !== courseId) {
    previous = {
      courseId,
      loggedCurriculums: new Set()
    };
    lastCurriculumTriggerByTab.set(tabId, previous);
  }

  previous.loggedCurriculums.add(curriculumKey);
}

async function resolveMatchedCourse(email, bearerToken, courseId) {
  const courses = await fetchCourses(email, bearerToken);
  if (!Array.isArray(courses)) {
    throw new Error("Courses response was not an array");
  }

  return courses.find((course) => Number(course?.courseId) === courseId) || null;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  lastTriggerByTab.delete(tabId);
  lastCurriculumTriggerByTab.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || (message.type !== "canvas-course-visited" && message.type !== "canvas-curriculum-opened")) {
    return;
  }

  const courseId = extractCourseId(message.url);
  if (!courseId) {
    return;
  }

  const tabId = sender?.tab?.id;
  if (message.type === "canvas-course-visited" && shouldSkipTab(tabId, courseId)) {
    return;
  }

  const curriculumName = typeof message.curriculumName === "string" ? message.curriculumName.trim() : "";
  const curriculumKey = curriculumName.toLowerCase();
  if (message.type === "canvas-curriculum-opened" && shouldSkipCurriculum(tabId, courseId, curriculumKey)) {
    return;
  }

  (async () => {
    try {
      const { email, bearerToken, userId: settingsUserId, submittedById: settingsSubmittedById } = await getSettings();
      if (!email || !bearerToken) {
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          message: "Missing email or bearer token"
        });
        return;
      }

      const matchedCourse = await resolveMatchedCourse(email, bearerToken, courseId);
      const courseName = matchedCourse?.name || `Course #${courseId}`;

      if (!matchedCourse && message.type === "canvas-course-visited") {
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          message: `Course ${courseId} not found in Boost courses list`
        });
        return;
      }

      const { userId, submittedById } = resolveUserIds(
        {
          userId: settingsUserId,
          submittedById: settingsSubmittedById
        },
        matchedCourse
      );

      if (userId === null || submittedById === null) {
        await saveLastStatus({
          ok: false,
          at: Date.now(),
          courseId,
          courseName,
          message: "Missing userId or submittedById in settings/course data"
        });
        return;
      }

      const notes = message.type === "canvas-course-visited"
        ? `Viewed Course: ${courseName}`
        : `Opened Curriculum: ${curriculumName || "Unknown Curriculum"}`;

      await postAttendance({
        bearerToken,
        userId,
        submittedById,
        notes
      });

      if (message.type === "canvas-course-visited") {
        markTriggered(tabId, courseId);
      } else {
        markCurriculumTriggered(tabId, courseId, curriculumKey);
      }

      await saveLastStatus({
        ok: true,
        at: Date.now(),
        courseId,
        courseName,
        message: notes
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