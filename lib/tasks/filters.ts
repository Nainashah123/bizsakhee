/**
 * Task date logic - pure functions only.
 *
 * Every "is this due today?" question is answered in the *workspace* timezone,
 * never in UTC and never in the server's local zone. A workspace in
 * Asia/Kolkata rolls over to a new day at 18:30 UTC; one in America/New_York
 * rolls over at 04:00 or 05:00 UTC depending on the season. Getting this wrong
 * silently moves half of a day's follow-ups into the wrong bucket, so the day
 * boundary is computed with `Intl.DateTimeFormat` against the named zone.
 *
 * Nothing here touches the database, the request or `Date.now()` - the caller
 * always supplies the reference instant, which is what makes it testable.
 */

import type {
  TaskPriority,
  TaskStatusEnum,
} from "@/lib/supabase/database.types";

/** Where a task sits relative to "now", once the day boundary is known. */
export type TaskDueBucket = "overdue" | "due_today" | "upcoming" | "no_date";

export const TASK_VIEWS = [
  "due_today",
  "overdue",
  "upcoming",
  "no_date",
  "completed",
] as const;

export type TaskView = (typeof TASK_VIEWS)[number];

export const DEFAULT_TASK_VIEW: TaskView = "due_today";

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  due_today: "Due today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  no_date: "No date",
  completed: "Completed",
};

export const TASK_BUCKET_LABELS: Record<TaskDueBucket, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  no_date: "No date",
};

export function isTaskView(value: unknown): value is TaskView {
  return (
    typeof value === "string" &&
    (TASK_VIEWS as readonly string[]).includes(value)
  );
}

const MS_PER_SECOND = 1_000;
const MS_PER_HOUR = 3_600_000;

/** Wall-clock fields as read in a specific zone. */
export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  // `hourCycle: "h23"` keeps midnight as 00 rather than the 24 that `hour12:
  // false` produces in some ICU builds - a one-hour classification bug.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Falls back to UTC for a missing or unrecognised zone so a bad workspace row
 * degrades to a defensible answer instead of throwing inside a render.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? (timeZone as string) : "UTC";
}

/** Parses any accepted timestamp shape, rejecting invalid dates. */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Date.UTC` remaps years 0-99 into the 1900s; this does not. */
function utcMsFromFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (year >= 0 && year < 100) {
    const corrected = new Date(ms);
    corrected.setUTCFullYear(year);
    return corrected.getTime();
  }
  return ms;
}

/** The wall-clock reading of `instant` in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(resolveTimeZone(timeZone)).formatToParts(instant);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds. Positive east
 * of Greenwich (Asia/Kolkata is +19_800_000). Derived from the formatted
 * wall-clock rather than a fixed table, so DST is handled by ICU.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = utcMsFromFields(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Formatted parts have second resolution; compare like with like.
  const flooredInstant =
    Math.floor(instant.getTime() / MS_PER_SECOND) * MS_PER_SECOND;
  return asUtc - flooredInstant;
}

/**
 * The instant at which the given wall-clock time occurs in `timeZone`.
 *
 * Two passes: guess with the offset that applies at the naive timestamp, then
 * re-read the offset at that guess. This corrects the hour either side of a DST
 * transition, where the first guess uses the wrong offset. Wall-clock times
 * skipped by a spring-forward resolve to the instant the clock jumps to.
 */
export function zonedTimeToUtc(
  fields: Partial<ZonedParts> & Pick<ZonedParts, "year" | "month" | "day">,
  timeZone: string,
): Date {
  const zone = resolveTimeZone(timeZone);
  const naive = utcMsFromFields(
    fields.year,
    fields.month,
    fields.day,
    fields.hour ?? 0,
    fields.minute ?? 0,
    fields.second ?? 0,
  );

  const guessOffset = zoneOffsetMs(new Date(naive), zone);
  let timestamp = naive - guessOffset;
  const actualOffset = zoneOffsetMs(new Date(timestamp), zone);
  if (actualOffset !== guessOffset) timestamp = naive - actualOffset;
  return new Date(timestamp);
}

/** Midnight that opens the calendar day `instant` falls on, in `timeZone`. */
export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const zone = resolveTimeZone(timeZone);
  const parts = zonedParts(instant, zone);
  return zonedTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day },
    zone,
  );
}

/**
 * Midnight that opens the *following* calendar day - i.e. the exclusive end of
 * today. Stepping 26 hours before snapping back keeps this correct across both
 * a 23-hour and a 25-hour DST day.
 */
export function startOfNextZonedDay(instant: Date, timeZone: string): Date {
  const zone = resolveTimeZone(timeZone);
  const start = startOfZonedDay(instant, zone);
  return startOfZonedDay(new Date(start.getTime() + 26 * MS_PER_HOUR), zone);
}

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, "0");
}

/** `YYYY-MM-DD` for the calendar day `instant` falls on in `timeZone`. */
export function zonedDayKey(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function isSameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  const zone = resolveTimeZone(timeZone);
  return zonedDayKey(a, zone) === zonedDayKey(b, zone);
}

/**
 * The bucket a due date belongs to.
 *
 * - `overdue`   - the instant has passed.
 * - `due_today` - still ahead, but before midnight in the workspace zone.
 * - `upcoming`  - midnight or later.
 *
 * "Passed" is an instant comparison and so zone-independent; "before midnight"
 * is not, which is the whole reason this module exists.
 */
export function classifyDueAt(
  dueAt: string | Date | null | undefined,
  now: Date,
  timeZone: string,
): TaskDueBucket {
  const due = toDate(dueAt);
  if (!due) return "no_date";

  if (due.getTime() < now.getTime()) return "overdue";

  const tomorrow = startOfNextZonedDay(now, timeZone);
  return due.getTime() < tomorrow.getTime() ? "due_today" : "upcoming";
}

/** The minimum shape needed to place a task in a view. */
export type ClassifiableTask = {
  due_at: string | null;
  status: TaskStatusEnum;
  assigned_to?: string | null;
  priority?: TaskPriority;
};

export function taskBucket(
  task: Pick<ClassifiableTask, "due_at">,
  now: Date,
  timeZone: string,
): TaskDueBucket {
  return classifyDueAt(task.due_at, now, timeZone);
}

/**
 * Whether a task belongs in a tab. Cancelled tasks appear in no view - they are
 * neither outstanding work nor a completed follow-up.
 */
export function taskMatchesView(
  task: ClassifiableTask,
  view: TaskView,
  now: Date,
  timeZone: string,
): boolean {
  if (view === "completed") return task.status === "completed";
  if (task.status !== "open") return false;
  return classifyDueAt(task.due_at, now, timeZone) === view;
}

export type TaskFilterOptions = {
  view: TaskView;
  /** A member's user id, or `null` for everyone. */
  assignedTo?: string | null;
  priority?: TaskPriority | null;
};

export function filterTasks<Task extends ClassifiableTask>(
  tasks: readonly Task[],
  options: TaskFilterOptions,
  now: Date,
  timeZone: string,
): Task[] {
  return tasks.filter((task) => {
    if (!taskMatchesView(task, options.view, now, timeZone)) return false;
    if (options.assignedTo && task.assigned_to !== options.assignedTo) {
      return false;
    }
    if (options.priority && task.priority !== options.priority) return false;
    return true;
  });
}

export function countByView(
  tasks: readonly ClassifiableTask[],
  now: Date,
  timeZone: string,
): Record<TaskView, number> {
  const counts = {
    due_today: 0,
    overdue: 0,
    upcoming: 0,
    no_date: 0,
    completed: 0,
  } satisfies Record<TaskView, number>;

  for (const task of tasks) {
    for (const view of TASK_VIEWS) {
      if (taskMatchesView(task, view, now, timeZone)) counts[view] += 1;
    }
  }
  return counts;
}

/**
 * The database-side bounds for a view, so a list query fetches only the rows a
 * view can contain instead of paging through everything. The same day boundary
 * feeds both this and `classifyDueAt`, so the query and the rendered badge can
 * never disagree.
 *
 * `dueLt` is exclusive, `dueGte` inclusive.
 */
export type TaskViewWindow = {
  status: TaskStatusEnum;
  dueGte?: string;
  dueLt?: string;
  dueIsNull?: boolean;
};

export function taskViewWindow(
  view: TaskView,
  now: Date,
  timeZone: string,
): TaskViewWindow {
  const nowIso = now.toISOString();
  const tomorrowIso = startOfNextZonedDay(now, timeZone).toISOString();

  switch (view) {
    case "overdue":
      return { status: "open", dueLt: nowIso };
    case "due_today":
      return { status: "open", dueGte: nowIso, dueLt: tomorrowIso };
    case "upcoming":
      return { status: "open", dueGte: tomorrowIso };
    case "no_date":
      return { status: "open", dueIsNull: true };
    case "completed":
      return { status: "completed" };
  }
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers - deterministic so server and client render the same.  */
/* -------------------------------------------------------------------------- */

/** Explicit locale: an implicit one differs between server and browser. */
const DISPLAY_LOCALE = "en-GB";

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();

function displayFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  cacheKey: string,
): Intl.DateTimeFormat {
  const key = `${timeZone}|${cacheKey}`;
  const cached = dateTimeCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    ...options,
    timeZone: resolveTimeZone(timeZone),
  });
  dateTimeCache.set(key, formatter);
  return formatter;
}

export function formatZonedTime(instant: Date, timeZone: string): string {
  return displayFormatter(
    timeZone,
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    "time",
  ).format(instant);
}

export function formatZonedDate(instant: Date, timeZone: string): string {
  return displayFormatter(
    timeZone,
    { day: "numeric", month: "short", year: "numeric" },
    "date",
  ).format(instant);
}

/**
 * A short human label: "Today 18:30", "Tomorrow 09:00", "12 Mar 2026 09:00".
 * Relative words are resolved against the workspace calendar, not UTC.
 */
export function formatDueLabel(
  dueAt: string | Date | null | undefined,
  now: Date,
  timeZone: string,
): string {
  const due = toDate(dueAt);
  if (!due) return "No date";

  const zone = resolveTimeZone(timeZone);
  const time = formatZonedTime(due, zone);
  const dueDay = zonedDayKey(due, zone);
  const today = zonedDayKey(now, zone);

  if (dueDay === today) return `Today ${time}`;

  const tomorrow = zonedDayKey(startOfNextZonedDay(now, zone), zone);
  if (dueDay === tomorrow) return `Tomorrow ${time}`;

  const yesterday = zonedDayKey(
    new Date(startOfZonedDay(now, zone).getTime() - 12 * MS_PER_HOUR),
    zone,
  );
  if (dueDay === yesterday) return `Yesterday ${time}`;

  return `${formatZonedDate(due, zone)} ${time}`;
}

/* -------------------------------------------------------------------------- */
/* Form <-> instant conversion, in the workspace zone.                         */
/* -------------------------------------------------------------------------- */

export type ZonedInputValues = { date: string; time: string };

/** Splits an instant into the `<input type="date">` / `type="time"` values. */
export function toZonedInputValues(
  instant: string | Date | null | undefined,
  timeZone: string,
): ZonedInputValues {
  const due = toDate(instant);
  if (!due) return { date: "", time: "" };
  const parts = zonedParts(due, resolveTimeZone(timeZone));
  return {
    date: `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_INPUT = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Turns the two form fields back into an instant, reading them as wall-clock
 * time in the workspace zone. An empty date means "no due date".
 *
 * A date with no time means the *end* of that day, not the start: "follow up on
 * Thursday" should stay in Due today all Thursday rather than turning overdue
 * the moment it is written.
 */
export function fromZonedInputValues(
  date: string | null | undefined,
  time: string | null | undefined,
  timeZone: string,
  defaultTime = "23:59",
): Date | null {
  const dateMatch = DATE_INPUT.exec((date ?? "").trim());
  if (!dateMatch) return null;

  const rawTime = (time ?? "").trim() || defaultTime;
  const timeMatch = TIME_INPUT.exec(rawTime);
  if (!timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const instant = zonedTimeToUtc(
    { year, month, day, hour, minute, second },
    timeZone,
  );

  // Rejects impossible calendar dates such as 2026-02-31, which `Date.UTC`
  // would otherwise silently roll forward into March.
  const roundTrip = zonedParts(instant, resolveTimeZone(timeZone));
  if (roundTrip.day !== day || roundTrip.month !== month) return null;

  return instant;
}
