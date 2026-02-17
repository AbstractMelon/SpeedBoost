# SpeedBoost

Browser extension for Chrome and Firefox that automatically pings Boost when you open a Canvas course URL.

## What it does

When you visit a Canvas course URL such as:

`https://canyongrove.instructure.com/courses/1022`

the extension will:

1. Extract the Canvas course ID (`1022`)
2. Request your course list from:
   `https://boost.lifted-management.com/api/Canvas/courses/`
3. Find the matching course name for that ID
4. Send a GET request to:
   `https://boost.lifted-management.com/courses?course=${courseName}`

This extension only runs on `https://canyongrove.instructure.com/courses/*`.

## Setup

### Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder (`SpeedBoost`)

### Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `manifest.json` in this project folder (`SpeedBoost`)

## Using the Extension
   - your Bearer token for the Boost API
7. Save

## Popup features

- Click the extension icon to open a small popup panel.
- You can edit and save email/token there.
- It shows the latest attempt status:
   - success/failure
   - timestamp
   - course name/ID or error message