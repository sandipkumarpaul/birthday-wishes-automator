/**
 * @OnlyCurrentDoc
 *
 * Birthday Wishes Automator
 *
 * Reads names, email addresses and dates of birth from a Google Sheet and sends
 * a personalized birthday email to everyone whose birthday is today.
 *
 * Functions you can run from the Apps Script editor:
 *   sendBirthdayWishes()  - the daily job; this is what the trigger calls
 *   installDailyTrigger() - one-time setup that schedules sendBirthdayWishes() every day
 *   sendTestEmail()       - sends a preview of the birthday email to yourself
 *
 * Functions whose names end in "_" are internal helpers. Apps Script hides them
 * from the Run menu.
 */

// --- CONFIGURATION ---
// Edit the settings in this section to customize the script for your own use.
const CONFIG = {
  // The name of the sheet tab in your Google Sheet that contains the data.
  SHEET_NAME: "Volunteers",

  // The column headers in row 1. Columns can be in any order, and extra columns are ignored.
  COLUMNS: {
    NAME: "FullName",
    EMAIL: "Email",
    DOB: "DOB"
  },

  // The name that will appear as the sender of the email.
  EMAIL_SENDER_NAME: "Your Team Name",

  // The subject line for the birthday email.
  // Placeholders: {name} is the full name, {firstName} is the first word of the name.
  BIRTHDAY_EMAIL_SUBJECT: "Happy Birthday, {firstName}! 🎉",

  // The HTML body of the email. The same placeholders work here.
  // You can use <p> for paragraphs, <b> for bold, etc.
  BIRTHDAY_EMAIL_BODY_HTML: `
    <p>Hi {firstName},</p>
    <p>The entire team at [Your Organization Name] is sending you our warmest wishes on your special day!</p>
    <p>We are so grateful to have you on our team. Your passion and hard work are a true inspiration, and your efforts make a real difference in everything we do.</p>
    <p>May the year ahead bring you immense personal growth and success.</p>
    <p>Celebrate big today!</p>
    <p>With our very best wishes,<br>
    The [Your Organization Name] Team</p>
  `,

  // The hour of the day (0-23, in the spreadsheet's time zone) at which
  // installDailyTrigger() schedules the daily run.
  TRIGGER_HOUR: 8,

  // When true, the script only logs who would get an email and sends nothing.
  // Useful for checking your sheet before going live.
  DRY_RUN: false
};
// --- END OF CONFIGURATION ---


const SENT_LOG_KEY = "SENT_LOG";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];


/**
 * Main function that runs on a daily trigger.
 * It scans the sheet and sends birthday wishes.
 * @returns {void}
 */
function sendBirthdayWishes() {
  runBirthdayCheck_(new Date());
}

/**
 * Creates the daily time-driven trigger for sendBirthdayWishes().
 * Safe to run more than once: any existing trigger for it is replaced.
 * @returns {void}
 */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "sendBirthdayWishes")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  ScriptApp.newTrigger("sendBirthdayWishes")
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .inTimezone(timeZone)
    .create();

  console.log(`Daily trigger installed: sendBirthdayWishes will run between ` +
    `${CONFIG.TRIGGER_HOUR}:00 and ${CONFIG.TRIGGER_HOUR + 1}:00 (${timeZone}).`);
}

/**
 * Sends a preview of the birthday email to your own address, so you can
 * check the wording and formatting before anyone else receives it.
 * @returns {void}
 */
function sendTestEmail() {
  const me = Session.getEffectiveUser().getEmail();
  if (!me) {
    throw new Error("Could not determine your email address. Run this function from the Apps Script editor.");
  }
  sendBirthdayEmail_({ name: "Alex Example", firstName: "Alex", email: me }, "[Test] ");
  console.log(`Test email sent to ${me}.`);
}


/**
 * Does the actual work of sendBirthdayWishes(). It takes the current date as
 * a parameter so the logic can be tested against any day of the year.
 * @param {Date} now The moment to treat as "now".
 * @returns {{sent: string[], failed: string[], invalidRows: number[]}} What happened on this run.
 */
function runBirthdayCheck_(now) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

  // Throwing (instead of just logging) means Google emails the script owner a
  // failure notice, so a misconfigured sheet can't silently stop all emails.
  if (!sheet) {
    throw new Error(`Sheet named "${CONFIG.SHEET_NAME}" was not found. Please check CONFIG.SHEET_NAME.`);
  }

  // Both "today" and the DOB cells are read in the spreadsheet's time zone.
  // Mixing zones could shift a birthday by a day.
  const timeZone = spreadsheet.getSpreadsheetTimeZone();
  const today = toCalendarDate_(now, timeZone);
  const summary = { sent: [], failed: [], invalidRows: [] };

  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    console.log(`No data rows found in "${CONFIG.SHEET_NAME}". Nothing to do.`);
    return summary;
  }

  const columns = findColumns_(rows[0], CONFIG.COLUMNS);
  const sentLog = loadSentLog_(today.key);

  // Row 0 is the header, so the data starts at index 1 (sheet row 2).
  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const person = readPerson_(rows[i], columns, timeZone);

    // Completely empty rows are skipped silently.
    if (!person) {
      continue;
    }
    if (person.error) {
      console.warn(`Row ${rowNumber} skipped: ${person.error}.`);
      summary.invalidRows.push(rowNumber);
      continue;
    }
    if (!isBirthdayOn_(person.birthday, today)) {
      continue;
    }

    // The send log makes re-running the script on the same day safe.
    const logKey = person.email.toLowerCase();
    if (sentLog.emails.indexOf(logKey) !== -1) {
      console.log(`Already wished ${person.name} today. Skipping.`);
      continue;
    }

    if (CONFIG.DRY_RUN) {
      console.log(`[Dry run] Would send a birthday email to ${person.name} <${person.email}>.`);
      continue;
    }

    // One failed email shouldn't stop everyone else from getting theirs.
    try {
      sendBirthdayEmail_(person);
      sentLog.emails.push(logKey);
      saveSentLog_(sentLog);
      summary.sent.push(person.email);
      console.log(`Birthday email sent to ${person.name} at ${person.email}.`);
    } catch (err) {
      summary.failed.push(person.email);
      console.error(`Could not send a birthday email to ${person.name} at ${person.email}: ${err.message}`);
    }
  }

  console.log(`Finished: ${summary.sent.length} sent, ${summary.failed.length} failed, ` +
    `${summary.invalidRows.length} invalid row(s).`);

  if (summary.failed.length > 0) {
    throw new Error(`${summary.failed.length} birthday email(s) failed to send: ${summary.failed.join(", ")}`);
  }
  return summary;
}

/**
 * Personalizes the email for one person and sends it.
 * @param {{name: string, firstName: string, email: string}} person
 * @param {string} [subjectPrefix] Text to put in front of the subject, e.g. "[Test] ".
 * @returns {void}
 */
function sendBirthdayEmail_(person, subjectPrefix) {
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error("the daily email quota for this Google account has been used up");
  }
  MailApp.sendEmail({
    to: person.email,
    subject: (subjectPrefix || "") + fillTemplate_(CONFIG.BIRTHDAY_EMAIL_SUBJECT, person, false),
    htmlBody: fillTemplate_(CONFIG.BIRTHDAY_EMAIL_BODY_HTML, person, true),
    name: CONFIG.EMAIL_SENDER_NAME
  });
}

/**
 * Finds the index of each configured column by its header text.
 * Matching ignores case and surrounding spaces.
 * @param {Array<*>} headerRow The values in row 1.
 * @param {Object<string, string>} columnNames e.g. {NAME: "FullName", ...}
 * @returns {Object<string, number>} e.g. {NAME: 0, EMAIL: 1, DOB: 2}
 */
function findColumns_(headerRow, columnNames) {
  const headers = headerRow.map(header => String(header).trim().toLowerCase());
  const columns = {};
  const missing = [];

  Object.keys(columnNames).forEach(key => {
    const index = headers.indexOf(columnNames[key].toLowerCase());
    if (index === -1) {
      missing.push(columnNames[key]);
    } else {
      columns[key] = index;
    }
  });

  if (missing.length > 0) {
    throw new Error(`Row 1 of "${CONFIG.SHEET_NAME}" is missing the column(s): ${missing.join(", ")}. ` +
      `Found: ${headerRow.join(", ")}.`);
  }
  return columns;
}

/**
 * Reads one sheet row into a person object.
 * @param {Array<*>} row The values in one sheet row.
 * @param {Object<string, number>} columns Column indexes from findColumns_().
 * @param {string} timeZone The spreadsheet's time zone.
 * @returns {?Object} null for an empty row, {error} for an invalid row,
 *     otherwise {name, firstName, email, birthday}.
 */
function readPerson_(row, columns, timeZone) {
  const name = String(row[columns.NAME]).trim();
  const email = String(row[columns.EMAIL]).trim();
  const dob = row[columns.DOB];

  if (!name && !email && String(dob).trim() === "") {
    return null;
  }
  if (!name) {
    return { error: "name is empty" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: email ? `"${email}" is not a valid email address` : "email is empty" };
  }

  const birthday = parseBirthday_(dob, timeZone);
  if (!birthday) {
    return { error: `could not read the date of birth "${dob}"` };
  }
  return { name: name, firstName: name.split(/\s+/)[0], email: email, birthday: birthday };
}

/**
 * Extracts the month and day of a birthday from a DOB cell. The cell can be a
 * real date cell or text in MM/DD/YYYY, MM/DD (no year) or YYYY-MM-DD form.
 * @param {*} value The cell value.
 * @param {string} timeZone The spreadsheet's time zone, used for date cells.
 * @returns {?{month: number, day: number}} null if the value isn't a valid date.
 */
function parseBirthday_(value, timeZone) {
  // Sheets returns date cells as Date objects. This check (rather than
  // instanceof) also works for Dates created in another JavaScript realm.
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) {
      return null;
    }
    const date = toCalendarDate_(value, timeZone);
    return { month: date.month, day: date.day };
  }

  const text = String(value).trim();
  let month;
  let day;
  let match = text.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2}|\d{4}))?$/);
  if (match) {
    month = Number(match[1]);
    day = Number(match[2]);
  } else if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    return null;
  }

  const isValid = month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
  return isValid ? { month: month, day: day } : null;
}

/**
 * Checks whether a birthday falls on the given date. People born on Feb 29
 * are celebrated on Feb 28 in years that aren't leap years.
 * @param {{month: number, day: number}} birthday
 * @param {{year: number, month: number, day: number}} date
 * @returns {boolean}
 */
function isBirthdayOn_(birthday, date) {
  if (birthday.month === date.month && birthday.day === date.day) {
    return true;
  }
  const isLeapDayBirthday = birthday.month === 2 && birthday.day === 29;
  return isLeapDayBirthday && date.month === 2 && date.day === 28 && !isLeapYear_(date.year);
}

/**
 * @param {number} year
 * @returns {boolean}
 */
function isLeapYear_(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Converts a moment in time to a calendar date in the given time zone.
 * @param {Date} date
 * @param {string} timeZone e.g. "Asia/Dhaka"
 * @returns {{year: number, month: number, day: number, key: string}} key is "yyyy-MM-dd".
 */
function toCalendarDate_(date, timeZone) {
  const key = Utilities.formatDate(date, timeZone, "yyyy-MM-dd");
  const parts = key.split("-").map(Number);
  return { year: parts[0], month: parts[1], day: parts[2], key: key };
}

/**
 * Replaces {name} and {firstName} in a template. Values are HTML-escaped when
 * the template is HTML, so a name like "<b>Sam</b>" can't inject markup.
 * @param {string} template
 * @param {{name: string, firstName: string}} person
 * @param {boolean} isHtml
 * @returns {string}
 */
function fillTemplate_(template, person, isHtml) {
  return template.replace(/\{(name|firstName)\}/g, (placeholder, key) =>
    isHtml ? escapeHtml_(person[key]) : person[key]);
}

/**
 * @param {string} text
 * @returns {string} The text with HTML special characters escaped.
 */
function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Loads the list of addresses already emailed today. The log only ever holds
 * one day, so it resets itself on the first run of each new day.
 * @param {string} dateKey Today's date as "yyyy-MM-dd".
 * @returns {{date: string, emails: string[]}}
 */
function loadSentLog_(dateKey) {
  const saved = PropertiesService.getScriptProperties().getProperty(SENT_LOG_KEY);
  const log = saved ? JSON.parse(saved) : null;
  return log && log.date === dateKey ? log : { date: dateKey, emails: [] };
}

/**
 * @param {{date: string, emails: string[]}} log
 * @returns {void}
 */
function saveSentLog_(log) {
  PropertiesService.getScriptProperties().setProperty(SENT_LOG_KEY, JSON.stringify(log));
}
