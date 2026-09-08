import { themeRelease, runNpm } from './theme-package.mjs';

try {
  if (process.argv.length > 2) throw new Error('Usage: npm run setup');
  await themeRelease();
  console.log('Installing the blog lockfile. HeroUI Pro requires prior CLI login or HEROUI_AUTH_TOKEN in CI.');
  await runNpm(['ci', '--include=dev', '--prefer-offline', '--no-audit', '--no-fund']);
  console.log('Setup complete. Set BLOG_DIR to your content checkout, then run npm run build.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
