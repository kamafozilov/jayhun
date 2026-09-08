#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    jayhun_lib::ensure_macos_dev_bundle();
    jayhun_lib::run()
}
