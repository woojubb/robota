# Security Policy

## Supported Versions

Robota is under active development toward a stable release. Security fixes are applied to the **latest
published release** on the `main` line. Older pre-release versions are not maintained — please upgrade to the
latest release before reporting.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest release | :white_check_mark: |
| Older releases | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Report a vulnerability privately through GitHub's private vulnerability reporting:

- Go to the repository's **Security** tab → **Report a vulnerability**
  (<https://github.com/woojubb/robota/security/advisories/new>).

<!-- maintainers: to enable the "Report a vulnerability" button, turn on
     Settings → Code security and analysis → Private vulnerability reporting. -->

Please include, as much as you can:

- A description of the vulnerability and its impact.
- The affected package(s) / version(s) and, if known, the affected code path.
- Steps to reproduce (a minimal proof of concept is ideal).
- Any suggested remediation.

## What to Expect

- **Acknowledgement**: we aim to acknowledge a report within a few business days.
- **Assessment**: we will investigate, determine severity, and keep you informed of progress.
- **Fix & disclosure**: we will work on a fix and coordinate a disclosure timeline with you. We ask that you
  give us a reasonable window to release a fix before any public disclosure.
- **Credit**: with your permission, we are happy to credit you in the release notes / advisory.

## Scope

This policy covers the code in this repository (the `@robota-sdk/*` packages, the CLI, and the apps under
`apps/`). Vulnerabilities in third-party dependencies should be reported upstream; if a dependency issue
affects Robota, we still want to hear about it so we can pin or patch.

Thank you for helping keep Robota and its users safe.
