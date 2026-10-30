//! Native side of LamsEX: plain file access and file watching.
//! Everything about Minecraft formats lives in the TypeScript front end.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct WatchState {
    watcher: Option<RecommendedWatcher>,
}

#[derive(Clone, Serialize)]
struct FsChange {
    path: String,
}

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// Folder holding the running executable; config.txt and screenshots/ live here.
#[tauri::command]
fn exe_dir() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().unwrap_or(Path::new(".")).to_string_lossy().into_owned())
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Raw body = file bytes, `path` header = URI-encoded target path.
#[tauri::command]
fn write_file(request: tauri::ipc::Request) -> Result<(), String> {
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing path header")?;
    let path = decode_uri(path);
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw body".into());
    };
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

fn decode_uri(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn path_kind(path: String) -> String {
    let p = Path::new(&path);
    if p.is_dir() {
        "dir".into()
    } else if p.is_file() {
        "file".into()
    } else {
        "none".into()
    }
}

/// Recursively list files under `dir`, returned relative to it with forward slashes.
#[tauri::command]
fn list_files(dir: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&dir);
    let mut out = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(rel) = p.strip_prefix(&root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(out)
}

/// Read every model .json under <root>/assets/*/models in one call (used to index models).
/// Returns pairs of (path relative to root, file text).
#[tauri::command]
fn read_all_models(root: String) -> Result<Vec<(String, String)>, String> {
    let root = PathBuf::from(&root);
    let assets = root.join("assets");
    let mut out = Vec::new();
    let Ok(namespaces) = std::fs::read_dir(&assets) else { return Ok(out) };
    for ns in namespaces.flatten() {
        let models = ns.path().join("models");
        let mut stack = vec![models];
        while let Some(d) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&d) else { continue };
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().map(|e| e == "json").unwrap_or(false) {
                    if let (Ok(text), Ok(rel)) = (std::fs::read_to_string(&p), p.strip_prefix(&root)) {
                        out.push((rel.to_string_lossy().replace('\\', "/"), text));
                    }
                }
            }
        }
    }
    Ok(out)
}

/// Replace the set of watched files. Parent folders are watched (not the files themselves)
/// so editors that save via temp-file-and-rename are still caught.
#[tauri::command]
fn watch_files(app: AppHandle, state: State<'_, Mutex<WatchState>>, paths: Vec<String>) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    st.watcher = None;
    if paths.is_empty() {
        return Ok(());
    }
    let wanted: HashSet<String> = paths.iter().map(|p| norm(Path::new(p))).collect();
    let originals: Vec<(String, String)> = paths.iter().map(|p| (norm(Path::new(p)), p.clone())).collect();
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, EventKind::Access(_)) {
            return;
        }
        for p in &ev.paths {
            let key = norm(p);
            if wanted.contains(&key) {
                let original = originals.iter().find(|(k, _)| *k == key).map(|(_, o)| o.clone()).unwrap_or(key);
                let _ = handle.emit("fs-change", FsChange { path: original });
            }
        }
    })
    .map_err(|e| e.to_string())?;
    let dirs: HashSet<PathBuf> = paths
        .iter()
        .filter_map(|p| Path::new(p).parent().map(|d| d.to_path_buf()))
        .collect();
    for d in dirs {
        let _ = watcher.watch(&d, RecursiveMode::NonRecursive);
    }
    st.watcher = Some(watcher);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(Mutex::new(WatchState::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            exe_dir,
            read_file,
            read_text,
            write_file,
            path_kind,
            list_files,
            read_all_models,
            watch_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running LamsEX");
}
