/* Prepares the generated Capacitor Android project for the Fair Tax Portal app.
   Run after `npx cap add android` (the GitHub workflow does this for every build). */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const APP = path.join(ANDROID, 'app');
const RES = path.join(APP, 'src', 'main', 'res');
const run = Number(process.env.GITHUB_RUN_NUMBER || 1);

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, s); console.log('updated', path.relative(ROOT, p)); }
function copyDir(src, dst) {
  for (const e of fs.readdirSync(src, {withFileTypes: true})) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.name.endsWith('-512.png')) continue;
    // one sound per name: an older .ogg next to a newer .wav would clash in res/raw
    else if (/\.ogg$/.test(e.name) && fs.existsSync(s.replace(/\.ogg$/, '.wav'))) continue;
    else { fs.mkdirSync(dst, {recursive: true}); fs.copyFileSync(s, d); }
  }
}

// 1. Google sign-in libraries for the Firebase Authentication plugin
const vars = path.join(ANDROID, 'variables.gradle');
let v = read(vars);
if (!/rgcfaIncludeGoogle/.test(v)) v = v.replace(/ext\s*\{/, "ext {\n    rgcfaIncludeGoogle = true");
write(vars, v);

// 2. Firebase config (google-services.json) – needed for Google sign-in of the admin
const gs = path.join(ROOT, 'google-services.json');
if (fs.existsSync(gs)) { fs.copyFileSync(gs, path.join(APP, 'google-services.json')); console.log('copied google-services.json'); }
else console.warn('WARNING: google-services.json missing – admin Google sign-in will not work in the app');

// 3. Version, signing
const gradleFile = path.join(APP, 'build.gradle');
let g = read(gradleFile);
g = g.replace(/versionCode\s+\d+/, 'versionCode ' + run).replace(/versionName\s+"[^"]*"/, 'versionName "1.' + run + '"');
if (!/signingConfigs/.test(g)) {
  g = g.replace(/buildTypes\s*\{/, `signingConfigs {
        release {
            def ks = file('release.keystore')
            if (ks.exists()) {
                storeFile ks
                storePassword System.getenv('KEYSTORE_PASSWORD')
                keyAlias System.getenv('KEY_ALIAS') ?: 'fairtax'
                keyPassword System.getenv('KEYSTORE_PASSWORD')
            }
        }
    }
    buildTypes {`);
  g = g.replace(/release\s*\{\s*minifyEnabled false/, `release {
            signingConfig file('release.keystore').exists() ? signingConfigs.release : signingConfigs.debug
            minifyEnabled false`);
}
write(gradleFile, g);

// 4. Permissions for reminders (exact times, after restart)
const manifestFile = path.join(APP, 'src', 'main', 'AndroidManifest.xml');
let m = read(manifestFile);
const perms = ['android.permission.POST_NOTIFICATIONS', 'android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM',
  'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.WAKE_LOCK', 'android.permission.VIBRATE', 'android.permission.INTERNET'];
perms.forEach(p => { if (m.indexOf('"' + p + '"') < 0) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`); });
write(manifestFile, m);

// 5. App name, icons, notification icon
const strings = path.join(RES, 'values', 'strings.xml');
let st = read(strings);
st = st.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Fair Tax</string>')
       .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Fair Tax Portal</string>');
write(strings, st);
copyDir(path.join(ROOT, 'res'), RES);
// the template also ships a vector foreground for API 24+ that would hide ours
const vec = path.join(RES, 'drawable-v24', 'ic_launcher_foreground.xml');
if (fs.existsSync(vec)) { fs.unlinkSync(vec); console.log('removed default vector foreground'); }
const bgVec = path.join(RES, 'drawable', 'ic_launcher_background.xml');
if (fs.existsSync(bgVec)) { fs.unlinkSync(bgVec); console.log('removed default background drawable'); }
['ic_launcher.xml', 'ic_launcher_round.xml'].forEach(f => {
  const p = path.join(RES, 'mipmap-anydpi-v26', f);
  write(p, '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n');
});
// splash colour = brand navy
const styles = path.join(RES, 'values', 'styles.xml');
let sy = read(styles);
if (!/windowSplashScreenBackground/.test(sy)) sy = sy.replace(/(<style name="AppTheme.NoActionBarLaunch"[^>]*>)/, '$1\n        <item name="windowSplashScreenBackground">#14284B</item>');
write(styles, sy);
// 6. Our small native helper (battery / notification settings) + loud reminder sounds (res/raw copied above)
const javaDir = path.join(APP, 'src', 'main', 'java', 'com', 'fairtax', 'portal');
fs.mkdirSync(javaDir, {recursive: true});
['MainActivity.java', 'FTSystemPlugin.java', 'FTSpeechPlugin.java'].forEach(f => { fs.copyFileSync(path.join(ROOT, 'native', f), path.join(javaDir, f)); console.log('copied native/' + f); });
let m2 = read(manifestFile);
if (m2.indexOf('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS') < 0) m2 = m2.replace('</manifest>', '    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />\n</manifest>');
// 7. Microphone for the AI assistant (speech recognition + read-aloud services must be visible to the app)
['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'].forEach(p => { if (m2.indexOf('"' + p + '"') < 0) m2 = m2.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`); });
if (m2.indexOf('android.speech.RecognitionService') < 0) m2 = m2.replace('</manifest>', '    <queries>\n        <intent><action android:name="android.speech.RecognitionService" /></intent>\n        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>\n    </queries>\n</manifest>');
write(manifestFile, m2);
console.log('Android project ready (versionCode ' + run + ')');
