#!/usr/bin/env node
/**
 * Shadow Laptop Agent — Persistent Background Control Daemon
 *
 * Gives Shadow full local access to your laptop when paired with your Shadow UI:
 *   - Read, write, append, list, search, move, copy, mkdir, and delete files
 *   - Launch, focus, quit, list, and automate desktop apps (macOS / Windows / Linux)
 *   - Execute terminal commands synchronously or as managed background jobs
 *   - Launch & automate your laptop browser (Playwright headful Chromium or system browser)
 *
 * Security:
 *   - Binds strictly to 127.0.0.1 (loopback only; unreachable from external networks)
 *   - Requires a local cryptographic pairing token (~/.shadow-agent/token.txt)
 *
 * Usage:
 *   node scripts/shadow-laptop-agent.mjs            # Foreground
 *   node scripts/shadow-laptop-agent.mjs --daemon   # Background daemon mode
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const PORT = Number(process.env.SHADOW_AGENT_PORT || 4789);
const HOST = '127.0.0.1';
const AGENT_DIR = path.join(os.homedir(), '.shadow-agent');
const TOKEN_FILE = path.join(AGENT_DIR, 'token.txt');
const PID_FILE = path.join(AGENT_DIR, 'agent.pid');
const LOG_FILE = path.join(AGENT_DIR, 'agent.log');

// Handle --daemon self-detachment before starting the HTTP listener
if (process.argv.includes('--daemon') && !process.env.SHADOW_DAEMON_CHILD) {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_FILE, 'a');
  const childArgs = process.argv.slice(1).filter((a) => a !== '--daemon');
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, SHADOW_DAEMON_CHILD: '1' },
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
  console.log(`Shadow Laptop Agent started in background (PID ${child.pid}).`);
  console.log(`Log file: ${LOG_FILE}`);
  console.log(`Token file: ${TOKEN_FILE}`);
  process.exit(0);
}

function ensureToken() {
  if (process.env.SHADOW_AGENT_TOKEN && process.env.SHADOW_AGENT_TOKEN.trim()) {
    return process.env.SHADOW_AGENT_TOKEN.trim();
  }
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  if (fs.existsSync(TOKEN_FILE)) {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing.length >= 16) return existing;
  }
  const generated = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, generated, { mode: 0o600 });
  return generated;
}

const PAIRING_TOKEN = ensureToken();
fs.mkdirSync(AGENT_DIR, { recursive: true });
fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');

const backgroundJobs = new Map();

function resolveHomePath(rawPath) {
  const input = String(rawPath || '').trim();
  if (!input || input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-shadow-token, Authorization'
  );
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error('Request payload too large (limit 5MB)'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON request body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function isAuthorized(req) {
  const headerToken = String(req.headers['x-shadow-token'] || '').trim();
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const supplied = headerToken || bearer;
  if (!supplied || supplied.length !== PAIRING_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(PAIRING_TOKEN));
}

async function searchFilesRecursive(dir, query, results = [], depth = 0) {
  if (depth > 4 || results.length >= 40) return results;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  const needle = query.toLowerCase();
  for (const entry of entries) {
    if (results.length >= 40) break;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.name.toLowerCase().includes(needle)) {
      results.push({
        name: entry.name,
        path: full,
        type: entry.isDirectory() ? 'directory' : 'file',
      });
    }
    if (entry.isDirectory()) {
      await searchFilesRecursive(full, query, results, depth + 1);
    }
  }
  return results;
}

async function handleFileOperation(body) {
  const operation = String(body.operation || 'list').toLowerCase();
  const targetPath = resolveHomePath(body.path || '~');

  if (operation === 'read') {
    const stat = await fsp.stat(targetPath);
    if (stat.isDirectory()) {
      throw new Error(`"${targetPath}" is a directory. Use operation "list".`);
    }
    const raw = await fsp.readFile(targetPath, 'utf8');
    return {
      ok: true,
      operation,
      path: targetPath,
      size: stat.size,
      content: raw.slice(0, 24000),
      truncated: raw.length > 24000,
    };
  }

  if (operation === 'write' || operation === 'append') {
    const content = String(body.content ?? '');
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    if (operation === 'append') {
      await fsp.appendFile(targetPath, content, 'utf8');
    } else {
      await fsp.writeFile(targetPath, content, 'utf8');
    }
    return {
      ok: true,
      operation,
      path: targetPath,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
    };
  }

  if (operation === 'list') {
    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    const items = await Promise.all(
      entries.slice(0, 120).map(async (entry) => {
        const full = path.join(targetPath, entry.name);
        let size = 0;
        try {
          if (!entry.isDirectory()) {
            size = (await fsp.stat(full)).size;
          }
        } catch {
          size = 0;
        }
        return {
          name: entry.name,
          path: full,
          type: entry.isDirectory() ? 'directory' : 'file',
          size,
        };
      })
    );
    return { ok: true, operation, path: targetPath, count: items.length, items };
  }

  if (operation === 'mkdir') {
    await fsp.mkdir(targetPath, { recursive: true });
    return { ok: true, operation, path: targetPath };
  }

  if (operation === 'move' || operation === 'copy') {
    const dest = resolveHomePath(body.destinationPath || '');
    if (!body.destinationPath) {
      throw new Error(`"destinationPath" is required for ${operation}`);
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (operation === 'move') {
      await fsp.rename(targetPath, dest);
    } else {
      await fsp.cp(targetPath, dest, { recursive: true });
    }
    return { ok: true, operation, path: targetPath, destinationPath: dest };
  }

  if (operation === 'delete') {
    await fsp.rm(targetPath, { recursive: true, force: false });
    return { ok: true, operation, path: targetPath };
  }

  if (operation === 'search') {
    const pattern = String(body.pattern || '').trim();
    if (!pattern) throw new Error('"pattern" is required for search');
    const matches = await searchFilesRecursive(targetPath, pattern);
    return { ok: true, operation, path: targetPath, pattern, matches };
  }

  if (operation === 'stat') {
    const st = await fsp.stat(targetPath);
    return {
      ok: true,
      operation,
      path: targetPath,
      isDirectory: st.isDirectory(),
      size: st.size,
      modifiedAt: st.mtime.toISOString(),
    };
  }

  throw new Error(`Unsupported file operation: ${operation}`);
}

function normalizeLayoutMode(raw) {
  const val = String(raw || '').toLowerCase().trim();
  if (val === 'side-by-side' || val === 'side_by_side' || val === 'split' || val === 'columns') {
    return 'side-by-side';
  }
  if (val === 'focus-split' || val === 'focus_split' || val === 'focus' || val === 'primary-stack') {
    return 'focus-split';
  }
  return 'grid';
}

function parseAppsInput(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item || '').trim()).filter(Boolean);
        }
      } catch {
        // fallback to comma/newline splitting
      }
    }
    return trimmed
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function computeScreenTileRects(apps, layout, workArea, gap = 8) {
  const count = apps.length;
  if (count === 0) return [];
  const { x: ox, y: oy, width: sw, height: sh } = workArea;
  const safeGap = Math.max(0, Math.min(48, Number(gap) || 8));

  if (count === 1) {
    return [
      {
        appName: apps[0],
        x: Math.round(ox + safeGap),
        y: Math.round(oy + safeGap),
        width: Math.round(sw - safeGap * 2),
        height: Math.round(sh - safeGap * 2),
      },
    ];
  }

  if (layout === 'side-by-side') {
    const tileW = (sw - safeGap * (count + 1)) / count;
    const tileH = sh - safeGap * 2;
    return apps.map((appName, idx) => ({
      appName,
      x: Math.round(ox + safeGap + idx * (tileW + safeGap)),
      y: Math.round(oy + safeGap),
      width: Math.round(tileW),
      height: Math.round(tileH),
    }));
  }

  if (layout === 'focus-split') {
    const primaryW = (sw - safeGap * 3) * 0.6;
    const stackW = (sw - safeGap * 3) * 0.4;
    const stackCount = count - 1;
    const stackH = (sh - safeGap * (stackCount + 1)) / stackCount;
    return apps.map((appName, idx) => {
      if (idx === 0) {
        return {
          appName,
          x: Math.round(ox + safeGap),
          y: Math.round(oy + safeGap),
          width: Math.round(primaryW),
          height: Math.round(sh - safeGap * 2),
        };
      }
      const stackIdx = idx - 1;
      return {
        appName,
        x: Math.round(ox + safeGap * 2 + primaryW),
        y: Math.round(oy + safeGap + stackIdx * (stackH + safeGap)),
        width: Math.round(stackW),
        height: Math.round(stackH),
      };
    });
  }

  const cols = count <= 2 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellH = (sh - safeGap * (rows + 1)) / rows;
  return apps.map((appName, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const isLastRow = row === rows - 1;
    const itemsInRow = isLastRow ? count - row * cols : cols;
    const cellW = (sw - safeGap * (itemsInRow + 1)) / itemsInRow;
    return {
      appName,
      x: Math.round(ox + safeGap + col * (cellW + safeGap)),
      y: Math.round(oy + safeGap + row * (cellH + safeGap)),
      width: Math.round(cellW),
      height: Math.round(cellH),
    };
  });
}

async function listVisibleRunningApps() {
  const platform = process.platform;
  if (platform === 'darwin') {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of (processes where background only is false)'`
    );
    return stdout
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (platform === 'win32') {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty ProcessName -Unique"`
    );
    return stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const { stdout } = await execAsync(`ps -eo comm --no-headers | sort -u | head -n 40`);
  return stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function arrangeWindowsOnScreen({ layout = 'grid', apps = [], gap = 8 }) {
  const platform = process.platform;
  const resolvedLayout = normalizeLayoutMode(layout);
  let targetApps = parseAppsInput(apps);

  if (targetApps.length === 0) {
    const running = await listVisibleRunningApps().catch(() => []);
    const ignoreNames = new Set(['Finder', 'Shadow', 'electron', 'Electron']);
    const filtered = running.filter((name) => !ignoreNames.has(name));
    targetApps = (filtered.length > 0 ? filtered : running).slice(0, 6);
  }

  if (targetApps.length === 0) {
    return {
      ok: false,
      action: 'arrange_windows',
      layout: resolvedLayout,
      error: 'No open visible application windows found to arrange.',
    };
  }

  if (platform === 'darwin') {
    let workArea = { x: 0, y: 25, width: 1440, height: 875 };
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Finder" to get bounds of window of desktop'`
      );
      const nums = stdout
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n));
      if (nums.length >= 4) {
        const left = nums[0];
        const top = Math.max(nums[1], 25);
        const right = nums[2];
        const bottom = nums[3];
        if (right > left && bottom > top) {
          workArea = { x: left, y: top, width: right - left, height: bottom - top };
        }
      }
    } catch {
      // keep default 1440x900 macOS bounds
    }

    const placements = computeScreenTileRects(targetApps, resolvedLayout, workArea, gap);
    const lines = placements.map((p) => {
      const safeApp = p.appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return [
        `try`,
        `  tell application "System Events" to tell process "${safeApp}"`,
        `    if (count of windows) > 0 then`,
        `      set position of window 1 to {${p.x}, ${p.y}}`,
        `      set size of window 1 to {${p.width}, ${p.height}}`,
        `    end if`,
        `  end tell`,
        `on error`,
        `  try`,
        `    tell application "${safeApp}" to set bounds of front window to {${p.x}, ${p.y}, ${p.x + p.width}, ${p.y + p.height}}`,
        `  end try`,
        `end try`,
      ].join('\n');
    });

    const scriptFile = path.join(os.tmpdir(), `shadow_tile_${Date.now()}.applescript`);
    await fsp.writeFile(scriptFile, lines.join('\n'), 'utf8');
    try {
      await execAsync(`osascript ${JSON.stringify(scriptFile)}`);
    } finally {
      await fsp.unlink(scriptFile).catch(() => {});
    }

    return {
      ok: true,
      action: 'arrange_windows',
      platform,
      layout: resolvedLayout,
      workArea,
      arranged: placements,
      message: `Arranged ${placements.length} window(s) in ${resolvedLayout} layout.`,
    };
  }

  if (platform === 'win32') {
    const boundsScript = `Add-Type -AssemblyName System.Windows.Forms; $wa = [System.Windows.Forms.SystemInformation]::WorkingArea; "$($wa.X),$($wa.Y),$($wa.Width),$($wa.Height)"`;
    let workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    try {
      const { stdout } = await execAsync(`powershell -NoProfile -Command ${JSON.stringify(boundsScript)}`);
      const nums = stdout.trim().split(',').map((n) => Number(n));
      if (nums.length >= 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
        workArea = { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
      }
    } catch {
      // keep fallback workArea
    }

    const placements = computeScreenTileRects(targetApps, resolvedLayout, workArea, gap);
    const psMoves = placements.map((p) => {
      const safeName = p.appName.replace(/'/g, "''");
      return [
        `$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like '*${safeName}*' -or $_.MainWindowTitle -like '*${safeName}*') } | Select-Object -First 1`,
        `if ($procs) { [ShadowWin32]::ShowWindow($procs.MainWindowHandle, 9) | Out-Null; [ShadowWin32]::MoveWindow($procs.MainWindowHandle, ${p.x}, ${p.y}, ${p.width}, ${p.height}, $true) | Out-Null }`,
      ].join('\n');
    });

    const fullPs = [
      `Add-Type @"`,
      `using System;`,
      `using System.Runtime.InteropServices;`,
      `public class ShadowWin32 {`,
      `  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);`,
      `  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);`,
      `}`,
      `"@`,
      ...psMoves,
    ].join('\n');

    const psFile = path.join(os.tmpdir(), `shadow_tile_${Date.now()}.ps1`);
    await fsp.writeFile(psFile, fullPs, 'utf8');
    try {
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File ${JSON.stringify(psFile)}`);
    } finally {
      await fsp.unlink(psFile).catch(() => {});
    }

    return {
      ok: true,
      action: 'arrange_windows',
      platform,
      layout: resolvedLayout,
      workArea,
      arranged: placements,
      message: `Arranged ${placements.length} window(s) in ${resolvedLayout} layout.`,
    };
  }

  // Linux (X11 via wmctrl / xdotool)
  let workArea = { x: 0, y: 28, width: 1920, height: 1020 };
  try {
    const { stdout } = await execAsync(`wmctrl -d | awk '/\\*/ {print $9}'`);
    const match = stdout.trim().match(/^(\d+)x(\d+)/);
    if (match) {
      workArea = { x: 0, y: 28, width: Number(match[1]), height: Number(match[2]) - 28 };
    }
  } catch {
    // keep default
  }

  const placements = computeScreenTileRects(targetApps, resolvedLayout, workArea, gap);
  let wmctrlLines = [];
  try {
    const { stdout } = await execAsync(`wmctrl -l`);
    wmctrlLines = stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    wmctrlLines = [];
  }

  for (const p of placements) {
    const needle = p.appName.toLowerCase();
    const matchedLine = wmctrlLines.find((line) => line.toLowerCase().includes(needle));
    const winId = matchedLine ? matchedLine.trim().split(/\s+/)[0] : '';
    if (winId) {
      await execAsync(
        `wmctrl -ir ${winId} -b remove,maximized_vert,maximized_horz && wmctrl -ir ${winId} -e 0,${p.x},${p.y},${p.width},${p.height}`
      ).catch(() => {});
    } else {
      await execAsync(
        `xdotool search --name ${JSON.stringify(p.appName)} windowmove ${p.x} ${p.y} windowsize ${p.width} ${p.height}`
      ).catch(() => {});
    }
  }

  return {
    ok: true,
    action: 'arrange_windows',
    platform,
    layout: resolvedLayout,
    workArea,
    arranged: placements,
    message: `Arranged ${placements.length} window(s) in ${resolvedLayout} layout.`,
  };
}

async function handleAppControl(body) {
  const action = String(body.action || 'open_app').toLowerCase();
  const appName = String(body.appName || '').trim();
  const appArgs = String(body.args || '').trim();
  const instruction = String(body.instruction || '').trim();
  const platform = process.platform;

  if (action === 'system_info') {
    return {
      ok: true,
      action,
      platform,
      arch: os.arch(),
      hostname: os.hostname(),
      homeDir: os.homedir(),
      cpus: os.cpus().length,
      totalMemGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
      freeMemGb: Number((os.freemem() / 1024 ** 3).toFixed(1)),
      uptimeHours: Number((os.uptime() / 3600).toFixed(1)),
    };
  }

  if (action === 'list_apps') {
    const runningApps = await listVisibleRunningApps();
    return {
      ok: true,
      action,
      runningApps,
    };
  }

  if (action === 'arrange_windows') {
    return await arrangeWindowsOnScreen({
      layout: body.layout || instruction || 'grid',
      apps: body.apps || appArgs || appName,
      gap: body.gap,
    });
  }

  if (action === 'open_app') {
    if (!appName) throw new Error('"appName" is required to open an app.');
    if (platform === 'darwin') {
      const cmd = appArgs
        ? `open -a ${JSON.stringify(appName)} ${JSON.stringify(resolveHomePath(appArgs))}`
        : `open -a ${JSON.stringify(appName)}`;
      await execAsync(cmd);
    } else if (platform === 'win32') {
      const target = appArgs ? `"${appName}" "${appArgs}"` : `"${appName}"`;
      await execAsync(`cmd /c start "" ${target}`);
    } else {
      const child = spawn(appName, appArgs ? [appArgs] : [], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }
    return { ok: true, action, appName, message: `Opened ${appName}.` };
  }

  if (action === 'focus_app') {
    if (!appName) throw new Error('"appName" is required to focus an app.');
    if (platform === 'darwin') {
      await execAsync(`osascript -e 'tell application ${JSON.stringify(appName)} to activate'`);
    } else if (platform === 'win32') {
      await execAsync(
        `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate('${appName.replace(/'/g, "''")}')" `
      );
    } else {
      await execAsync(`wmctrl -a ${JSON.stringify(appName)} || xdotool search --name ${JSON.stringify(appName)} windowactivate`);
    }
    return { ok: true, action, appName, message: `Focused ${appName}.` };
  }

  if (action === 'quit_app') {
    if (!appName) throw new Error('"appName" is required to quit an app.');
    if (platform === 'darwin') {
      await execAsync(`osascript -e 'tell application ${JSON.stringify(appName)} to quit'`);
    } else if (platform === 'win32') {
      await execAsync(`taskkill /IM "${appName}.exe" /T /F`);
    } else {
      await execAsync(`pkill -f ${JSON.stringify(appName)}`);
    }
    return { ok: true, action, appName, message: `Closed ${appName}.` };
  }

  if (action === 'automate_app') {
    if (!instruction) throw new Error('"instruction" is required for automate_app.');
    if (platform === 'darwin') {
      const script = appName
        ? `tell application ${JSON.stringify(appName)}\nactivate\n${instruction}\nend tell`
        : instruction;
      const { stdout, stderr } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { ok: true, action, appName, stdout: stdout.trim(), stderr: stderr.trim() };
    }
    if (platform === 'win32') {
      const psCmd = appName
        ? `$ws = New-Object -ComObject WScript.Shell; $ws.AppActivate('${appName.replace(/'/g, "''")}'); Start-Sleep -Milliseconds 250; ${instruction}`
        : instruction;
      const { stdout, stderr } = await execAsync(`powershell -NoProfile -Command ${JSON.stringify(psCmd)}`);
      return { ok: true, action, appName, stdout: stdout.trim(), stderr: stderr.trim() };
    }
    const { stdout, stderr } = await execAsync(instruction);
    return { ok: true, action, appName, stdout: stdout.trim(), stderr: stderr.trim() };
  }

  throw new Error(`Unsupported app control action: ${action}`);
}

async function handleTerminalCommand(body) {
  const command = String(body.command || '').trim();
  if (!command) throw new Error('"command" is required.');
  const cwd = body.cwd ? resolveHomePath(body.cwd) : os.homedir();
  const background = Boolean(body.background);

  if (background) {
    const jobId = `job-${Date.now()}`;
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const job = {
      id: jobId,
      command,
      cwd,
      pid: child.pid,
      status: 'running',
      startedAt: Date.now(),
      outputTail: '',
    };
    child.stdout?.on('data', (chunk) => {
      job.outputTail = (job.outputTail + chunk.toString()).slice(-4000);
    });
    child.stderr?.on('data', (chunk) => {
      job.outputTail = (job.outputTail + chunk.toString()).slice(-4000);
    });
    child.on('exit', (code) => {
      job.status = code === 0 ? 'completed' : 'failed';
      job.exitCode = code;
    });
    child.unref();
    backgroundJobs.set(jobId, job);
    return { ok: true, background: true, jobId, pid: child.pid, cwd, command };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 25000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      ok: true,
      background: false,
      exitCode: 0,
      cwd,
      stdout: stdout.slice(0, 16000),
      stderr: stderr.slice(0, 4000),
    };
  } catch (err) {
    const e = err;
    return {
      ok: false,
      background: false,
      exitCode: typeof e?.code === 'number' ? e.code : 1,
      cwd,
      stdout: String(e?.stdout || '').slice(0, 16000),
      stderr: String(e?.stderr || e?.message || 'Command failed').slice(0, 4000),
    };
  }
}

async function handleBrowserAutomation(body) {
  const targetUrl = String(body.targetUrl || '').trim();
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const arrangeSteps = steps.filter(
    (st) => st && String(st.action || '').toLowerCase() === 'arrange_windows'
  );
  const webSteps = steps.filter(
    (st) => st && String(st.action || '').toLowerCase() !== 'arrange_windows'
  );
  const isDesktopTarget = targetUrl.toLowerCase().startsWith('desktop://');

  const sidecarCandidates = [
    path.resolve(process.cwd(), 'src-tauri/automation-sidecar/runner.mjs'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src-tauri/automation-sidecar/runner.mjs'),
  ];
  const sidecar = sidecarCandidates.find((p) => fs.existsSync(p));

  let browserResult = null;
  if (!isDesktopTarget) {
    if (sidecar && webSteps.length > 0) {
      const planFile = path.join(os.tmpdir(), `shadow_plan_${Date.now()}.json`);
      await fsp.writeFile(
        planFile,
        JSON.stringify({ goal: body.goal || 'Browser Task', targetUrl, steps: webSteps }, null, 2)
      );
      try {
        const { stdout, stderr } = await execAsync(
          `${JSON.stringify(process.execPath)} ${JSON.stringify(sidecar)} ${JSON.stringify(planFile)}`,
          { timeout: 30000 }
        );
        await fsp.unlink(planFile).catch(() => {});
        browserResult = {
          ok: true,
          mode: 'playwright-headful',
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
      } catch {
        await fsp.unlink(planFile).catch(() => {});
        // Fall back to opening in system browser if Playwright isn't installed yet
      }
    }

    if (!browserResult && targetUrl) {
      if (process.platform === 'darwin') {
        await execAsync(`open ${JSON.stringify(targetUrl)}`);
      } else if (process.platform === 'win32') {
        await execAsync(`cmd /c start "" ${JSON.stringify(targetUrl)}`);
      } else {
        await execAsync(`xdg-open ${JSON.stringify(targetUrl)}`);
      }
      browserResult = { ok: true, mode: 'system-browser', targetUrl };
    }
  }

  let arrangeResult = null;
  if (arrangeSteps.length > 0 || body.layout) {
    const lastStep = arrangeSteps[arrangeSteps.length - 1] || {};
    arrangeResult = await arrangeWindowsOnScreen({
      layout: lastStep.selector || body.layout || 'grid',
      apps: lastStep.value || body.apps || '',
      gap: body.gap,
    });
  }

  if (arrangeResult && browserResult) {
    return {
      ...browserResult,
      ok: Boolean(browserResult.ok && arrangeResult.ok),
      windowArrangement: arrangeResult,
      stdout: `${browserResult.stdout ? `${browserResult.stdout}\n` : ''}${arrangeResult.message || ''}`.trim(),
    };
  }
  if (arrangeResult) {
    return {
      ...arrangeResult,
      mode: 'laptop-window-manager',
      stdout: JSON.stringify(arrangeResult),
    };
  }
  return browserResult || { ok: true, mode: 'system-browser', targetUrl };
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  // Unauthenticated loopback status check (no sensitive files or tokens leaked)
  if (req.method === 'GET' && reqUrl.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'shadow-laptop-agent',
      platform: process.platform,
      arch: os.arch(),
      hostname: os.hostname(),
      homeDir: os.homedir(),
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      jobsCount: backgroundJobs.size,
    });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Unauthorized: provide valid x-shadow-token from ~/.shadow-agent/token.txt',
    });
  }

  try {
    if (req.method === 'GET' && reqUrl.pathname === '/auth-verify') {
      return sendJson(res, 200, { ok: true, authenticated: true });
    }

    if (req.method === 'GET' && reqUrl.pathname === '/jobs') {
      return sendJson(res, 200, {
        ok: true,
        jobs: Array.from(backgroundJobs.values()).slice(-30).reverse(),
      });
    }

    const body = req.method === 'POST' ? await readJsonBody(req) : {};

    if (req.method === 'POST' && reqUrl.pathname === '/jobs/kill') {
      const jobId = String(body.jobId || '');
      const job = backgroundJobs.get(jobId);
      if (!job || !job.pid) {
        return sendJson(res, 404, { ok: false, error: 'Background job not found' });
      }
      try {
        process.kill(job.pid);
        job.status = 'killed';
      } catch {
        // already exited
      }
      return sendJson(res, 200, { ok: true, job });
    }

    if (req.method === 'POST' && reqUrl.pathname === '/files') {
      return sendJson(res, 200, await handleFileOperation(body));
    }

    if (req.method === 'POST' && reqUrl.pathname === '/apps') {
      return sendJson(res, 200, await handleAppControl(body));
    }

    if (req.method === 'POST' && reqUrl.pathname === '/terminal') {
      return sendJson(res, 200, await handleTerminalCommand(body));
    }

    if (req.method === 'POST' && reqUrl.pathname === '/browser') {
      return sendJson(res, 200, await handleBrowserAutomation(body));
    }

    return sendJson(res, 404, { ok: false, error: 'Unknown agent endpoint' });
  } catch (err) {
    return sendJson(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : 'Agent request failed',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('==========================================================');
  console.log(' Shadow Laptop Agent — Running Locally');
  console.log(` Endpoint : http://${HOST}:${PORT}`);
  console.log(` Platform : ${process.platform} (${os.arch()})`);
  console.log(` Pairing Token : ${PAIRING_TOKEN}`);
  console.log(` Token Saved At: ${TOKEN_FILE}`);
  console.log('==========================================================');
  console.log('Paste the Pairing Token into Shadow -> Desktop to connect.');
});
