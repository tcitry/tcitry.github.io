import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

// Reviewed article attachments only. Blog/scripts also contains local tooling
// and must never be copied wholesale into the public site.
export const PUBLIC_DOWNLOADS = ['scripts/upload-r2-image.py'];

export async function copyPublicDownloads(blog, output) {
  const sourceRoot = await realpath(blog);
  for (const relative of PUBLIC_DOWNLOADS) {
    const source = path.join(sourceRoot, relative);
    const resolved = await realpath(source);
    if (!(await lstat(source)).isFile() || resolved !== source) {
      throw new Error(`Public download must be a regular file inside Blog: ${relative}`);
    }
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}
