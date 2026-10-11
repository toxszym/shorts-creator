import { spawn } from "node:child_process";

export function run(cmd: string, args: string[], opts: { cwd?: string; onStdout?: (chunk: string) => void } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      opts.onStdout?.(s);
    });
    child.stderr.on("data", (d) => (err = (err + d.toString()).slice(-4000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} zakończył się kodem ${code}\n${err}`))));
  });
}

export async function probeSize(file: string): Promise<{ width: number; height: number }> {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = out.trim().split(",").map(Number);
  return { width, height };
}

export async function probeDuration(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(out.trim());
}
