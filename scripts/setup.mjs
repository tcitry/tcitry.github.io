import { prepareTheme, runNpm } from './theme-package.mjs';

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--theme-only')) throw new Error('Usage: npm run setup [-- --theme-only]');
  // setup always uses the committed source pin; local changes belong to theme:sync.
  await prepareTheme({ verifyLock: true });
  if (!args.includes('--theme-only')) {
    console.log('Installing the blog lockfile. HeroUI Pro requires prior CLI login or HEROUI_AUTH_TOKEN in CI.');
    await runNpm(['ci', '--include=dev', '--prefer-offline', '--no-audit', '--no-fund']);
    console.log('Setup complete. Set BLOG_DIR to your content checkout, then run npm run build.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
