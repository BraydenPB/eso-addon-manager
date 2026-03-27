# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ESO Addon Manager, please report it responsibly.

**Do not open a public issue.** Instead, email your report to the maintainers or use [GitHub's private vulnerability reporting](https://github.com/BraydenPB/eso-addon-manager/security/advisories/new).

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Scope

The following are in scope:

- Path traversal or arbitrary file access via Tauri IPC commands
- ZIP extraction vulnerabilities (zip bombs, symlink attacks)
- Cross-site scripting (XSS) in the webview
- CSP bypasses
- Dependency vulnerabilities with known exploits

Out of scope:

- Issues requiring physical access to the machine
- Social engineering attacks
- Denial of service against ESOUI (rate limiting is already implemented)
