# Quota JemaOS

Native desktop tool that provisions and verifies the **signed installation quota**
on a JemaOS USB key. It writes a countersigned file to the key's EFI System
Partition so the JemaOS installer can enforce how many machines a single key may
install.

- Native desktop window (Electron + IPC).
- Linux, macOS and Windows from one code base.
- French / English UI, light / dark theme.
- GUI, plus a headless CLI for support.

---

## Install

Prebuilt installers are attached to each [release](https://github.com/JemaOS/jemaos-usb-quota-gui/releases).

| Platform | Artifact |
| --- | --- |
| Linux (portable) | `Quota-JemaOS-<version>-linux-<arch>.AppImage` |
| Linux (Debian/Ubuntu) | `jemaos-usb-quota-gui_<version>_amd64.deb` |
| Windows 10/11 x64 | `Quota-JemaOS-<version>-windows-x64-Portable.exe` |
| macOS Intel | `Quota-JemaOS-<version>-macos-x64.dmg` |
| macOS Apple Silicon | `Quota-JemaOS-<version>-macos-arm64.dmg` |

Verify downloads against `SHA256SUMS`.

- **Linux (`.deb`)**: install the package, then open **Quota JemaOS** from the
  applications menu (or run `quota-jemaos` in a terminal).
- **Linux (AppImage)**: mark it executable and run it. If FUSE is unavailable,
  run it with `--appimage-extract-and-run`.
- **Windows**: run the portable `.exe`. No installation and no Node.js required.
- **macOS**: open the DMG for your architecture and drag the app to Applications.

> Release builds are **not** signed with a trusted publisher identity. macOS
> builds are ad-hoc signed (integrity only, not notarized) and Windows builds are
> unsigned. The OS may show a trust warning on first launch.

---

## Usage

1. Plug in the JemaOS USB key that has already been flashed.
2. Select the key. The app auto-selects a removable disk that exposes exactly one
   EFI System Partition; internal and system disks are never selected.
3. Set the install limit — type a value or use a preset
   (1, 10, 50, 100, 500, 1 000, 10 000).
4. Click **Initialize key**. The app re-reads the file afterwards and verifies its
   signature. Initialization resets the used counter to zero.

The tool never formats or reflashes the disk. It only writes one small file on the
existing EFI System Partition.

---

## Quota file format

Location on the ESP:

```
<ESP>/efi/boot/jemaos-quota.cfg
```

Contents (GRUB-sourceable):

```
# JemaOS install quota - signed, do not edit
set jemaos_quota_limit=100
set jemaos_quota_used=0
set jemaos_quota_sig=<signature>
```

Signature rules (must match the JemaOS image and installer exactly):

- Message: the string `"<limit>|<used>"`, e.g. `100|0`.
- Algorithm: HMAC-SHA256, lowercase hexadecimal output.
- Key: the bytes of `resources/jemaos-quota.key` **without trailing newlines**,
  matching `$(cat KEY)` in the vendor shell tooling.
- The key must be identical to `/usr/share/jemaos/quota.key` inside the image.

Writes are atomic: a temporary file is written, `fsync`-ed, then renamed over the
target.

---

## Architecture

```
electron/        Native window (main + preload bridge)
ui/              Renderer (HTML/CSS/JS), FR/EN, light/dark
src/core/        Provider-agnostic logic
src/platform/    Per-OS device and mount backends
bin/             Privileged helper and CLI
scripts/         Build, icon generation, packaging, release checks
test/            Regression tests (no real USB operations)
resources/       Vendor HMAC key
```

Request flow:

```
renderer (ui/app.js)
  └─ window.jemaos.invoke(action, payload)      # contextBridge
       └─ ipcMain handler (electron/main.js)
            └─ src/core/service.js
                 ├─ elevated?  → src/core/esp-ops.js
                 └─ otherwise  → privileged helper via OS elevator
```

- `electron/preload.js` exposes a fixed, allow-listed `invoke` bridge.
- `electron/main.js` validates every request (sender frame and URL, channel,
  payload shape) and disables navigation and window.open.
- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
  keeps the Chromium sandbox on macOS and Windows.

### Core modules

| Module | Responsibility |
| --- | --- |
| `src/core/crypto.js` | HMAC-SHA256, byte-compatible with `openssl dgst -sha256 -hmac`. |
| `src/core/quota.js` | Render / parse / verify the counter file; atomic write. |
| `src/core/esp-ops.js` | Find the ESP, mount it, read/write, unmount; target validation. |
| `src/core/service.js` | Orchestration, request validation, privilege delegation. |
| `src/core/elevation.js` | Builds the elevated helper command per OS. |
| `src/platform/*.js` | Disk enumeration, ESP detection and mounting per OS. |

---

## Privilege model

The GUI runs as the normal user. Only the storage operation is elevated, and only
when the process is not already privileged:

| OS | Disk tooling | Elevation |
| --- | --- | --- |
| Linux | `lsblk`, `mount` | `pkexec` (polkit) |
| macOS | `diskutil`, `plutil`, `mount` | `osascript` "with administrator privileges" |
| Windows | PowerShell Storage cmdlets, `mountvol` | UAC (`Start-Process -Verb RunAs`) |

The privileged work is performed by `bin/jemaos-quota-priv.js`, invoked with a
fixed argv (`action`, parameters file, output file). The helper runs in Node mode
so it works both from a plain Node process and from a packaged Electron app. Its
result is exchanged through a temporary file, so the elevated JSON error is still
returned even when the elevator exits non-zero.

---

## Device safety

The target is verified before and after mounting, and the app fails closed:

- Only **removable** disks are accepted; internal and system disks are rejected.
- A disk must expose **exactly one** EFI System Partition (GUID
  `c12a7328-f81f-11d2-ba4b-00a0c93ec93b`); ambiguity aborts the operation.
- The disk and partition identity is re-checked before the write, and the mount is
  verified to belong to the expected partition.
- Linux mounts read-write or remounts, and probes for write access before writing.
- macOS re-reads `diskutil` state and only unmounts what it mounted.
- Windows assigns a temporary access path, verifies the mapping matches the
  selected partition, probes write access, and removes only what it created. It
  never changes GPT attributes.

---

## CLI

Headless commands, useful for support and scripting:

```bash
node bin/jemaos-quota.js list
node bin/jemaos-quota.js show --device <id>
node bin/jemaos-quota.js init --device <id> --limit 100
```

Options: `--key <file>` (or `JEMAOS_QUOTA_KEY`).

---

## Build from source

Requires Node.js 22 and npm.

```bash
npm ci
npm test
npm start          # runs the native app from source
```

Packaging targets:

```bash
npm run dist:linux        # AppImage + deb
npm run dist:win          # NSIS installer (needs Wine on Linux, or build on Windows)
npm run dist:win:portable # portable Windows exe
npm run dist:mac          # DMG for Intel + Apple Silicon (build on macOS)
npm run dist:mac:linux    # DMG for Intel + Apple Silicon, built on Linux
```

Application icons (PNG / ICO / ICNS) are generated from `ui/logo.svg` before
each packaging step.

### Building macOS DMGs on Linux

macOS DMGs can be produced on Linux without `hdiutil`, using verified open-source
tooling:

- `mkfs.hfsplus` / `fsck.hfsplus` from the Ubuntu `hfsprogs` package;
- [`mozilla/libdmg-hfsplus`](https://github.com/mozilla/libdmg-hfsplus)
  (pinned commit) to populate an HFS+ volume and convert it to UDIF (`dmg build`);
- [`apple-codesign` / rcodesign](https://github.com/indygreg/apple-platform-rs)
  for ad-hoc signing of the bundle and its frameworks.

`scripts/fetch-dmg-tools.sh` downloads and compiles these tools and verifies
their SHA-256. `scripts/build-macos-dmg.sh` signs the `.app`, creates the HFS+
volume, adds the bundle and the `Applications` symlink, converts to a compressed
UDIF image, and verifies a full round-trip (`dmg extract` + `fsck`). The
one-command entry point is:

```bash
npm run dist:mac:linux
```

Ad-hoc signing provides integrity and lets an Apple Silicon bundle run, but it is
**not** a verified publisher identity and **not** notarized. For public
distribution, sign with an Apple Developer ID certificate and notarize on macOS.

---

## Testing

```bash
npm test                              # unit, integration and packaging checks
node scripts/check-packaged-launch.js # validates a built package (no USB access)
```

`--smoke-test` boots the real packaged app, verifies the renderer/`file:` protocol
and the IPC bridge, and **disables** device scan, mount and write. macOS and
Windows command paths are covered with fixtures under Linux and still require a
real machine for end-to-end validation.

---

## Security notes

- The HMAC key (`resources/jemaos-quota.key`) is a **shared secret**. An app that
  ships it exposes it to whoever holds the binary: keep this repository and its
  packages private, or move the key out of the client (keychain, server-side
  activation), ideally with one key per batch.
- A locally signed counter does not prevent replaying a previously valid counter.
  Strong enforcement (Secure Boot with signed image and GRUB, TPM sealing, or
  server-side activation) is required for tamper resistance against physical
  access.
- Release signers: macOS uses ad-hoc signing only. Windows binaries are unsigned
  unless a certificate is configured in the build.

---

## License

BSD-3-Clause © Jema Technology.
