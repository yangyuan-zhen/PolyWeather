import { copyFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const serverDir = path.join(process.cwd(), ".next", "server");
const chunksDir = path.join(serverDir, "chunks");
const cleanRoot = process.argv.includes("--clean-root");

try {
  const entries = await readdir(chunksDir, { withFileTypes: true });
  await mkdir(serverDir, { recursive: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map(async (entry) => {
        const target = path.join(serverDir, entry.name);
        if (cleanRoot) {
          await unlink(target).catch((error) => {
            if (error?.code !== "ENOENT") throw error;
          });
          return;
        }
        await copyFile(path.join(chunksDir, entry.name), target);
      }),
  );
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}
