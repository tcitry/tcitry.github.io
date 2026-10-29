import {mountSelectionTools} from '../../src/scripts/selection-tools.mjs';
import {paintAnnotations} from '../../src/scripts/annotation-paint.mjs';
import '../../src/styles/chat-widget.css';
import '../../src/styles/reader-annotations.css';

const actions = [];
const widget = document.querySelector('[data-blog-chat-widget]');
const tools = mountSelectionTools({
  widget,
  onAction(detail) { actions.push(detail); },
});

window.__annotations = {
  actions,
  dismiss: () => tools.dismiss(),
  paint(marks) { paintAnnotations(document.querySelector('article.markdown'), marks); },
};
