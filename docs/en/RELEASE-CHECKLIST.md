# Release checklist

1. Run `npm install`, `npm test`, and `npm run selftest`.
2. Run syntax checks for Node.js and shell files.
3. Run `./setup.sh --check-only`.
4. Verify IPv4/IPv6 route fixtures and a real `check`.
5. Complete a quick benchmark on test hardware.
6. Exercise optimize through cancellation before persistence.
7. Test persistence, reboot application, status, rollback, and uninstall on disposable hardware.
8. Check README/docs links, changelog, license, manifest, ZIP contents, and SHA-256.
