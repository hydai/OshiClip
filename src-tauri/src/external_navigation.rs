use url::Url;

pub(crate) fn can_open_in_system_browser(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some()
}

#[cfg(test)]
mod tests {
    use super::can_open_in_system_browser;
    use url::Url;

    #[test]
    fn allows_secure_web_links() {
        let url = Url::parse("https://www.youtube.com/watch?v=example&t=30s").unwrap();
        assert!(can_open_in_system_browser(&url));
    }

    #[test]
    fn rejects_insecure_and_non_web_schemes() {
        for url in [
            "http://example.com/",
            "file:///tmp/example",
            "javascript:alert(1)",
            "oshiclip://download?url=example",
        ] {
            assert!(!can_open_in_system_browser(&Url::parse(url).unwrap()));
        }
    }
}
