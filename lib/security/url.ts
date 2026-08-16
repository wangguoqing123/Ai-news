const privateIp = /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i;

export function assertSafeConnectorUrl(value: string, allowlist = process.env.CONNECTOR_HOST_ALLOWLIST ?? ""): URL {
  const url = new URL(value);
  if (!['https:','http:'].includes(url.protocol)) throw new Error("只允许 HTTP 或 HTTPS 来源");
  if (url.username || url.password) throw new Error("URL 中不得包含用户名或密码");
  if (privateIp.test(url.hostname) || url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("不允许访问本机或私有网络地址");
  const allowed = allowlist.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("该来源域名不在允许列表中");
  return url;
}
