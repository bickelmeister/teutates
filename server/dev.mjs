#!/usr/bin/env node
// Runs everything a change can touch, so editing any file in the project is
// visible after a reload without a second command.
//
// Three things watch, because three things can change: the stylesheet and the
// bundle are rebuilt into server/dist by their own watchers, the app shell is
// copied on change, and the server restarts itself. The watchers are the npm
// scripts rather than copies of their command lines, so there is one place
// where a build flag lives.
import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const uiDir = path.join(root, "ui");
const distDir = path.join(root, "server", "dist");
const shell = { from: path.join(uiDir, "index.html"), to: path.join(distDir, "index.html") };

/** Every child, so Ctrl+C can take all of them down together. */
const children = [];

/** Starts a child in its own process group. npm sits between this process and
 *  the tool it runs, and does not reliably forward a signal to it, so the
 *  group is what gets signalled on shutdown. */
function start(name, command, args, cwd) {
  // stdin is an open pipe that is never written to and never closed. Both
  // watchers stop when they see EOF on stdin, and a detached child has no
  // terminal to inherit one from, so closing it would end them immediately.
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "inherit", "inherit"],
    detached: true,
  });
  children.push({ name, child });

  child.on("exit", (code, signal) => {
    // A watcher that stops on its own leaves the setup half-running, which is
    // worse than stopping: the page would silently serve stale assets.
    if (shuttingDown) return;
    console.error(`\nteutates dev: ${name} exited (${signal ?? code}), stopping the rest`);
    shutdown(typeof code === "number" && code !== 0 ? code : 1);
  });
  return child;
}

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of children) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    try {
      // The negative pid signals the whole group, so the tool npm started
      // goes down with it rather than being orphaned onto the port.
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  // Give the children a moment to close their own listeners before leaving.
  setTimeout(() => process.exit(code), 200).unref();
}

/** Copies the app shell, which nothing else watches: `build:html` is a one-off
 *  copy, so without this an edit to index.html would silently do nothing. */
async function copyShell() {
  await mkdir(distDir, { recursive: true });
  await copyFile(shell.from, shell.to);
}

await copyShell();

// The directory is watched rather than the file: an editor that saves by
// replacing the file would leave a watch on the old inode behind.
let pending;
watch(uiDir, (_event, filename) => {
  if (filename !== "index.html") return;
  clearTimeout(pending);
  // A save often arrives as several events; one copy is enough.
  pending = setTimeout(() => {
    copyShell().then(
      () => console.log("teutates dev: index.html copied"),
      (error) => console.error(`teutates dev: copying index.html: ${error.message}`),
    );
  }, 50);
});

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
start("watch:css", npm, ["run", "--silent", "watch:css"], uiDir);
start("watch:js", npm, ["run", "--silent", "watch:js"], uiDir);
// --watch restarts the server when its own source changes, which is the one
// thing serving from disk cannot cover.
start("server", process.execPath, ["--watch", path.join(root, "server", "teutates.mjs"), ...process.argv.slice(2)], root);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
