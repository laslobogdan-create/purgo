# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What gets signed

Only the official Windows release binaries of Purgo (`Purgo-<version>-Portable.exe`) that are published on
[GitHub Releases](https://github.com/laslobogdan-create/purgo/releases). Nothing else is signed with this certificate.

## How release binaries are produced

1. A version tag (`vX.Y.Z`) is pushed to this repository.
2. The [release workflow](.github/workflows/release.yml) builds Purgo on a GitHub-hosted Windows runner, directly from the public source code.
3. The unsigned build is submitted to SignPath. The private signing key is kept by SignPath in a hardware security module; it is never available to the project team or to the build machine.
4. The approver manually reviews and approves the signing request.
5. The signed binary is attached to the GitHub Release.

Binaries built on personal computers are never signed. Third-party code is only included through the
open-source npm dependencies declared in `package.json` / `package-lock.json`.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [Vasili Zaitev](https://github.com/laslobogdan-create) |
| Approvers | [Vasili Zaitev](https://github.com/laslobogdan-create) |

All team members use multi-factor authentication for both GitHub and SignPath.
Contributions from people outside the team (pull requests) are reviewed by a reviewer before they are merged.

## Behaviour of the signed software

- Purgo only removes programs, files, folders and registry entries after the user starts the action and, for single uninstalls, reviews and confirms the list of items.
- Files are moved to the Recycle Bin; registry entries are exported to a backup before removal.
- Purgo does not collect or send any data. See [PRIVACY.md](PRIVACY.md).

## Reporting a problem

If you believe a signed Purgo binary is malicious or was not built from this repository, please
[open an issue](https://github.com/laslobogdan-create/purgo/issues) or contact SignPath Foundation.
