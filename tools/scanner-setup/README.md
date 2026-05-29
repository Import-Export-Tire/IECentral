# tools/scanner-setup — DEPRECATED

This Node CLI is **deprecated** as of 2026-05-29. Use the web-based Scanner Setup Wizard in IECentral instead:

> Equipment → Scanner Manager → "Setup New Scanner" button

The wizard does the same work (detect device → install APKs → push RT config → grant permissions → activate Device Admin → register in IECentral) entirely in the browser via WebUSB. No local install, no Terminal, no `npm install`.

This CLI is kept in the repo for one more release for emergency manual use (Bluetooth setup, custom flashing scenarios) but will be removed in a follow-up PR once the web wizard has been used in production for a few weeks without issues.
