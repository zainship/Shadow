use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnvironment {
    pub is_tauri: bool,
    pub os: String,
    pub arch: String,
    pub sidecar_available: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPlan {
    pub goal: String,
    pub target_url: String,
    pub steps: Vec<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAutomationResponse {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

fn resolve_home_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "~" {
        return dirs_home();
    }
    if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        return dirs_home().join(rest);
    }
    PathBuf::from(trimmed)
}

fn dirs_home() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Ok(p) = std::env::var("USERPROFILE") {
        return PathBuf::from(p);
    }
    if let Ok(h) = std::env::var("HOME") {
        return PathBuf::from(h);
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn resolve_sidecar_path() -> PathBuf {
    let candidates = [
        PathBuf::from("src-tauri/automation-sidecar/runner.mjs"),
        PathBuf::from("automation-sidecar/runner.mjs"),
    ];
    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("src-tauri/automation-sidecar/runner.mjs")
}

fn resolve_agent_script_path() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("scripts/shadow-laptop-agent.mjs"),
        PathBuf::from("../scripts/shadow-laptop-agent.mjs"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

const SERVER_PORT: u16 = 3000;

fn server_port_reachable(timeout: Duration) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{}", SERVER_PORT)
        .parse()
        .expect("static server address must parse");
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// Poll 127.0.0.1:SERVER_PORT until it accepts connections or the server
/// process dies, whichever comes first.
fn wait_for_server(deadline: Duration, mut child: Option<&mut std::process::Child>) -> bool {
    let start = Instant::now();
    loop {
        if server_port_reachable(Duration::from_millis(300)) {
            return true;
        }
        let exited = match child.as_deref_mut() {
            Some(c) => c
                .try_wait()
                .map(|status| status.is_some())
                .unwrap_or(false),
            None => false,
        };
        if exited {
            return false;
        }
        if start.elapsed() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(250));
    }
    server_port_reachable(Duration::from_millis(300))
}

/// Locate the Shadow repository checkout that powers this desktop shell.
/// Order: explicit SHADOW_PROJECT_ROOT override, the working directory,
/// directories above the executable (repo / src-tauri / target/release),
/// then ~/Shadow.
fn find_project_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(root) = std::env::var("SHADOW_PROJECT_ROOT") {
        if !root.trim().is_empty() {
            candidates.push(PathBuf::from(root.trim()));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..4 {
            match dir {
                Some(d) => {
                    candidates.push(d.clone());
                    dir = d.parent().map(|p| p.to_path_buf());
                }
                None => break,
            }
        }
    }
    candidates.push(dirs_home().join("Shadow"));
    candidates.into_iter().find(|d| {
        d.join("server.ts").is_file() && d.join("package.json").is_file()
    })
}

fn spawn_server_process(root: &Path, use_tsx: bool) -> Option<std::process::Child> {
    let data_dir = root.join("data");
    fs::create_dir_all(&data_dir).ok()?;
    let out = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("server.log"))
        .ok()?;
    let err = out.try_clone().ok()?;

    let mut cmd = Command::new("node");
    if use_tsx {
        // Older Node (< 23.6) cannot run TypeScript directly; the repo's
        // devDependency tsx can, without needing npx/network.
        cmd.arg(root.join("node_modules").join("tsx").join("dist").join("cli.mjs"));
    }
    cmd.arg("server.ts");
    cmd.current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().ok()
}

/// The packaged app serves the UI itself, but the API/voice server is the
/// Node process in the Shadow checkout. Make the app self-sufficient: if
/// nothing is listening on 127.0.0.1:3000, start it before the window opens.
/// The spawned server is left running when the app closes so the Morning
/// Brief scheduler keeps ticking; logs land in <repo>/data/server.log.
fn ensure_local_server() {
    if server_port_reachable(Duration::from_millis(600)) {
        return;
    }
    let Some(root) = find_project_root() else {
        return;
    };

    // Node >= 23.6 strips TypeScript natively (same as `npm start`).
    if let Some(mut child) = spawn_server_process(&root, false) {
        if wait_for_server(Duration::from_secs(8), Some(&mut child)) {
            return;
        }
        let _ = child.kill();
        // Older Node: fall back to the bundled tsx runner.
        if let Some(mut tsx_child) = spawn_server_process(&root, true) {
            let _ = wait_for_server(Duration::from_secs(15), Some(&mut tsx_child));
        }
    }
}

#[tauri::command]
fn get_runtime_environment() -> RuntimeEnvironment {
    let sidecar = resolve_sidecar_path();
    RuntimeEnvironment {
        is_tauri: true,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        sidecar_available: sidecar.exists(),
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http/https URLs are permitted".to_string());
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", &url]).status();

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("Browser launcher exited with status {}", s)),
        Err(e) => Err(format!("Failed to launch URL: {}", e)),
    }
}

#[tauri::command]
fn execute_browser_automation(plan_json: String) -> Result<DesktopAutomationResponse, String> {
    let parsed: AutomationPlan =
        serde_json::from_str(&plan_json).map_err(|e| format!("Invalid plan JSON: {}", e))?;
    let serialized =
        serde_json::to_string_pretty(&parsed).map_err(|e| format!("Serialization error: {}", e))?;

    let temp_path = std::env::temp_dir().join("shadow_automation_plan.json");
    fs::write(&temp_path, serialized)
        .map_err(|e| format!("Failed writing temp automation plan: {}", e))?;

    let is_desktop_layout = parsed.target_url.to_lowercase().starts_with("desktop://");
    if is_desktop_layout {
        let arrange_step = parsed
            .steps
            .iter()
            .find(|s| s.get("action").and_then(|v| v.as_str()) == Some("arrange_windows"));
        let layout = arrange_step
            .and_then(|s| s.get("selector").and_then(|v| v.as_str()))
            .unwrap_or("grid")
            .to_string();
        let apps_str = arrange_step
            .and_then(|s| s.get("value").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();
        let res = control_local_app(
            "arrange_windows".to_string(),
            None,
            Some(layout),
            if apps_str.is_empty() { None } else { Some(apps_str) },
        )?;
        return Ok(DesktopAutomationResponse {
            ok: res.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
            stdout: res.to_string(),
            stderr: String::new(),
        });
    }

    let sidecar = resolve_sidecar_path();
    if !sidecar.exists() {
        open_external_url(parsed.target_url.clone())?;
        return Ok(DesktopAutomationResponse {
            ok: true,
            stdout: serde_json::json!({
                "mode": "system-browser-fallback",
                "targetUrl": parsed.target_url,
                "message": "Opened URL in laptop default browser."
            })
            .to_string(),
            stderr: String::new(),
        });
    }

    let output = Command::new("node")
        .arg(&sidecar)
        .arg(&temp_path)
        .output()
        .map_err(|e| format!("Failed to spawn Playwright sidecar: {}", e))?;

    Ok(DesktopAutomationResponse {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn search_dir_recursive(dir: &Path, needle: &str, out: &mut Vec<serde_json::Value>, depth: usize) {
    if depth > 4 || out.len() >= 40 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= 40 {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || name == ".git" || name == "target" {
            continue;
        }
        let path = entry.path();
        let is_dir = path.is_dir();
        if name.to_lowercase().contains(needle) {
            out.push(serde_json::json!({
                "name": name,
                "path": path.to_string_lossy(),
                "type": if is_dir { "directory" } else { "file" }
            }));
        }
        if is_dir {
            search_dir_recursive(&path, needle, out, depth + 1);
        }
    }
}

#[tauri::command]
fn manage_local_files(
    operation: String,
    path: String,
    destination_path: Option<String>,
    content: Option<String>,
    pattern: Option<String>,
) -> Result<serde_json::Value, String> {
    let target = resolve_home_path(&path);
    match operation.to_lowercase().as_str() {
        "read" => {
            let text = fs::read_to_string(&target).map_err(|e| format!("Read failed: {}", e))?;
            let truncated = text.len() > 24000;
            let slice: String = text.chars().take(24000).collect();
            Ok(serde_json::json!({
                "ok": true,
                "operation": "read",
                "path": target.to_string_lossy(),
                "content": slice,
                "truncated": truncated
            }))
        }
        "write" => {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Mkdir failed: {}", e))?;
            }
            let body = content.unwrap_or_default();
            fs::write(&target, &body).map_err(|e| format!("Write failed: {}", e))?;
            Ok(serde_json::json!({
                "ok": true,
                "operation": "write",
                "path": target.to_string_lossy(),
                "bytesWritten": body.len()
            }))
        }
        "append" => {
            use std::io::Write;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Mkdir failed: {}", e))?;
            }
            let body = content.unwrap_or_default();
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&target)
                .map_err(|e| format!("Append open failed: {}", e))?;
            file.write_all(body.as_bytes())
                .map_err(|e| format!("Append write failed: {}", e))?;
            Ok(serde_json::json!({
                "ok": true,
                "operation": "append",
                "path": target.to_string_lossy(),
                "bytesWritten": body.len()
            }))
        }
        "list" => {
            let entries = fs::read_dir(&target).map_err(|e| format!("List failed: {}", e))?;
            let mut items = Vec::new();
            for entry in entries.flatten().take(120) {
                let p = entry.path();
                let meta = fs::metadata(&p).ok();
                items.push(serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "path": p.to_string_lossy(),
                    "type": if p.is_dir() { "directory" } else { "file" },
                    "size": meta.map(|m| m.len()).unwrap_or(0)
                }));
            }
            Ok(serde_json::json!({
                "ok": true,
                "operation": "list",
                "path": target.to_string_lossy(),
                "count": items.len(),
                "items": items
            }))
        }
        "mkdir" => {
            fs::create_dir_all(&target).map_err(|e| format!("Mkdir failed: {}", e))?;
            Ok(serde_json::json!({ "ok": true, "operation": "mkdir", "path": target.to_string_lossy() }))
        }
        "move" => {
            let dest = resolve_home_path(&destination_path.ok_or("destinationPath required")?);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Mkdir failed: {}", e))?;
            }
            fs::rename(&target, &dest).map_err(|e| format!("Move failed: {}", e))?;
            Ok(serde_json::json!({
                "ok": true,
                "operation": "move",
                "path": target.to_string_lossy(),
                "destinationPath": dest.to_string_lossy()
            }))
        }
        "copy" => {
            let dest = resolve_home_path(&destination_path.ok_or("destinationPath required")?);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Mkdir failed: {}", e))?;
            }
            fs::copy(&target, &dest).map_err(|e| format!("Copy failed: {}", e))?;
            Ok(serde_json::json!({
                "ok": true,
                "operation": "copy",
                "path": target.to_string_lossy(),
                "destinationPath": dest.to_string_lossy()
            }))
        }
        "delete" => {
            if target.is_dir() {
                fs::remove_dir_all(&target).map_err(|e| format!("Delete dir failed: {}", e))?;
            } else {
                fs::remove_file(&target).map_err(|e| format!("Delete file failed: {}", e))?;
            }
            Ok(serde_json::json!({ "ok": true, "operation": "delete", "path": target.to_string_lossy() }))
        }
        "search" => {
            let needle = pattern.unwrap_or_default().to_lowercase();
            let mut matches = Vec::new();
            search_dir_recursive(&target, &needle, &mut matches, 0);
            Ok(serde_json::json!({
                "ok": true,
                "operation": "search",
                "path": target.to_string_lossy(),
                "matches": matches
            }))
        }
        other => Err(format!("Unsupported operation: {}", other)),
    }
}

#[tauri::command]
fn control_local_app(
    action: String,
    app_name: Option<String>,
    instruction: Option<String>,
    args: Option<String>,
) -> Result<serde_json::Value, String> {
    let app = app_name.unwrap_or_default();
    let instr = instruction.unwrap_or_default();
    let arg = args.unwrap_or_default();

    match action.to_lowercase().as_str() {
        "system_info" => Ok(serde_json::json!({
            "ok": true,
            "action": "system_info",
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "homeDir": dirs_home().to_string_lossy()
        })),
        "open_app" => {
            if app.is_empty() {
                return Err("appName is required".to_string());
            }
            #[cfg(target_os = "macos")]
            let status = {
                let mut cmd = Command::new("open");
                cmd.args(["-a", &app]);
                if !arg.is_empty() {
                    cmd.arg(resolve_home_path(&arg));
                }
                cmd.status()
            };
            #[cfg(target_os = "windows")]
            let status = {
                let mut cmd = Command::new("cmd");
                if arg.is_empty() {
                    cmd.args(["/C", "start", "", &app]);
                } else {
                    cmd.args(["/C", "start", "", &app, &arg]);
                }
                cmd.status()
            };
            #[cfg(target_os = "linux")]
            let status = {
                let mut cmd = Command::new(&app);
                if !arg.is_empty() {
                    cmd.arg(&arg);
                }
                cmd.spawn().map(|_| std::process::ExitStatus::default())
            };
            match status {
                Ok(_) => Ok(serde_json::json!({ "ok": true, "action": "open_app", "appName": app })),
                Err(e) => Err(format!("Failed to open {}: {}", app, e)),
            }
        }
        "focus_app" => {
            #[cfg(target_os = "macos")]
            let _ = Command::new("osascript")
                .args(["-e", &format!("tell application \"{}\" to activate", app)])
                .status();
            #[cfg(target_os = "windows")]
            let _ = Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!("(New-Object -ComObject WScript.Shell).AppActivate('{}')", app),
                ])
                .status();
            #[cfg(target_os = "linux")]
            let _ = Command::new("wmctrl").args(["-a", &app]).status();
            Ok(serde_json::json!({ "ok": true, "action": "focus_app", "appName": app }))
        }
        "quit_app" => {
            #[cfg(target_os = "macos")]
            let _ = Command::new("osascript")
                .args(["-e", &format!("tell application \"{}\" to quit", app)])
                .status();
            #[cfg(target_os = "windows")]
            let _ = Command::new("taskkill")
                .args(["/IM", &format!("{}.exe", app), "/T", "/F"])
                .status();
            #[cfg(target_os = "linux")]
            let _ = Command::new("pkill").args(["-f", &app]).status();
            Ok(serde_json::json!({ "ok": true, "action": "quit_app", "appName": app }))
        }
        "automate_app" => {
            #[cfg(target_os = "macos")]
            let output = {
                let script = if app.is_empty() {
                    instr.clone()
                } else {
                    format!("tell application \"{}\"\nactivate\n{}\nend tell", app, instr)
                };
                Command::new("osascript").args(["-e", &script]).output()
            };
            #[cfg(target_os = "windows")]
            let output = Command::new("powershell")
                .args(["-NoProfile", "-Command", &instr])
                .output();
            #[cfg(target_os = "linux")]
            let output = Command::new("sh").args(["-c", &instr]).output();
            let out = output.map_err(|e| format!("App automation failed: {}", e))?;
            Ok(serde_json::json!({
                "ok": out.status.success(),
                "action": "automate_app",
                "stdout": String::from_utf8_lossy(&out.stdout),
                "stderr": String::from_utf8_lossy(&out.stderr)
            }))
        }
        "list_apps" => {
            #[cfg(target_os = "macos")]
            let out = Command::new("osascript")
                .args(["-e", "tell application \"System Events\" to get name of (processes where background only is false)"])
                .output();
            #[cfg(target_os = "windows")]
            let out = Command::new("powershell")
                .args(["-NoProfile", "-Command", "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty ProcessName -Unique"])
                .output();
            #[cfg(target_os = "linux")]
            let out = Command::new("sh")
                .args(["-c", "ps -eo comm --no-headers | sort -u | head -n 40"])
                .output();
            let res = out.map_err(|e| format!("Failed listing apps: {}", e))?;
            let raw = String::from_utf8_lossy(&res.stdout).to_string();
            let apps: Vec<String> = raw
                .split(|c| c == ',' || c == '\n' || c == '\r')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            Ok(serde_json::json!({ "ok": true, "action": "list_apps", "runningApps": apps }))
        }
        "arrange_windows" => {
            let layout = if instr.is_empty() { "grid" } else { instr.as_str() };
            let target_apps: Vec<String> = if !arg.is_empty() {
                arg.split(|c| c == ',' || c == ';' || c == '\n')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else if !app.is_empty() {
                vec![app.clone()]
            } else {
                Vec::new()
            };
            let count = target_apps.len().max(1);
            let cols = if layout == "side-by-side" {
                count
            } else {
                (count as f64).sqrt().ceil() as usize
            };
            let rows = (count + cols - 1) / cols;
            #[cfg(target_os = "macos")]
            {
                let mut script_lines = Vec::new();
                let w = 1440 / cols.max(1);
                let h = 875 / rows.max(1);
                for (idx, a) in target_apps.iter().enumerate() {
                    let col = idx % cols;
                    let row = idx / cols;
                    let x = col * w;
                    let y = 25 + row * h;
                    let safe = a.replace('"', "\\\"");
                    script_lines.push(format!(
                        "try\n tell application \"System Events\" to tell process \"{}\" to set {{position of window 1, size of window 1}} to {{{{{}, {}}}, {{{}, {}}}}}\nend try",
                        safe, x, y, w, h
                    ));
                }
                if !script_lines.is_empty() {
                    let _ = Command::new("osascript").args(["-e", &script_lines.join("\n")]).output();
                }
            }
            #[cfg(target_os = "linux")]
            {
                let w = 1920 / cols.max(1);
                let h = 1020 / rows.max(1);
                for (idx, a) in target_apps.iter().enumerate() {
                    let col = idx % cols;
                    let row = idx / cols;
                    let x = col * w;
                    let y = 28 + row * h;
                    let _ = Command::new("sh")
                        .args(["-c", &format!("xdotool search --name \"{}\" windowmove {} {} windowsize {} {}", a.replace('"', "\\\""), x, y, w, h)])
                        .output();
                }
            }
            Ok(serde_json::json!({
                "ok": true,
                "action": "arrange_windows",
                "layout": layout,
                "apps": target_apps,
                "message": format!("Arranged {} window(s) in {} layout.", target_apps.len(), layout)
            }))
        }
        other => Err(format!("Unsupported app action: {}", other)),
    }
}

#[tauri::command]
fn execute_local_terminal(
    command: String,
    cwd: Option<String>,
    background: Option<bool>,
) -> Result<serde_json::Value, String> {
    let dir = cwd
        .map(|c| resolve_home_path(&c))
        .unwrap_or_else(dirs_home);
    let run_bg = background.unwrap_or(false);

    if run_bg {
        #[cfg(target_os = "windows")]
        let child = Command::new("cmd")
            .args(["/C", &command])
            .current_dir(&dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        #[cfg(not(target_os = "windows"))]
        let child = Command::new("sh")
            .args(["-c", &command])
            .current_dir(&dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        let spawned = child.map_err(|e| format!("Background spawn failed: {}", e))?;
        return Ok(serde_json::json!({
            "ok": true,
            "background": true,
            "pid": spawned.id(),
            "cwd": dir.to_string_lossy(),
            "command": command
        }));
    }

    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", &command])
        .current_dir(&dir)
        .output();
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .args(["-c", &command])
        .current_dir(&dir)
        .output();

    let out = output.map_err(|e| format!("Terminal command failed: {}", e))?;
    Ok(serde_json::json!({
        "ok": out.status.success(),
        "background": false,
        "exitCode": out.status.code().unwrap_or(1),
        "cwd": dir.to_string_lossy(),
        "stdout": String::from_utf8_lossy(&out.stdout),
        "stderr": String::from_utf8_lossy(&out.stderr)
    }))
}

#[tauri::command]
fn launch_background_agent() -> Result<serde_json::Value, String> {
    let script = resolve_agent_script_path()
        .ok_or_else(|| "Could not find scripts/shadow-laptop-agent.mjs".to_string())?;
    let output = Command::new("node")
        .arg(&script)
        .arg("--daemon")
        .output()
        .map_err(|e| format!("Failed launching background agent: {}", e))?;
    let token_path = dirs_home().join(".shadow-agent").join("token.txt");
    let token = fs::read_to_string(&token_path).unwrap_or_default().trim().to_string();
    Ok(serde_json::json!({
        "ok": output.status.success(),
        "stdout": String::from_utf8_lossy(&output.stdout),
        "stderr": String::from_utf8_lossy(&output.stderr),
        "token": token
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_local_server();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_runtime_environment,
            open_external_url,
            execute_browser_automation,
            manage_local_files,
            control_local_app,
            execute_local_terminal,
            launch_background_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shadow Desktop Tauri application");
}
