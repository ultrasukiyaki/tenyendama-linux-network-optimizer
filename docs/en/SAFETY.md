# Safety

- Node.js and Chromium run as the normal user.
- Only the allow-listed helper runs with `sudo`.
- Commands use argument arrays and never `shell: true`.
- Unverifiable, unexpected-interface, HTTP/3, and QUIC runs are ineligible.
- Starting settings are restored on normal and abnormal completion.
- `benchmark` never persists settings.
- `optimize` requires exploration, confirmation, all safety checks, and explicit approval.
- Persistence creates timestamped backups and supports status, rollback, and uninstall.

Supported automatic profiles use CUBIC or BBR with `fq` or `fq_codel`.
