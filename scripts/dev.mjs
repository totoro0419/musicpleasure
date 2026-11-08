import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const cwd = process.cwd();
const python = path.join(cwd, ".venv/bin/python");
const children = [];
if (existsSync(python))
  children.push(
    spawn(
      python,
      [
        "-m",
        "uvicorn",
        "backend.app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
      ],
      { cwd, stdio: "inherit" },
    ),
  );
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "0.0.0.0",
    ...process.argv.slice(2),
  ],
  { cwd, stdio: "inherit" },
);
children.push(vite);
const close = () => {
  for (const child of children) child.kill("SIGTERM");
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    close();
    process.exit(0);
  });
vite.on("exit", (code) => {
  close();
  process.exit(code || 0);
});
