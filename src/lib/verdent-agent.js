const jsonHeaders = { 'content-type': 'application/json' };

export class VerdentAgentClient {
  constructor({ baseUrl, apiToken } = {}) {
    this.baseUrl = (baseUrl || process.env.VERDENT_AGENT_URL || 'http://127.0.0.1:59647').replace(/\/$/, '');
    this.apiToken = apiToken || process.env.VERDENT_AGENT_API_TOKEN || null;
  }

  get cookieHeader() {
    return this.apiToken ? `api_token=${this.apiToken}` : null;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const overrideApiToken = options.apiToken || null;
    const cookieHeader = overrideApiToken ? `api_token=${overrideApiToken}` : this.cookieHeader;

    if (cookieHeader) {
      headers.set('cookie', cookieHeader);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();

    return {
      ok: response.ok,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }

  getOpenApi() {
    return this.request('/openapi.json');
  }

  getRoot(options = {}) {
    return this.request('/', options);
  }

  updateMcp(payload = {}, options = {}) {
    return this.request('/update/mcp', {
      ...options,
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
  }

  updateSubagent(payload = {}, options = {}) {
    return this.request('/update/subagent', {
      ...options,
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
  }
}
