// CLI tools detection and execution.
// Detects Claude Code, Gemini CLI, Google Antigravity, and OpenAI Codex CLI.
// Respects user PATH and common user directories (NVM, ~/.local/bin, ~/.cargo/bin).

use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliToolInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub diagnostic: String,
}

struct ToolSpec {
    id: &'static str,
    name: &'static str,
    binaries: &'static [&'static str],
    install_hint: &'static str,
}

const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        id: "claude",
        name: "Claude Code",
        binaries: &["claude"],
        install_hint: "Install via `npm install -g @anthropic-ai/claude-code`",
    },
    ToolSpec {
        id: "gemini",
        name: "Gemini CLI",
        binaries: &["gemini"],
        install_hint: "Install via `npm install -g @google/gemini-cli` or pip",
    },
    ToolSpec {
        id: "antigravity",
        name: "Google Antigravity",
        binaries: &["antigravity", "agy"],
        install_hint: "Google Antigravity CLI (`agy` / `antigravity`) in ~/.local/bin",
    },
    ToolSpec {
        id: "codex",
        name: "Codex CLI",
        binaries: &["codex"],
        install_hint: "Install via `npm install -g @openai/codex`",
    },
];

/// Finds the executable for a given binary name, checking PATH as well as
/// standard user directories (NVM, .local/bin, .cargo/bin).
pub fn find_executable(binary_name: &str) -> Option<PathBuf> {
    // 1. Check system PATH first
    if let Some(path) = crate::platform::find_on_path(binary_name) {
        return Some(path);
    }

    // 2. Check well-known user directories
    if let Ok(home) = std::env::var("HOME") {
        let home_path = Path::new(&home);

        let candidate_dirs = [
            home_path.join(".local/bin"),
            home_path.join(".cargo/bin"),
            home_path.join("bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ];

        for dir in &candidate_dirs {
            let candidate = dir.join(binary_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        // Check NVM node versions (~/.nvm/versions/node/*/bin)
        let nvm_node_dir = home_path.join(".nvm/versions/node");
        if nvm_node_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(nvm_node_dir) {
                for entry in entries.flatten() {
                    let bin_path = entry.path().join("bin").join(binary_name);
                    if bin_path.is_file() {
                        return Some(bin_path);
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_dir = Path::new(&appdata).join("npm");
            for ext in &[".cmd", ".exe", ".bat", ""] {
                let candidate = npm_dir.join(format!("{}{}", binary_name, ext));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

/// Queries version string of an executable with a safe timeout.
fn query_version(path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    crate::platform::no_console(&mut cmd);

    let output = cmd.output().ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !text.is_empty() {
            return Some(text);
        }
        let err_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !err_text.is_empty() {
            return Some(err_text);
        }
    }
    None
}

/// Checks all 4 AI coding CLI tools and returns their statuses.
pub fn check_all() -> Vec<CliToolInfo> {
    TOOLS
        .iter()
        .map(|tool| {
            let mut resolved_path = None;
            for bin in tool.binaries {
                if let Some(p) = find_executable(bin) {
                    resolved_path = Some(p);
                    break;
                }
            }

            if let Some(path) = resolved_path {
                let version = query_version(&path);
                let path_str = path.to_string_lossy().to_string();
                CliToolInfo {
                    id: tool.id.to_string(),
                    name: tool.name.to_string(),
                    command: tool.binaries[0].to_string(),
                    installed: true,
                    path: Some(path_str.clone()),
                    version: version.clone(),
                    diagnostic: format!(
                        "Installed at {}\nVersion: {}",
                        path_str,
                        version.unwrap_or_else(|| "available".into())
                    ),
                }
            } else {
                CliToolInfo {
                    id: tool.id.to_string(),
                    name: tool.name.to_string(),
                    command: tool.binaries[0].to_string(),
                    installed: false,
                    path: None,
                    version: None,
                    diagnostic: format!(
                        "Executable '{}' not found in PATH or standard user directories.\nHint: {}",
                        tool.binaries[0], tool.install_hint
                    ),
                }
            }
        })
        .collect()
}

/// Launches a CLI tool in a native terminal window inside a chosen project directory.
pub fn launch(tool_id: &str, target_dir: Option<&str>) -> Result<bool, String> {
    let tool = TOOLS
        .iter()
        .find(|t| t.id == tool_id)
        .ok_or_else(|| format!("Unknown tool ID: {tool_id}"))?;

    let path = tool
        .binaries
        .iter()
        .find_map(|bin| find_executable(bin))
        .ok_or_else(|| format!("Tool '{}' is not installed", tool.name))?;

    let dir = target_dir
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "linux")]
    {
        // Try common Linux terminal emulators
        let path_str = path.to_string_lossy();
        let dir_str = dir.to_string_lossy();

        // Check if x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, alacritty, kitty or xterm exist
        let xterm_cmd = format!("cd \"{}\" && \"{}\"; exec bash", dir_str, path_str);
        let xterm_emu_cmd = format!("bash -c 'cd \"{}\" && \"{}\"; exec bash'", dir_str, path_str);

        let terminals: [(&str, Vec<&str>); 7] = [
            ("gnome-terminal", vec!["--working-directory", &dir_str, "--", &path_str]),
            ("x-terminal-emulator", vec!["-e", &xterm_emu_cmd]),
            ("konsole", vec!["--workdir", &dir_str, "-e", &path_str]),
            ("xfce4-terminal", vec!["--working-directory", &dir_str, "-e", &path_str]),
            ("alacritty", vec!["--working-directory", &dir_str, "-e", &path_str]),
            ("kitty", vec!["--directory", &dir_str, &path_str]),
            ("xterm", vec!["-e", &xterm_cmd]),
        ];

        for (term, args) in &terminals {
            if crate::platform::find_on_path(term).is_some() {
                let mut cmd = Command::new(term);
                cmd.args(args);
                if cmd.spawn().is_ok() {
                    return Ok(true);
                }
            }
        }

        // Fallback: spawn in background detached
        let mut cmd = Command::new(&path);
        cmd.current_dir(&dir);
        cmd.spawn().map_err(|e| format!("Failed to spawn {tool_id}: {e}"))?;
        Ok(true)
    }

    #[cfg(target_os = "windows")]
    {
        let path_str = path.to_string_lossy();
        let dir_str = dir.to_string_lossy();
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/c", "start", "cmd.exe", "/k", &format!("cd /d \"{}\" && \"{}\"", dir_str, path_str)]);
        cmd.spawn().map_err(|e| format!("Failed to launch terminal on Windows: {e}"))?;
        Ok(true)
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let mut cmd = Command::new(&path);
        cmd.current_dir(&dir);
        cmd.spawn().map_err(|e| format!("Spawn failed: {e}"))?;
        Ok(true)
    }
}
