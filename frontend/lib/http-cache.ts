import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function normalizeTag(tag: string) {
  return tag.trim().replace(/^W\//i, "");
}

function ifNoneMatchHit(ifNoneMatch: string | null, etag: string) {
  if (!ifNoneMatch) return false;
  const target = normalizeTag(etag);
  return ifNoneMatch
    .split(",")
    .map((part) => normalizeTag(part))
    .some((part) => part === "*" || part === target);
}

function buildEtag(body: string) {
  const hash = createHash("sha1").update(body).digest("hex");
  return `"${hash}"`;
}

export function buildCachedJsonResponse(
  req: NextRequest,
  payload: unknown,
  cacheControl: string,
) {
  const body = JSON.stringify(payload);
  const etag = buildEtag(body);
  const headers = new Headers({
    "Cache-Control": cacheControl,
    ETag: etag,
    "Content-Type": "application/json; charset=utf-8",
  });

  if (ifNoneMatchHit(req.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(body, { status: 200, headers });
}
