export class Router {
  constructor() {
    this.routes = {
      GET: new Map(),
      POST: new Map(),
      PUT: new Map(),
      DELETE: new Map()
    };
  }

  get(path, handler) {
    this.routes.GET.set(path, handler);
  }

  post(path, handler) {
    this.routes.POST.set(path, handler);
  }

  put(path, handler) {
    this.routes.PUT.set(path, handler);
  }

  delete(path, handler) {
    this.routes.DELETE.set(path, handler);
  }

  async handle(request) {
    const url = new URL(request.url);
    const method = request.method;
    const routes = this.routes[method];

    if (!routes) {
      return new Response('Method not allowed', { status: 405 });
    }

    for (const [pattern, handler] of routes) {
      const match = this.matchPath(pattern, url.pathname);
      if (match) {
        request.params = match.params;
        try {
          return await handler(request);
        } catch (error) {
          console.error('Route handler error:', error);
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    return new Response('Not found', { status: 404 });
  }

  matchPath(pattern, pathname) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) {
      return null;
    }

    const params = {};

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        const paramName = patternParts[i].substring(1);
        params[paramName] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }

    return { params };
  }
}