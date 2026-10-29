import '../../src/styles/tailwind.css';
import './search-ai.css';

void import('../../src/scripts/blog-search').then(() => {
  document.documentElement.dataset.searchFixtureReady = 'true';
});
