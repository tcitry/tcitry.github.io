import shell from '../../node_modules/@tcitry/astro-book/src/styles/Shell.module.css';
import reading from '../../node_modules/@tcitry/astro-book/src/styles/Reading.module.css';
import site from '../../src/styles/blog.module.css';
import '@tcitry/astro-book/styles.css';

document.documentElement.setAttribute('data-astro-book', '');
document.body.className = `${shell.shell} ${reading.reading} ${site.site}`;

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');

// CommonMark loose list: blank lines between items wrap each entry in <p>.
root.innerHTML = `
<div class="book-page">
  <article class="markdown" data-loose-list-fixture>
    <ul>
      <li><p>First loose item</p></li>
      <li><p>Second loose item</p></li>
      <li><p>Lead paragraph</p><p>Second paragraph keeps spacing.</p></li>
    </ul>
  </article>
</div>`;

document.documentElement.dataset.ready = 'true';
