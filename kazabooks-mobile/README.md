# Kazabooks for Android

The Kazabooks website (https://kazabooks.com) as an Android app (Capacitor). Built by
`.github/workflows/kazabooks-android.yml` and published as
https://github.com/AsifKhan170920/audit-desk/releases/download/kazabooks-android/Kazabooks.apk

The icons are drawn by `kazabooks-desktop/make-icon.js` during the build (no image files kept here).
If the repository secret ANDROID_KEYSTORE_BASE64 is set, the APK is signed with that key (so updates install
over the old app); otherwise with a debug key.
