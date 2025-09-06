# Automated Birthday Wishes - Google Apps Script

A simple, zero-maintenance Google Apps Script to automatically send personalized birthday wishes to team members, colleagues, or volunteers using data from a Google Sheet.

This project was created to ensure that no team member's special day is ever missed, fostering a positive and caring team culture.

---

## 👥 Authors & Acknowledgements

This project was co-developed by:

*   **Sandip Kumar Paul** - [sandipkumarpaul](https://github.com/sandipkumarpaul)
*   **Tanjila Afsari Rubina** - [tanjilaafsarirubina](https://github.com/tanjilaafsarirubina)

This was a joint effort in conceptualizing, developing, and refining the automation script.

---

## ✨ Features

*   **Fully Automated:** Runs on a daily trigger, checks for birthdays, and sends emails without any manual intervention.
*   **Personalized Emails:** Automatically inserts the recipient's name into the email subject and body for a personal touch.
*   **Dynamic & Scalable:** The script automatically adapts to the number of volunteers in the sheet. Just add or remove rows—no code changes needed!
*   **Zero Cost:** Built entirely on the free tiers of Google Sheets, Apps Script, and Gmail.
*   **Privacy-Focused:** The entire system runs within your private Google account, and the source sheet does not need to be made public.

---

## 🚀 How to Use

1.  **Create a Google Sheet:** Set up a new sheet with three columns with the exact headers: `FullName`, `Email`, and `DOB` (in MM/DD/YYYY format).

2.  **Add the Script:**
    *   Open the sheet and go to `Extensions` > `Apps Script`.
    *   Copy the code from the `BirthdayWisher.gs` file in this repository and paste it into the script editor.

3.  **Customize the Email:**
    *   Inside the code, find the `subject` and `messageBody` variables and edit them with your own personalized message.

4.  **Set Up the Trigger:**
    *   In the Apps Script editor, go to the "Triggers" (alarm clock) section.
    *   Create a new trigger for the `sendBirthdayWishes` function.
    *   Configure the trigger to be `Time-driven` and run on a `Day timer` (e.g., every morning between 8am and 9am).

5.  **Authorize Permissions:**
    *   Run the script once manually or save the trigger to initiate the authorization prompt from Google. You must allow the script to access your sheets and send email on your behalf.

---

## 🛠️ Technologies Used

*   Google Apps Script (JavaScript)
*   Google Sheets
*   Gmail API
