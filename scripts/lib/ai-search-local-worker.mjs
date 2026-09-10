// Run only in Wrangler's temporary local runtime. Never a deployed entrypoint.
export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/bootstrap'
      || !env.BOOTSTRAP_SESSION || request.headers.get('x-bootstrap-session') !== env.BOOTSTRAP_SESSION) {
      return new Response('Not found', {status: 404});
    }
    const {operation, args = []} = await request.json();
    if (env.BOOTSTRAP_READ_ONLY === '1' && !['info', 'list', 'get', 'itemInfo'].includes(operation)
      || env.BOOTSTRAP_NO_SCHEMA_UPDATE === '1' && operation === 'update') {
      return new Response('Not found', {status: 404});
    }
    const search = env.BLOG_SEARCH;
    const operations = {
      info: () => search.info(),
      update: () => search.update(...args),
      list: () => search.items.list(...args),
      get: () => search.items.get(...args),
      itemInfo: () => search.items.get(...args).info(),
      upload: () => search.items.upload(...args),
      uploadAndPoll: () => search.items.uploadAndPoll(...args),
    };
    if (!Object.hasOwn(operations, operation)) return new Response('Not found', {status: 404});
    try { return Response.json(await operations[operation]()); }
    catch (error) {
      return Response.json({name: error.name, status: error.status, code: error.code}, {status: 502});
    }
  },
};
