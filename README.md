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

The Windows update-detection feed is:

```text
https://updates.ocupath.ai/ocupathif/direct/win32-x64/latest.yml
```

Windows uses this feed only to detect the current release. The packaged app
keeps `installMode=manual` and opens the Manual Download page instead of
attempting an automatic NSIS installation.

Accepted older clients first receive the notarized 0.991.0 bootstrap bridge below the old native updater's 1 GiB ceiling. The bridge then reads the exact 0.991.1 target feed:

```text
https://updates.ocupath.ai/ocupathif/bootstrap-target/darwin-arm64/latest-mac.yml
```

The packaged application appends its platform directory to the public `direct`
base. Those public metadata files point at exact package bytes in the approved
Hong Kong COS bucket. Publication proof must fetch the public packaged-app
route, compare it with the locally rendered feed, and verify the named COS
object independently.

All package bytes named by the platform feeds are served from the approved Hong Kong COS bucket. Large customer packages are not stored in this repository.

Publication files are generated from `release-manifests/v0.994.1-staging.json`:

```text
node scripts/render-release.mjs release-manifests/v0.994.1-staging.json
```

The renderer and publication gates stop while any `__PENDING_*__` field remains.
`--allow-pending` is only for preparing and checking an unpublished branch.

For minor releases with no material Windows-sensitive changes or Windows-specific failure reports, the exact fixed-SHA Windows package still requires provenance, hash, structure, source-boundary, and contract evidence, while native execution may reuse the latest documented real-Windows baseline. Record that decision as `baseline-reused`; use `PASS` only when the exact package has completed a new native run.
