/* Prepares the generated Capacitor Android project for Kazabooks.
   Run after `npx cap add android` (the GitHub workflow does this for every build). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const APP = path.join(ANDROID, 'app');
const RES = path.join(APP, 'src', 'main', 'res');
const ICON = path.join(ROOT, '..', 'kazabooks-desktop', 'make-icon.js');   // the same drawing as the Windows / Mac app
const run = Number(process.env.GITHUB_RUN_NUMBER || 1);

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); console.log('updated', path.relative(ROOT, p)); }
function icon(size, out, mode) { fs.mkdirSync(path.dirname(out), { recursive: true }); execFileSync(process.execPath, [ICON, String(size), out].concat(mode ? [mode] : []), { stdio: 'inherit' }); }

// 1. Version and signing (the release key from the repository secrets when there is one)
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

// 2. Internet only (no other permissions)
const manifestFile = path.join(APP, 'src', 'main', 'AndroidManifest.xml');
let m = read(manifestFile);
if (m.indexOf('"android.permission.INTERNET"') < 0) m = m.replace('</manifest>', '    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>');
write(manifestFile, m);

// 3. App name
const strings = path.join(RES, 'values', 'strings.xml');
let st = read(strings);
st = st.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Kazabooks</string>')
       .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Kazabooks</string>');
write(strings, st);

// 4. Icons: the round-cornered tile for old launchers, an adaptive icon (navy + the K) for Android 8+
const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
Object.keys(DPI).forEach(d => {
  const dir = path.join(RES, 'mipmap-' + d), f = DPI[d];
  icon(Math.round(48 * f), path.join(dir, 'ic_launcher.png'));
  icon(Math.round(48 * f), path.join(dir, 'ic_launcher_round.png'));
  icon(Math.round(108 * f), path.join(dir, 'ic_launcher_foreground.png'), 'fg');
});
['drawable-v24/ic_launcher_foreground.xml', 'drawable/ic_launcher_background.xml'].forEach(f => {   // the template's vector icon would hide ours
  const p = path.join(RES, f); if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('removed', f); }
});
write(path.join(RES, 'values', 'ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#14284B</color>\n</resources>\n');
['ic_launcher.xml', 'ic_launcher_round.xml'].forEach(f => {
  write(path.join(RES, 'mipmap-anydpi-v26', f), '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n');
});

// 5. Splash: navy with the K (the old splash images replaced by the tile)
const styles = path.join(RES, 'values', 'styles.xml');
let sy = read(styles);
if (!/windowSplashScreenBackground/.test(sy)) sy = sy.replace(/(<style name="AppTheme.NoActionBarLaunch"[^>]*>)/, '$1\n        <item name="windowSplashScreenBackground">#14284B</item>');
write(styles, sy);
fs.readdirSync(RES).filter(d => /^drawable/.test(d)).forEach(d => {
  const p = path.join(RES, d, 'splash.png');
  if (fs.existsSync(p)) icon(d === 'drawable' ? 480 : 288, p);
});
console.log('Kazabooks Android project ready (versionCode ' + run + ')');
