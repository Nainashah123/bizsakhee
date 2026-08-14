import { describe, expect, it } from "vitest";

import {
  classifyDueAt,
  countByView,
  filterTasks,
  fromZonedInputValues,
  isValidTimeZone,
  resolveTimeZone,
  startOfNextZonedDay,
  startOfZonedDay,
  TASK_VIEWS,
  taskBucket,
  taskMatchesView,
  taskViewWindow,
  toZonedInputValues,
  zonedParts,
  zonedTimeToUtc,
  type ClassifiableTask,
} from "@/lib/tasks/filters";

/*
 * Every instant in this file is written as a literal UTC timestamp with the
 * workspace-local wall clock spelled out beside it. Nothing calls `new Date()`
 * with no argument, so the suite gives the same answer on any machine, in any
 * server timezone, on any day.
 *
 * Reference offsets used below:
 *   Asia/Kolkata      = UTC+05:30 all year (no DST)
 *   America/New_York  = UTC-05:00 (EST) in winter, UTC-04:00 (EDT) in summer.
 *                       In 2026 DST runs 08 Mar 07:00Z -> 01 Nov 06:00Z.
 */

const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";

/** 2026-03-12 23:00 in Asia/Kolkata (= 17:30Z, since IST is UTC+5:30). */
const NOW_KOLKATA = new Date("2026-03-12T17:30:00Z");

/**
 * 2026-03-12 23:00 in America/New_York. The UTC clock has *already rolled over*
 * to 13 March at this instant - exactly the situation where classifying in UTC
 * puts half a day's follow-ups in the wrong bucket.
 */
const NOW_NEW_YORK = new Date("2026-03-13T03:00:00Z");

describe("classifyDueAt - Asia/Kolkata (UTC+05:30)", () => {
  it("keeps a task due 23:30 IST in 'due today', not overdue and not upcoming", () => {
    // 23:30 IST on 12 Mar = 18:00Z on 12 Mar. "Now" is 23:00 IST (17:30Z),
    // and the next IST midnight is 18:30Z - so 18:00Z is still today.
    const due = new Date("2026-03-12T18:00:00Z");
    expect(due.getTime()).toBeGreaterThan(NOW_KOLKATA.getTime());
    expect(classifyDueAt(due, NOW_KOLKATA, KOLKATA)).toBe("due_today");
  });

  it("flips that same task to overdue once its instant passes", () => {
    // Same due instant, but "now" advanced to 23:31 IST (18:01Z).
    const due = new Date("2026-03-12T18:00:00Z");
    const later = new Date("2026-03-12T18:01:00Z");
    expect(classifyDueAt(due, later, KOLKATA)).toBe("overdue");
  });

  it("calls a task due just after local midnight 'upcoming', not overdue", () => {
    // 00:30 IST on 13 Mar = 19:00Z on 12 Mar. Classified in UTC this looks like
    // "later today"; in the workspace zone it is tomorrow.
    const due = new Date("2026-03-12T19:00:00Z");
    expect(classifyDueAt(due, NOW_KOLKATA, KOLKATA)).toBe("upcoming");
    // Sanity: it is genuinely in the future, so "overdue" is never plausible.
    expect(due.getTime()).toBeGreaterThan(NOW_KOLKATA.getTime());
  });

  it("puts the very last minute of the IST day in 'due today'", () => {
    // 23:59 IST = 18:29Z, one minute before the 18:30Z rollover.
    expect(
      classifyDueAt(new Date("2026-03-12T18:29:00Z"), NOW_KOLKATA, KOLKATA),
    ).toBe("due_today");
    // 00:00 IST the next day = 18:30Z exactly. The boundary is exclusive of
    // today, so midnight itself belongs to tomorrow.
    expect(
      classifyDueAt(new Date("2026-03-12T18:30:00Z"), NOW_KOLKATA, KOLKATA),
    ).toBe("upcoming");
  });

  it("marks an instant clearly in the past as overdue", () => {
    // 01 Jan 2026, months before "now".
    expect(classifyDueAt("2026-01-01T00:00:00Z", NOW_KOLKATA, KOLKATA)).toBe(
      "overdue",
    );
    // 22:00 IST today (16:30Z) is also already gone at 23:00 IST.
    expect(classifyDueAt("2026-03-12T16:30:00Z", NOW_KOLKATA, KOLKATA)).toBe(
      "overdue",
    );
  });
});

describe("classifyDueAt - America/New_York (negative offset)", () => {
  it("keeps a task due 23:30 local in 'due today' although UTC is already tomorrow", () => {
    // "Now" is 23:00 on 12 Mar in New York, which is 03:00Z on 13 Mar.
    expect(zonedParts(NOW_NEW_YORK, NEW_YORK).day).toBe(12);
    expect(NOW_NEW_YORK.toISOString()).toContain("2026-03-13");

    // 23:30 EDT on 12 Mar = 03:30Z on 13 Mar; local midnight is 04:00Z.
    const due = new Date("2026-03-13T03:30:00Z");
    expect(classifyDueAt(due, NOW_NEW_YORK, NEW_YORK)).toBe("due_today");
  });

  it("calls a task due just after local midnight 'upcoming'", () => {
    // 00:30 EDT on 13 Mar = 04:30Z. Still the same UTC day as "now", so a
    // UTC-based boundary would wrongly report "due today".
    const due = new Date("2026-03-13T04:30:00Z");
    expect(classifyDueAt(due, NOW_NEW_YORK, NEW_YORK)).toBe("upcoming");
  });

  it("keeps a late-evening task 'due today' even when its UTC day is tomorrow", () => {
    // Now: 10:00 EDT on 13 Mar (14:00Z). Due: 22:00 EDT on 13 Mar, which is
    // 02:00Z on 14 Mar - a *different* UTC calendar day. Classified in UTC this
    // would read "upcoming"; in New York it is still today.
    const now = new Date("2026-03-13T14:00:00Z");
    const due = new Date("2026-03-14T02:00:00Z");
    expect(classifyDueAt(due, now, NEW_YORK)).toBe("due_today");
    // The same instants in Asia/Kolkata land on a different answer, which is
    // the whole point: the bucket depends on the workspace zone.
    expect(classifyDueAt(due, now, KOLKATA)).toBe("upcoming");
  });

  it("marks a passed instant overdue regardless of zone", () => {
    // 22:00 EDT on 12 Mar = 02:00Z on 13 Mar, one hour before "now".
    const due = new Date("2026-03-13T02:00:00Z");
    expect(classifyDueAt(due, NOW_NEW_YORK, NEW_YORK)).toBe("overdue");
    // "Passed" is an instant comparison, so every zone agrees.
    expect(classifyDueAt(due, NOW_NEW_YORK, KOLKATA)).toBe("overdue");
    expect(classifyDueAt(due, NOW_NEW_YORK, "UTC")).toBe("overdue");
  });
});

describe("classifyDueAt - missing and malformed due dates", () => {
  it("reports 'no_date' in every zone", () => {
    for (const zone of [KOLKATA, NEW_YORK, "UTC", "Australia/Sydney"]) {
      expect(classifyDueAt(null, NOW_KOLKATA, zone)).toBe("no_date");
      expect(classifyDueAt(undefined, NOW_KOLKATA, zone)).toBe("no_date");
      expect(classifyDueAt("", NOW_KOLKATA, zone)).toBe("no_date");
    }
  });

  it("treats an unparseable timestamp as 'no_date' rather than throwing", () => {
    // A corrupt column must not take down a list render.
    expect(classifyDueAt("not-a-date", NOW_KOLKATA, KOLKATA)).toBe("no_date");
    expect(classifyDueAt(new Date("nonsense"), NOW_KOLKATA, KOLKATA)).toBe(
      "no_date",
    );
  });

  it("accepts an ISO string and a Date interchangeably", () => {
    expect(classifyDueAt("2026-03-12T18:00:00Z", NOW_KOLKATA, KOLKATA)).toBe(
      classifyDueAt(new Date("2026-03-12T18:00:00Z"), NOW_KOLKATA, KOLKATA),
    );
  });
});

describe("taskBucket", () => {
  it("classifies from a task row's due_at", () => {
    expect(
      taskBucket({ due_at: "2026-03-12T18:00:00Z" }, NOW_KOLKATA, KOLKATA),
    ).toBe("due_today");
    expect(taskBucket({ due_at: null }, NOW_KOLKATA, KOLKATA)).toBe("no_date");
  });
});

describe("startOfZonedDay", () => {
  it("lands on local midnight for a positive-offset zone", () => {
    // 12 Mar 00:00 IST = 11 Mar 18:30Z (midnight minus 5h30).
    const start = startOfZonedDay(NOW_KOLKATA, KOLKATA);
    expect(start.toISOString()).toBe("2026-03-11T18:30:00.000Z");

    const parts = zonedParts(start, KOLKATA);
    expect(parts).toMatchObject({ year: 2026, month: 3, day: 12, hour: 0 });
    expect(parts.minute).toBe(0);
    expect(parts.second).toBe(0);
  });

  it("lands on local midnight for a negative-offset zone", () => {
    // 12 Mar 00:00 EDT = 12 Mar 04:00Z (midnight plus 4h).
    const start = startOfZonedDay(NOW_NEW_YORK, NEW_YORK);
    expect(start.toISOString()).toBe("2026-03-12T04:00:00.000Z");

    const parts = zonedParts(start, NEW_YORK);
    expect(parts).toMatchObject({ year: 2026, month: 3, day: 12, hour: 0 });
    expect(parts.minute).toBe(0);
  });

  it("uses the winter offset for a winter date in New York", () => {
    // 15 Jan 00:00 EST = 15 Jan 05:00Z (EST is UTC-5, not UTC-4).
    const start = startOfZonedDay(new Date("2026-01-15T18:00:00Z"), NEW_YORK);
    expect(start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("is midnight-in-UTC for the UTC zone", () => {
    expect(startOfZonedDay(NOW_KOLKATA, "UTC").toISOString()).toBe(
      "2026-03-12T00:00:00.000Z",
    );
  });

  it("is idempotent - the start of a day is its own day's start", () => {
    const start = startOfZonedDay(NOW_NEW_YORK, NEW_YORK);
    expect(startOfZonedDay(start, NEW_YORK).getTime()).toBe(start.getTime());
  });
});

describe("startOfNextZonedDay", () => {
  it("is exactly 24 hours later in a zone without DST", () => {
    const start = startOfZonedDay(NOW_KOLKATA, KOLKATA);
    const next = startOfNextZonedDay(NOW_KOLKATA, KOLKATA);
    expect(next.toISOString()).toBe("2026-03-12T18:30:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });

  it("produces a 23-hour day on the spring-forward date", () => {
    // 08 Mar 2026: US clocks jump 02:00 EST -> 03:00 EDT at 07:00Z.
    // Midnight 08 Mar is EST (05:00Z); midnight 09 Mar is EDT (04:00Z).
    const noon = new Date("2026-03-08T12:00:00Z");
    const start = startOfZonedDay(noon, NEW_YORK);
    const next = startOfNextZonedDay(noon, NEW_YORK);
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(next.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it("produces a 25-hour day on the fall-back date", () => {
    // 01 Nov 2026: clocks go 02:00 EDT -> 01:00 EST at 06:00Z.
    // Midnight 01 Nov is EDT (04:00Z); midnight 02 Nov is EST (05:00Z).
    const noon = new Date("2026-11-01T12:00:00Z");
    const start = startOfZonedDay(noon, NEW_YORK);
    const next = startOfNextZonedDay(noon, NEW_YORK);
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(next.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });
});

describe("zonedTimeToUtc", () => {
  it("resolves a wall-clock reading in a positive-offset zone", () => {
    // 12 Mar 23:30 IST = 18:00Z.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 3, day: 12, hour: 23, minute: 30 },
        KOLKATA,
      ).toISOString(),
    ).toBe("2026-03-12T18:00:00.000Z");
  });

  it("resolves a wall-clock reading in a negative-offset zone", () => {
    // 12 Mar 23:30 EDT = 13 Mar 03:30Z.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 3, day: 12, hour: 23, minute: 30 },
        NEW_YORK,
      ).toISOString(),
    ).toBe("2026-03-13T03:30:00.000Z");
  });

  it("defaults omitted time fields to midnight", () => {
    expect(
      zonedTimeToUtc({ year: 2026, month: 3, day: 12 }, KOLKATA).toISOString(),
    ).toBe("2026-03-11T18:30:00.000Z");
  });

  it("resolves a spring-forward gap time to the instant the clock jumps to", () => {
    // 08 Mar 2026 in New York: 02:00 EST becomes 03:00 EDT, so 02:00-02:59
    // local never happens. zonedTimeToUtc documents that such times "resolve to
    // the instant the clock jumps to", i.e. 03:00 EDT = 07:00Z.
    //
    // Anything earlier than 07:00Z is a wrong answer, because it lands *before*
    // the requested wall clock and aliases onto a real earlier time: a seller
    // who picks 02:00 gets a task due at 01:00, indistinguishable from having
    // picked 01:00.
    const oneAm = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 1, minute: 0 },
      NEW_YORK,
    );
    expect(oneAm.toISOString()).toBe("2026-03-08T06:00:00.000Z");

    const gap = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 0 },
      NEW_YORK,
    );
    // A skipped time must never collapse onto a real, different time.
    expect(gap.getTime()).not.toBe(oneAm.getTime());
    expect(gap.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(zonedParts(gap, NEW_YORK)).toMatchObject({ day: 8, hour: 3 });
  });

  it("resolves the ambiguous fall-back hour to a real instant on that day", () => {
    // 01 Nov 2026 01:30 in New York happens twice (once EDT, once EST). Either
    // is defensible; what matters is that it stays on 01 Nov locally.
    const instant = zonedTimeToUtc(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      NEW_YORK,
    );
    const parts = zonedParts(instant, NEW_YORK);
    expect(parts).toMatchObject({ month: 11, day: 1, hour: 1, minute: 30 });
  });
});

describe("resolveTimeZone / isValidTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone(KOLKATA)).toBe(true);
    expect(isValidTimeZone(NEW_YORK)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
  });

  it("rejects garbage, empty and nullish zones", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("not a timezone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  it("falls back to UTC rather than throwing inside a render", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe("UTC");
  });

  it("passes a valid zone through unchanged", () => {
    expect(resolveTimeZone(KOLKATA)).toBe(KOLKATA);
    expect(resolveTimeZone("UTC")).toBe("UTC");
  });

  it("classifies with the UTC fallback when the workspace zone is broken", () => {
    // A bad workspace row must still produce an answer, computed in UTC.
    // 00:30 IST on 13 Mar = 19:00Z on 12 Mar, which in UTC is still today.
    const due = new Date("2026-03-12T19:00:00Z");
    expect(classifyDueAt(due, NOW_KOLKATA, "Mars/Olympus_Mons")).toBe(
      classifyDueAt(due, NOW_KOLKATA, "UTC"),
    );
    expect(classifyDueAt(due, NOW_KOLKATA, "UTC")).toBe("due_today");
  });
});

/* -------------------------------------------------------------------------- */

/**
 * A fixture covering every bucket and every status, in Asia/Kolkata at
 * NOW_KOLKATA (12 Mar 2026 23:00 IST). Expected placement is spelled out per
 * row so the counts below are hand-derived, not read off the implementation.
 */
const TASKS: ClassifiableTask[] = [
  // overdue: 22:00 IST today, already gone at 23:00 IST.
  {
    due_at: "2026-03-12T16:30:00Z",
    status: "open",
    assigned_to: "user-a",
    priority: "high",
  },
  // overdue: months in the past, unassigned.
  {
    due_at: "2026-01-01T00:00:00Z",
    status: "open",
    assigned_to: null,
    priority: "low",
  },
  // due_today: 23:30 IST.
  {
    due_at: "2026-03-12T18:00:00Z",
    status: "open",
    assigned_to: "user-a",
    priority: "normal",
  },
  // due_today: 23:59 IST, the last minute of the local day.
  {
    due_at: "2026-03-12T18:29:00Z",
    status: "open",
    assigned_to: "user-b",
    priority: "high",
  },
  // upcoming: 00:30 IST tomorrow.
  {
    due_at: "2026-03-12T19:00:00Z",
    status: "open",
    assigned_to: "user-b",
    priority: "low",
  },
  // upcoming: next week.
  {
    due_at: "2026-03-20T06:00:00Z",
    status: "open",
    assigned_to: "user-a",
    priority: "normal",
  },
  // no_date.
  { due_at: null, status: "open", assigned_to: "user-b", priority: "normal" },
  // completed - belongs only to the Completed tab, despite having a due date.
  {
    due_at: "2026-03-12T18:00:00Z",
    status: "completed",
    assigned_to: "user-a",
    priority: "high",
  },
  // cancelled - belongs to no tab at all.
  {
    due_at: "2026-03-12T18:00:00Z",
    status: "cancelled",
    assigned_to: "user-a",
    priority: "high",
  },
];

describe("taskMatchesView", () => {
  it("puts a completed task only in the Completed tab", () => {
    const completed = TASKS[7];
    expect(taskMatchesView(completed, "completed", NOW_KOLKATA, KOLKATA)).toBe(
      true,
    );
    // Its due date says "today", but a finished follow-up is not outstanding.
    expect(taskMatchesView(completed, "due_today", NOW_KOLKATA, KOLKATA)).toBe(
      false,
    );
  });

  it("puts a cancelled task in no tab at all", () => {
    const cancelled = TASKS[8];
    for (const view of TASK_VIEWS) {
      expect(taskMatchesView(cancelled, view, NOW_KOLKATA, KOLKATA)).toBe(
        false,
      );
    }
  });

  it("places every non-cancelled task in exactly one tab", () => {
    for (const task of TASKS) {
      const hits = TASK_VIEWS.filter((view) =>
        taskMatchesView(task, view, NOW_KOLKATA, KOLKATA),
      );
      expect(hits.length).toBe(task.status === "cancelled" ? 0 : 1);
    }
  });
});

describe("countByView", () => {
  it("matches the counts derived by hand from the fixture", () => {
    const counts = countByView(TASKS, NOW_KOLKATA, KOLKATA);
    expect(counts).toEqual({
      overdue: 2, // 16:30Z today, and 01 Jan
      due_today: 2, // 18:00Z and 18:29Z
      upcoming: 2, // 19:00Z and 20 Mar
      no_date: 1,
      completed: 1,
    });
  });

  it("excludes cancelled tasks from every total", () => {
    const counts = countByView(TASKS, NOW_KOLKATA, KOLKATA);
    const total = TASK_VIEWS.reduce((sum, view) => sum + counts[view], 0);
    const cancelled = TASKS.filter((t) => t.status === "cancelled").length;
    expect(cancelled).toBe(1);
    expect(total).toBe(TASKS.length - cancelled);
  });

  it("shifts counts when the workspace zone changes", () => {
    // In UTC the day rolls over at 00:00Z, so the 12 Mar 18:00Z and 18:29Z
    // tasks are still "today", and so is the 19:00Z one that IST calls
    // tomorrow: due_today becomes 3 and upcoming drops to 1.
    const counts = countByView(TASKS, NOW_KOLKATA, "UTC");
    expect(counts.due_today).toBe(3);
    expect(counts.upcoming).toBe(1);
    expect(counts.overdue).toBe(2);
  });

  it("returns all zeros for an empty task list", () => {
    expect(countByView([], NOW_KOLKATA, KOLKATA)).toEqual({
      overdue: 0,
      due_today: 0,
      upcoming: 0,
      no_date: 0,
      completed: 0,
    });
  });
});

describe("filterTasks agrees with countByView", () => {
  it("returns exactly as many rows as the badge claims, for every view", () => {
    // The tab badge and the list are rendered from different calls; if they
    // ever disagree the user sees "Overdue (3)" above two rows.
    const counts = countByView(TASKS, NOW_KOLKATA, KOLKATA);
    for (const view of TASK_VIEWS) {
      const rows = filterTasks(TASKS, { view }, NOW_KOLKATA, KOLKATA);
      expect(rows.length).toBe(counts[view]);
    }
  });

  it("still agrees in a negative-offset zone", () => {
    const counts = countByView(TASKS, NOW_NEW_YORK, NEW_YORK);
    for (const view of TASK_VIEWS) {
      expect(filterTasks(TASKS, { view }, NOW_NEW_YORK, NEW_YORK).length).toBe(
        counts[view],
      );
    }
  });
});

describe("filterTasks - assignee and priority", () => {
  it("narrows to a single assignee", () => {
    // Overdue rows: 16:30Z (user-a) and 01 Jan (unassigned) -> 1 for user-a.
    const rows = filterTasks(
      TASKS,
      { view: "overdue", assignedTo: "user-a" },
      NOW_KOLKATA,
      KOLKATA,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].due_at).toBe("2026-03-12T16:30:00Z");
  });

  it("narrows to a single priority", () => {
    // Due today: 18:00Z (normal) and 18:29Z (high) -> 1 high.
    const rows = filterTasks(
      TASKS,
      { view: "due_today", priority: "high" },
      NOW_KOLKATA,
      KOLKATA,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].due_at).toBe("2026-03-12T18:29:00Z");
  });

  it("combines assignee and priority", () => {
    // Due today AND user-b AND high -> only the 18:29Z row.
    expect(
      filterTasks(
        TASKS,
        { view: "due_today", assignedTo: "user-b", priority: "high" },
        NOW_KOLKATA,
        KOLKATA,
      ),
    ).toHaveLength(1);
    // Due today AND user-a AND high -> none (user-a's today task is normal).
    expect(
      filterTasks(
        TASKS,
        { view: "due_today", assignedTo: "user-a", priority: "high" },
        NOW_KOLKATA,
        KOLKATA,
      ),
    ).toHaveLength(0);
  });

  it("treats a null assignee filter as 'everyone'", () => {
    const all = filterTasks(
      TASKS,
      { view: "overdue", assignedTo: null },
      NOW_KOLKATA,
      KOLKATA,
    );
    expect(all).toHaveLength(2);
  });
});

describe("taskViewWindow", () => {
  it("bounds 'due today' by now and the next local midnight", () => {
    const window = taskViewWindow("due_today", NOW_KOLKATA, KOLKATA);
    expect(window.status).toBe("open");
    expect(window.dueGte).toBe("2026-03-12T17:30:00.000Z"); // now
    expect(window.dueLt).toBe("2026-03-12T18:30:00.000Z"); // 00:00 IST 13 Mar
  });

  it("bounds 'overdue' at now and 'upcoming' at the next local midnight", () => {
    expect(taskViewWindow("overdue", NOW_KOLKATA, KOLKATA)).toEqual({
      status: "open",
      dueLt: "2026-03-12T17:30:00.000Z",
    });
    expect(taskViewWindow("upcoming", NOW_KOLKATA, KOLKATA)).toEqual({
      status: "open",
      dueGte: "2026-03-12T18:30:00.000Z",
    });
  });

  it("asks for null due dates and completed rows without a date window", () => {
    expect(taskViewWindow("no_date", NOW_KOLKATA, KOLKATA)).toEqual({
      status: "open",
      dueIsNull: true,
    });
    expect(taskViewWindow("completed", NOW_KOLKATA, KOLKATA)).toEqual({
      status: "completed",
    });
  });

  it("never disagrees with classifyDueAt about a task's bucket", () => {
    // The query fetches rows inside the window; the badge classifies them. If
    // the two used different boundaries a row would appear under the wrong tab.
    for (const view of ["overdue", "due_today", "upcoming"] as const) {
      const window = taskViewWindow(view, NOW_KOLKATA, KOLKATA);
      for (const task of TASKS) {
        if (task.status !== "open" || task.due_at === null) continue;
        const inWindow =
          (window.dueGte === undefined || task.due_at >= window.dueGte) &&
          (window.dueLt === undefined || task.due_at < window.dueLt);
        const classified =
          classifyDueAt(task.due_at, NOW_KOLKATA, KOLKATA) === view;
        expect(inWindow).toBe(classified);
      }
    }
  });
});

describe("toZonedInputValues / fromZonedInputValues", () => {
  it("splits an instant into the local date and time fields", () => {
    // 18:00Z on 12 Mar = 23:30 IST on 12 Mar.
    expect(
      toZonedInputValues(new Date("2026-03-12T18:00:00Z"), KOLKATA),
    ).toEqual({ date: "2026-03-12", time: "23:30" });

    // 03:00Z on 13 Mar = 23:00 EDT on 12 Mar - a different local *date*.
    expect(toZonedInputValues(NOW_NEW_YORK, NEW_YORK)).toEqual({
      date: "2026-03-12",
      time: "23:00",
    });
  });

  it("returns empty fields for no due date", () => {
    expect(toZonedInputValues(null, KOLKATA)).toEqual({ date: "", time: "" });
    expect(toZonedInputValues("", KOLKATA)).toEqual({ date: "", time: "" });
    expect(toZonedInputValues("garbage", KOLKATA)).toEqual({
      date: "",
      time: "",
    });
  });

  it("round-trips an instant back to the same instant", () => {
    // Whole minutes only, because the form fields carry no seconds.
    const cases: Array<[string, string]> = [
      ["2026-03-12T18:00:00.000Z", KOLKATA],
      ["2026-03-13T03:00:00.000Z", NEW_YORK],
      ["2026-01-15T18:00:00.000Z", NEW_YORK], // winter, UTC-5
      ["2026-06-30T09:45:00.000Z", "UTC"],
      ["2026-03-12T19:00:00.000Z", KOLKATA], // just past local midnight
    ];

    for (const [iso, zone] of cases) {
      const { date, time } = toZonedInputValues(new Date(iso), zone);
      const back = fromZonedInputValues(date, time, zone);
      expect(back).not.toBeNull();
      expect(back?.toISOString()).toBe(iso);
    }
  });

  it("defaults a date with no time to the end of that local day", () => {
    // "Follow up on Thursday" must stay in Due today all Thursday, so it lands
    // at 23:59 local, not 00:00. 23:59 IST on 12 Mar = 18:29Z.
    const instant = fromZonedInputValues("2026-03-12", "", KOLKATA);
    expect(instant?.toISOString()).toBe("2026-03-12T18:29:00.000Z");
    expect(classifyDueAt(instant, NOW_KOLKATA, KOLKATA)).toBe("due_today");

    // Same in New York: 23:59 EDT on 12 Mar = 03:59Z on 13 Mar.
    expect(
      fromZonedInputValues("2026-03-12", null, NEW_YORK)?.toISOString(),
    ).toBe("2026-03-13T03:59:00.000Z");
  });

  it("honours an explicit default time", () => {
    // 09:00 IST on 12 Mar = 03:30Z.
    expect(
      fromZonedInputValues("2026-03-12", "", KOLKATA, "09:00")?.toISOString(),
    ).toBe("2026-03-12T03:30:00.000Z");
  });

  it("accepts a seconds component", () => {
    // 23:30:45 IST = 18:00:45Z.
    expect(
      fromZonedInputValues("2026-03-12", "23:30:45", KOLKATA)?.toISOString(),
    ).toBe("2026-03-12T18:00:45.000Z");
  });

  it("returns null for a missing or malformed date", () => {
    expect(fromZonedInputValues("", "10:00", KOLKATA)).toBeNull();
    expect(fromZonedInputValues(null, "10:00", KOLKATA)).toBeNull();
    expect(fromZonedInputValues(undefined, "10:00", KOLKATA)).toBeNull();
    expect(fromZonedInputValues("12/03/2026", "10:00", KOLKATA)).toBeNull();
    expect(fromZonedInputValues("2026-3-12", "10:00", KOLKATA)).toBeNull();
  });

  it("returns null for a malformed or out-of-range time", () => {
    expect(fromZonedInputValues("2026-03-12", "24:00", KOLKATA)).toBeNull();
    expect(fromZonedInputValues("2026-03-12", "10:60", KOLKATA)).toBeNull();
    expect(fromZonedInputValues("2026-03-12", "10", KOLKATA)).toBeNull();
    expect(fromZonedInputValues("2026-03-12", "10:00 PM", KOLKATA)).toBeNull();
  });

  it("rejects a calendar date that does not exist", () => {
    // Date.UTC would silently roll 31 Feb forward into March; a task quietly
    // moving to another month is worse than a validation error.
    expect(fromZonedInputValues("2026-02-31", "10:00", KOLKATA)).toBeNull();
    expect(fromZonedInputValues("2026-04-31", "10:00", KOLKATA)).toBeNull();
    expect(fromZonedInputValues("2026-13-01", "10:00", KOLKATA)).toBeNull();
    // 2026 is not a leap year.
    expect(fromZonedInputValues("2026-02-29", "10:00", KOLKATA)).toBeNull();
    // ...but 2028 is.
    expect(
      fromZonedInputValues("2028-02-29", "10:00", KOLKATA)?.toISOString(),
    ).toBe("2028-02-29T04:30:00.000Z");
  });
});
