export const BACKEND_ENTITLEMENT_HEADER = "x-polyweather-entitlement";

export function buildBackendRequestHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  const token = process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim();
  if (token) {
    headers[BACKEND_ENTITLEMENT_HEADER] = token;
  }

  return headers;
}
