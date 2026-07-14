fn main() {
    configure_windows_crt();
    tauri_build::build()
}

fn configure_windows_crt() {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        return;
    }

    let target_features = std::env::var("CARGO_CFG_TARGET_FEATURE").unwrap_or_default();
    assert!(
        target_features
            .split(',')
            .any(|feature| feature == "crt-static"),
        "Windows MSVC builds must enable the Rust crt-static target feature"
    );

    // Tauri 2.11's legacy override statically links VCRUNTIME but explicitly selects
    // the dynamic UCRT import library. Let Rust's `crt-static` selection control the
    // complete CRT family instead.
    std::env::set_var("STATIC_VCRUNTIME", "false");
}
