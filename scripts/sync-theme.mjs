import { artifact, prepareTheme, runNpm } from './theme-package.mjs';

try {
  await prepareTheme({ localDirectory: process.env.ASTRO_BOOK_DIR });
  // Unlike setup, an explicit sync updates the installed artifact and its lock.
  await runNpm(['install', '--save-exact', `./${artifact}`, '--no-audit', '--no-fund']);
  console.log('Theme and lockfile synchronized. Run npm run build && npm run verify.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
