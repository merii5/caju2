const handle = require('../server');

module.exports = function vercelHandler(request, response) {
  const incoming = new URL(request.url, 'http://localhost');
  if (incoming.pathname === '/api/index' || incoming.pathname === '/api/index.js') {
    const path = incoming.searchParams.get('__caju_path') ?? request.query?.__caju_path;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[?#\\\x00-\x1f]/.test(path)) {
      response.statusCode = 404;
      return response.end();
    }
    incoming.pathname = path;
    incoming.searchParams.delete('__caju_path');
    request.url = incoming.pathname + incoming.search;
  }
  return handle(request, response);
};
