// Runs src/BirthdayWisher.gs in a Node.js sandbox with fake versions of the
// Apps Script services it uses (SpreadsheetApp, MailApp, PropertiesService, ...).
// The script file itself is loaded unmodified.

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE_PATH = path.join(__dirname, "..", "src", "BirthdayWisher.gs");
const SOURCE = fs.readFileSync(SOURCE_PATH, "utf8");

// A zone that isn't UTC, so tests catch dates being read in the wrong zone.
// It is UTC+6 for every date used below (avoid pre-1971 dates and 2009, when
// the historical offset differed).
const TIME_ZONE = "Asia/Dhaka";
const HEADER = ["FullName", "Email", "DOB"];

/** Utilities.formatDate() stand-in. Supports the one pattern the script uses. */
function formatDate(date, timeZone, pattern) {
  assert.equal(pattern, "yyyy-MM-dd");
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .forEach(part => { parts[part.type] = part.value; });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A Date for local midnight in TIME_ZONE, which is how Sheets returns date cells. */
function dateCell(isoDate) {
  return new Date(`${isoDate}T00:00:00+06:00`);
}

/** 9:00 AM in TIME_ZONE on the given day, a typical trigger run time. */
function morningOf(isoDate) {
  return new Date(`${isoDate}T09:00:00+06:00`);
}

/** Objects created inside the sandbox have a different prototype, so compare them as plain data. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Loads the script into a fresh sandbox.
 * @param {Object} [options]
 * @param {Array<Array<*>>} [options.rows] Sheet contents, including the header row.
 * @param {number} [options.quota] Emails left in the daily quota.
 * @param {Function} [options.onSend] Called for every email; throw from it to simulate a failure.
 */
function loadScript({ rows = [HEADER], quota = 100, onSend = () => {} } = {}) {
  const sentEmails = [];
  const logs = [];
  const properties = new Map();
  const triggers = [];
  const createdTriggers = [];

  const sheet = { getDataRange: () => ({ getValues: () => rows }) };
  const spreadsheet = {
    getSheetByName: name => (name === "Volunteers" ? sheet : null),
    getSpreadsheetTimeZone: () => TIME_ZONE
  };

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    MailApp: {
      getRemainingDailyQuota: () => quota - sentEmails.length,
      sendEmail: message => {
        onSend(message);
        sentEmails.push(plain(message));
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (properties.has(key) ? properties.get(key) : null),
        setProperty: (key, value) => { properties.set(key, String(value)); }
      })
    },
    Utilities: { formatDate },
    Session: { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: handler => {
        const settings = { handler };
        const builder = {
          timeBased: () => builder,
          everyDays: days => { settings.everyDays = days; return builder; },
          atHour: hour => { settings.atHour = hour; return builder; },
          inTimezone: timeZone => { settings.timeZone = timeZone; return builder; },
          create: () => {
            createdTriggers.push(settings);
            triggers.push({ getHandlerFunction: () => handler });
          }
        };
        return builder;
      }
    },
    console: {
      log: message => logs.push(message),
      warn: message => logs.push(message),
      error: message => logs.push(message)
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: SOURCE_PATH });

  return {
    script: sandbox,
    config: vm.runInContext("CONFIG", sandbox),
    sentEmails,
    logs,
    properties,
    triggers,
    createdTriggers
  };
}

describe("parseBirthday_", () => {
  const { script } = loadScript();
  const parse = value => plain(script.parseBirthday_(value, TIME_ZONE));

  test("reads date cells in the spreadsheet's time zone", () => {
    // Midnight on March 15 in Dhaka is still March 14 in UTC. Reading the
    // date in the wrong zone would wish this person a day early.
    const cell = dateCell("1999-03-15");
    assert.equal(cell.getUTCDate(), 14);
    assert.deepEqual(parse(cell), { month: 3, day: 15 });
  });

  test("accepts MM/DD/YYYY, MM/DD and YYYY-MM-DD text", () => {
    assert.deepEqual(parse("03/15/1999"), { month: 3, day: 15 });
    assert.deepEqual(parse("3/5/99"), { month: 3, day: 5 });
    assert.deepEqual(parse("12/25"), { month: 12, day: 25 });
    assert.deepEqual(parse(" 1999-03-15 "), { month: 3, day: 15 });
  });

  test("accepts Feb 29", () => {
    assert.deepEqual(parse("02/29/2000"), { month: 2, day: 29 });
  });

  test("rejects values that are not real dates", () => {
    for (const value of ["", "not a date", "13/01/2000", "02/30/2000", "04/31", "00/10", new Date("invalid")]) {
      assert.equal(script.parseBirthday_(value, TIME_ZONE), null, `expected ${String(value)} to be rejected`);
    }
  });
});

describe("isBirthdayOn_", () => {
  const { script } = loadScript();

  test("matches on month and day, ignoring the year", () => {
    assert.equal(script.isBirthdayOn_({ month: 3, day: 15 }, { year: 2026, month: 3, day: 15 }), true);
    assert.equal(script.isBirthdayOn_({ month: 3, day: 15 }, { year: 2026, month: 3, day: 16 }), false);
    assert.equal(script.isBirthdayOn_({ month: 3, day: 15 }, { year: 2026, month: 4, day: 15 }), false);
  });

  test("celebrates Feb 29 birthdays on Feb 28 in non-leap years", () => {
    const leapDay = { month: 2, day: 29 };
    assert.equal(script.isBirthdayOn_(leapDay, { year: 2027, month: 2, day: 28 }), true);
    assert.equal(script.isBirthdayOn_(leapDay, { year: 2100, month: 2, day: 28 }), true); // 2100 is not a leap year
    assert.equal(script.isBirthdayOn_(leapDay, { year: 2028, month: 2, day: 28 }), false);
    assert.equal(script.isBirthdayOn_(leapDay, { year: 2028, month: 2, day: 29 }), true);
  });
});

describe("fillTemplate_", () => {
  const { script } = loadScript();
  const person = { name: "Ada Lovelace", firstName: "Ada" };

  test("replaces every placeholder", () => {
    assert.equal(
      script.fillTemplate_("{firstName}! Happy birthday, {name}. Again: {firstName}", person, false),
      "Ada! Happy birthday, Ada Lovelace. Again: Ada"
    );
  });

  test("escapes names in HTML templates but not in plain text", () => {
    const tricky = { name: "<b>Tom</b> & Jerry", firstName: "<b>Tom</b>" };
    assert.equal(script.fillTemplate_("<p>{name}</p>", tricky, true), "<p>&lt;b&gt;Tom&lt;/b&gt; &amp; Jerry</p>");
    assert.equal(script.fillTemplate_("Hi {firstName}", tricky, false), "Hi <b>Tom</b>");
  });

  test("leaves unknown placeholders alone", () => {
    assert.equal(script.fillTemplate_("Hi {nickname}", person, false), "Hi {nickname}");
  });
});

describe("findColumns_", () => {
  const { script, config } = loadScript();

  test("finds columns in any order, ignoring case, spaces and extra columns", () => {
    const columns = script.findColumns_(["Team", " dob ", "EMAIL", "fullname"], config.COLUMNS);
    assert.deepEqual(plain(columns), { NAME: 3, EMAIL: 2, DOB: 1 });
  });

  test("names the missing columns in its error", () => {
    assert.throws(() => script.findColumns_(["FullName", "Birthday"], config.COLUMNS), /missing the column\(s\): Email, DOB/);
  });
});

describe("runBirthdayCheck_", () => {
  const rows = [
    HEADER,
    ["Maya Rahman", "maya@example.com", dateCell("1998-09-23")],
    ["Leo Martins", "leo@example.com", dateCell("2001-06-23")],
    ["Nadia Islam", "nadia@example.com", "09/23"],
    ["", "", ""],
    ["No Email", "", "09/23/2000"],
    ["Bad Date", "bad@example.com", "sometime in spring"]
  ];
  const birthdayMorning = morningOf("2026-09-23");

  test("emails only the people whose birthday is today", () => {
    const { script, sentEmails } = loadScript({ rows });
    const summary = plain(script.runBirthdayCheck_(birthdayMorning));

    assert.deepEqual(summary.sent, ["maya@example.com", "nadia@example.com"]);
    assert.deepEqual(sentEmails.map(email => email.to), ["maya@example.com", "nadia@example.com"]);
  });

  test("personalizes the subject and body and sets the sender name", () => {
    const { script, sentEmails } = loadScript({ rows });
    script.runBirthdayCheck_(birthdayMorning);

    const [email] = sentEmails;
    assert.equal(email.subject, "Happy Birthday, Maya! 🎉");
    assert.match(email.htmlBody, /<p>Hi Maya,<\/p>/);
    assert.equal(email.name, "Your Team Name");
  });

  test("skips blank rows silently and logs invalid ones", () => {
    const { script, logs } = loadScript({ rows });
    const summary = plain(script.runBirthdayCheck_(birthdayMorning));

    assert.deepEqual(summary.invalidRows, [6, 7]);
    assert.ok(logs.includes("Row 6 skipped: email is empty."));
    assert.ok(logs.includes('Row 7 skipped: could not read the date of birth "sometime in spring".'));
  });

  test("does not email anyone twice when run again on the same day", () => {
    const { script, sentEmails } = loadScript({ rows });
    script.runBirthdayCheck_(birthdayMorning);
    const secondRun = plain(script.runBirthdayCheck_(morningOf("2026-09-23")));

    assert.equal(sentEmails.length, 2);
    assert.deepEqual(secondRun.sent, []);
  });

  test("sends again on the same birthday next year", () => {
    const { script, sentEmails } = loadScript({ rows });
    script.runBirthdayCheck_(birthdayMorning);
    script.runBirthdayCheck_(morningOf("2027-09-23"));

    assert.equal(sentEmails.length, 4);
  });

  test("sends nothing in dry-run mode", () => {
    const { script, config, sentEmails, logs } = loadScript({ rows });
    config.DRY_RUN = true;
    script.runBirthdayCheck_(birthdayMorning);

    assert.equal(sentEmails.length, 0);
    assert.ok(logs.includes("[Dry run] Would send a birthday email to Maya Rahman <maya@example.com>."));
  });

  test("handles a sheet that only has a header row", () => {
    const { script, sentEmails } = loadScript({ rows: [HEADER] });
    assert.deepEqual(plain(script.runBirthdayCheck_(birthdayMorning)), { sent: [], failed: [], invalidRows: [] });
    assert.equal(sentEmails.length, 0);
  });

  test("throws a clear error when the sheet tab is missing", () => {
    const { script, config } = loadScript({ rows });
    config.SHEET_NAME = "Members";
    assert.throws(() => script.runBirthdayCheck_(birthdayMorning), /Sheet named "Members" was not found/);
  });

  test("keeps sending after one failure, then throws so the owner is notified", () => {
    const onSend = message => {
      if (message.to === "maya@example.com") throw new Error("Invalid email: maya@example.com");
    };
    const { script, sentEmails, logs } = loadScript({ rows, onSend });

    assert.throws(() => script.runBirthdayCheck_(birthdayMorning), /1 birthday email\(s\) failed to send: maya@example.com/);
    assert.deepEqual(sentEmails.map(email => email.to), ["nadia@example.com"]);
    assert.ok(logs.some(line => line.startsWith("Could not send a birthday email to Maya Rahman")));
  });

  test("retries a failed email on the next run the same day", () => {
    let failNext = true;
    const onSend = () => {
      if (failNext) { failNext = false; throw new Error("Service unavailable"); }
    };
    const { script, sentEmails } = loadScript({ rows, onSend });

    assert.throws(() => script.runBirthdayCheck_(birthdayMorning));
    script.runBirthdayCheck_(birthdayMorning);
    assert.deepEqual(sentEmails.map(email => email.to), ["nadia@example.com", "maya@example.com"]);
  });

  test("stops sending when the daily email quota runs out", () => {
    const { script, sentEmails } = loadScript({ rows, quota: 1 });

    assert.throws(() => script.runBirthdayCheck_(birthdayMorning), /failed to send: nadia@example.com/);
    assert.equal(sentEmails.length, 1);
  });
});

describe("installDailyTrigger", () => {
  test("creates one daily trigger, replacing any earlier one", () => {
    const { script, triggers, createdTriggers } = loadScript();
    script.installDailyTrigger();
    script.installDailyTrigger();

    assert.equal(triggers.length, 1);
    assert.deepEqual(createdTriggers[1], {
      handler: "sendBirthdayWishes",
      everyDays: 1,
      atHour: 8,
      timeZone: TIME_ZONE
    });
  });
});

describe("sendTestEmail", () => {
  test("sends a clearly marked preview to the script owner", () => {
    const { script, sentEmails } = loadScript();
    script.sendTestEmail();

    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "owner@example.com");
    assert.equal(sentEmails[0].subject, "[Test] Happy Birthday, Alex! 🎉");
  });
});
