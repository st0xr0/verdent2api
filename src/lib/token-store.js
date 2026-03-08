function maskMiddle(value) {
  if (!value) return null;
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 4)}...[REDACTED]...${value.slice(-4)}`;
}

let runtimeToken = process.env.VERDENT_AGENT_API_TOKEN || null;
let tokenSource = runtimeToken ? 'env' : null;
let tokenCapturedAt = null;

export function getAgentApiToken() {
  return runtimeToken;
}

export function setAgentApiToken(token, source = 'runtime') {
  runtimeToken = token || null;
  tokenSource = runtimeToken ? source : null;
  tokenCapturedAt = runtimeToken ? new Date().toISOString() : null;
  return getAgentApiTokenStatus();
}

export function clearAgentApiToken() {
  runtimeToken = null;
  tokenSource = null;
  tokenCapturedAt = null;
}

export function getAgentApiTokenStatus() {
  return {
    configured: Boolean(runtimeToken),
    source: tokenSource,
    capturedAt: tokenCapturedAt,
    maskedToken: maskMiddle(runtimeToken),
  };
}
