# Fair Tax Portal – Android app

A small Android wrapper around the portal website with phone notifications.

* The app opens https://asifkhan170920.github.io/audit-desk/ – website updates reach the app automatically.
* Reminders (leads, client check-ins, meetings, VAT / Corporate Tax / financial statements / audit / bookkeeping deadlines,
  contract expiry, post-dated cheques, missing client details, overdue invoices) are scheduled on the phone and fire
  even when the app is closed. Opening the app refreshes them.
* The admin signs in with Google on the phone; staff sign in with their user ID and password.

## Build
GitHub builds the app automatically (Actions → "Build Android app") whenever this folder changes, or on demand with
"Run workflow". The APK is published at:
https://github.com/AsifKhan170920/audit-desk/releases/latest/download/FairTaxPortal.apk

Repository secrets (Settings → Secrets and variables → Actions):
* `ANDROID_KEYSTORE_BASE64` – the signing key (base64)
* `ANDROID_KEYSTORE_PASSWORD` – its password

Keep a copy of the signing key safe: app updates must be signed with the same key.
