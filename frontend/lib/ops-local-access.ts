import { extractHostname, isLocalHostname } from "@/lib/local-dev-access";

function readLocalOpsAccessFlag() {
  const raw = process.env.POLYWEATHER_LOCAL_OPS_FULL_ACCESS;
  if (raw == null) return process.env.NODE_ENV !== "production";
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

export function isLocalOpsAccessHost(value?: string | null) {
  return readLocalOpsAccessFlag() && isLocalHostname(extractHostname(value));
}
