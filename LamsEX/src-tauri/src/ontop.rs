//! "Stay on top while another app is in front": while the foreground window belongs to one of
//! the listed programs (Paint.NET by default), LamsEX is made always-on-top so it floats over
//! the editor. Clicking into LamsEX keeps it that way; switching to any other program drops it.
//! Windows only; elsewhere the setting is accepted and ignored.

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

pub struct OnTop {
    /// Lower-case exe file names, e.g. "paintdotnet.exe". Empty = feature off.
    names: Arc<Mutex<Vec<String>>>,
}

impl OnTop {
    pub fn start(app: AppHandle) -> Self {
        let names = Arc::new(Mutex::new(Vec::new()));
        #[cfg(windows)]
        {
            let names = names.clone();
            std::thread::spawn(move || win::run(app, names));
        }
        #[cfg(not(windows))]
        let _ = app;
        OnTop { names }
    }
}

/// Program names (with or without ".exe") that LamsEX should float over. Empty turns it off.
#[tauri::command]
pub fn set_on_top_with(state: State<'_, OnTop>, names: Vec<String>) {
    let list = names
        .iter()
        .map(|n| n.trim().to_lowercase())
        .filter(|n| !n.is_empty())
        .map(|n| if n.ends_with(".exe") { n } else { format!("{n}.exe") })
        .collect();
    if let Ok(mut g) = state.names.lock() {
        *g = list;
    }
}

#[cfg(windows)]
mod win {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tauri::{AppHandle, Manager};
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    fn foreground_pid() -> Option<u32> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            (pid != 0).then_some(pid)
        }
    }

    fn exe_name(pid: u32) -> Option<String> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            if ok == 0 {
                return None;
            }
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            Some(full.rsplit(['\\', '/']).next().unwrap_or(&full).to_lowercase())
        }
    }

    pub fn run(app: AppHandle, names: Arc<Mutex<Vec<String>>>) {
        let me = std::process::id();
        let mut on_top = false;
        loop {
            std::thread::sleep(Duration::from_millis(200));
            let list = names.lock().map(|g| g.clone()).unwrap_or_default();
            let want = if list.is_empty() {
                false
            } else {
                match foreground_pid() {
                    // Our own window (or our file dialog) in front: keep whatever we had.
                    Some(pid) if pid == me => on_top,
                    Some(pid) => exe_name(pid).map(|n| list.contains(&n)).unwrap_or(false),
                    // Nothing in front (e.g. mid Alt+Tab): no change.
                    None => on_top,
                }
            };
            if want != on_top {
                if let Some(win) = app.get_webview_window("main") {
                    if win.set_always_on_top(want).is_ok() {
                        on_top = want;
                    }
                }
            }
        }
    }
}
