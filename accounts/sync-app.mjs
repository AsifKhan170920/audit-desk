/* Copies the accounting software (Accounting-Client release build) into accounts/app/,
   which the Accounts loader (accounts/index.html) opens.
     node accounts/sync-app.mjs [path to the Accounting-Client checkout]
   Default source: ../Accounting-Client-wt/preview (branch "release"). */
import { cpSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(process.argv[2] || join(HERE, '..', '..', 'Accounting-Client-wt', 'preview'));
const DEST = join(HERE, 'app');
if (!existsSync(join(SRC, 'index.html'))) { console.error('Not an Accounting-Client checkout: ' + SRC); process.exit(1); }
rmSync(DEST, { recursive: true, force: true });
for (const p of ['index.html', 'js', 'css', 'dist']) cpSync(join(SRC, p), join(DEST, p), { recursive: true });
let rev = ''; try { rev = execSync('git -C "' + SRC + '" log -1 --format="%h %s"').toString().trim(); } catch (e) {}
writeFileSync(join(DEST, 'VERSION.txt'), 'Copied from ' + SRC + '\n' + rev + '\n' + new Date().toISOString() + '\n');
console.log('accounts/app updated from', SRC, '-', rev);
