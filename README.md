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

Accepted 0.98.1 clients first receive the notarized 0.99.0 bootstrap bridge below the old native updater's 1 GiB ceiling. The bridge then reads the exact 0.99.1 target feed:

```text
https://updates.ocupath.ai/ocupathif/bootstrap-target/darwin-arm64/latest-mac.yml
```

All macOS direct-update bytes are served from the approved Hong Kong COS bucket. Windows does not expose a direct-update feed and uses the Manual Download page instead. Large customer packages are not stored in this repository.
