import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const usersPageSource = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "users", "UsersPageClient.tsx"),
    "utf8",
  );

  assert(
    usersPageSource.includes("leaderboardName") &&
      usersPageSource.includes("String(entry.username || \"\").trim()") &&
      usersPageSource.includes("TG${entry.telegram_id}"),
    "ops users leaderboard must fall back when username is blank",
  );
  assert(
    usersPageSource.includes("本周暂无积分记录") &&
      usersPageSource.includes("本周积分") &&
      !usersPageSource.includes("entry.username ?? `TG${entry.telegram_id}`"),
    "ops users leaderboard must show weekly points clearly and avoid zero-point fake rankings",
  );
}
