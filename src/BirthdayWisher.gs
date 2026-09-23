/**
 * A reusable Google Apps Script to automatically send personalized birthday wishes.
 * The script reads names, email addresses, and dates of birth from a Google Sheet,
 * checks for birthdays matching the current date, and sends a custom email.
 */

// --- CONFIGURATION ---
// Edit the settings in this section to customize the script for your own use.
const CONFIG = {
  // The name of the sheet tab in your Google Sheet that contains the data.
  SHEET_NAME: "Volunteers", 

  // The name that will appear as the sender of the email.
  EMAIL_SENDER_NAME: "Your Team Name",

  // The subject line for the birthday email. Use {name} as a placeholder for the person's name.
  BIRTHDAY_EMAIL_SUBJECT: "Happy Birthday, {name}! 🎉",

  // The HTML body of the email. Use {name} as a placeholder.
  // You can use <p> for paragraphs, <b> for bold, etc.
  BIRTHDAY_EMAIL_BODY_HTML: `
    <p>Hi {name},</p>
    <p>The entire team at [Your Organization Name] is sending you our warmest wishes on your special day!</p>
    <p>We are so grateful to have you on our team. Your passion and hard work are a true inspiration, and your efforts make a real difference in everything we do.</p>
    <p>May the year ahead bring you immense personal growth and success.</p>
    <p>Celebrate big today!</p>
    <p>With our very best wishes,<br>
    The [Your Organization Name] Team</p>
  `
};
// --- END OF CONFIGURATION ---


/**
 * Main function that runs on a daily trigger.
 * It scans the sheet and sends birthday wishes.
 * @returns {void}
 */
function sendBirthdayWishes() {

  // Get today's date details based on the script's/spreadsheet's timezone.
  const today = new Date();
  const todayMonth = today.getMonth() + 1; // +1 because months are 0-indexed (Jan=0)
  const todayDay = today.getDate();

  // Open the spreadsheet and select the sheet using the name from our CONFIG.
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);

  // If the sheet doesn't exist, log an error and stop.
  if (!sheet) {
    console.error(`Error: Sheet named "${CONFIG.SHEET_NAME}" was not found. Please check the CONFIG settings.`);
    return;
  }
  
  // Get all data rows, starting from row 2 to skip headers.
  // Make sure your sheet has headers in row 1: FullName, Email, DOB
  const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3);
  const data = dataRange.getValues();

  // Loop through each volunteer.
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // Get details from the row.
    const name = row[0];
    const email = row[1];
    
    // Check for empty rows and skip them.
    if (!name || !email) {
      continue;
    }
    
    const dob = new Date(row[2]);

    // Check if the birthday matches today (ignoring year).
    if (dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDay) {

      // --- It's a match! Craft and send the personalized email. ---
      
      const subject = CONFIG.BIRTHDAY_EMAIL_SUBJECT.replace('{name}', name);
      const messageBody = CONFIG.BIRTHDAY_EMAIL_BODY_HTML.replace(/{name}/g, name);

      // Send the email.
      GmailApp.sendEmail(email, subject, "", {
          htmlBody: messageBody,
          name: CONFIG.EMAIL_SENDER_NAME
      });
      
      console.log(`Birthday email sent to ${name} at ${email}.`);
    }
  }
}
