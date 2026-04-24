import { NextRequest } from "next/server";
import { forwardPriorityWarmHint } from "@/lib/system-priority-proxy";

export async function GET(req: NextRequest) {
  return forwardPriorityWarmHint(req);
}

export async function POST(req: NextRequest) {
  return forwardPriorityWarmHint(req);
}
