// Copy to Secret.js and fill in. Secret.js is gitignored.

// Signs and verifies the QR payloads. Signing happens in the browser, so this
// value ships in the JS bundle and can be read by anyone with devtools.
// Changing it invalidates existing QR codes; it does not make forgery
// impossible. Treat it as obscurity, not security.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
export const secret = 'CHANGE_ME';

// Route for the station/helper admin page, e.g. 'helper' -> /helper
export const helperPath = 'helper';

// Shows the live formData panel under the admin form. Tied to NODE_ENV so it is
// on for `npm start` and automatically compiled out of production builds.
export const debug = process.env.NODE_ENV === 'development';
