# OcuPathIF Updates

Public update manifests and customer download page for OcuPathIF standalone builds.

The app reads:

```text
https://updates.ocupath.ai/ocupathif/latest.json
```

The macOS direct-update entry feed is:

```text
https://updates.ocupath.ai/ocupathif/direct/darwin-arm64/latest-mac.yml
```

Accepted older clients first receive the notarized 0.991.0 bootstrap bridge below the old native updater's 1 GiB ceiling. The bridge then reads the exact 0.991.1 target feed:

```text
https://updates.ocupath.ai/ocupathif/bootstrap-target/darwin-arm64/latest-mac.yml
```

All macOS direct-update bytes are served from the approved Hong Kong COS bucket. Windows does not expose a direct-update feed and uses the Manual Download page instead. Large customer packages are not stored in this repository.

For minor releases with no material Windows-sensitive changes or Windows-specific failure reports, the exact fixed-SHA Windows package still requires provenance, hash, structure, source-boundary, and contract evidence, while native execution may reuse the latest documented real-Windows baseline. Record that decision as `baseline-reused`; use `PASS` only when the exact package has completed a new native run.
