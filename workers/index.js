import { notifyPageView } from './visit-notify.mjs';

export default {
  async fetch(request, env, ctx) {
    const response = env.ASSETS.fetch(request);
    notifyPageView(request, env, ctx, response);
    return response;
  },
};
