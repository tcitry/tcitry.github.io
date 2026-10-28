import {searchContent} from '../../src/lib/search-client';
import '../../src/scripts/pagefind-warmup';

declare global {
  interface Window {
    __searchContent: typeof searchContent;
  }
}

window.__searchContent = searchContent;
