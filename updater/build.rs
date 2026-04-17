fn main() {
    #[cfg(windows)]
    {
        // Embed the Windows resource (icon + application manifest).
        let _ = embed_resource::compile("assets/app.rc", embed_resource::NONE);
        println!("cargo:rerun-if-changed=assets/app.rc");
        println!("cargo:rerun-if-changed=assets/app.manifest");
        println!("cargo:rerun-if-changed=assets/app.ico");
    }
}
