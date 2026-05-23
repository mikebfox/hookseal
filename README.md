# hookseal

`hookseal` audits npm `package-lock.json` files for dependency install hooks that can execute during `npm install` or `npm ci`.

Recent npm supply-chain incidents keep landing in the same place: developer and CI machines run lifecycle scripts from packages before humans have reviewed what changed. `hookseal` makes that boundary explicit. It reads the committed lockfile, finds dependencies marked with `hasInstallScript`, and fails unless they are in a small reviewed allowlist.

## Why this exists

`npm audit` is useful after a vulnerability is known. Install hooks are earlier in the chain: a new transitive package can gain execution just because a lockfile changed. Larger commercial scanners can cover this, but small projects often need a local, deterministic CI check that does not call an external service.

`hookseal` is intentionally narrow:

- It scans npm lockfiles offline.
- It focuses on lifecycle hook execution, not every package risk.
- It uses explicit allowlists instead of scoring packages by popularity.
- It works as both a library and a CLI.

## Install

The package is prepared as `@foxom/hookseal`, but npm publishing is currently blocked by npm authentication for this machine. Until it is published, install from GitHub:

```sh
npm install -D github:mikebfox/hookseal
```

Requires Node.js 20 or newer.

## CLI usage

Audit the current project:

```sh
npx hookseal
```

Audit another directory:

```sh
npx hookseal ./packages/web
```

Allow a reviewed dependency hook:

```sh
npx hookseal --allow esbuild --allow @parcel/watcher@2.5.1
```

Use JSON output in CI:

```sh
npx hookseal --json --fail-on medium
```

Ignore dev-only dependency hooks:

```sh
npx hookseal --no-dev
```

## Policy file

Create `.hookseal.json` at the project root:

```json
{
  "allow": [
    "esbuild",
    "@parcel/watcher@2.5.1"
  ],
  "allowedRootScripts": [
    "prepare"
  ]
}
```

Allow by exact package name when any version is acceptable, or by `package@version` when you want the review to expire on upgrade.

## Library usage

```js
import { auditPackageLock, formatTextReport } from "@foxom/hookseal";

const lockfile = {
  lockfileVersion: 3,
  packages: {
    "": { name: "app", version: "1.0.0" },
    "node_modules/esbuild": {
      version: "0.25.0",
      integrity: "sha512-example",
      hasInstallScript: true
    }
  }
};

const report = auditPackageLock(lockfile, {
  allowedPackages: ["esbuild@0.25.0"]
});

console.log(report.ok);
console.log(formatTextReport(report));
```

## API

### `auditProject(options)`

Reads `package-lock.json`, optional `package.json`, and optional `.hookseal.json` from `options.cwd`.

Options:

- `cwd`: project directory. Default: `process.cwd()`.
- `lockfile`: lockfile path relative to `cwd`. Default: `package-lock.json`.
- `packageJson`: package metadata object for direct API use.
- `policyPath`: policy file path, or `false` to disable policy loading.
- `allowedPackages` or `allow`: package names or `package@version` entries.
- `allowedRootScripts`: root lifecycle scripts allowed in `package.json`.
- `includeDev`: include dev-only dependencies. Default: `true`.

### `auditPackageLock(lockfile, options)`

Audits a parsed package lock object and returns:

- `ok`: `true` when no findings are present.
- `lockfileVersion`: detected lockfile version.
- `packageName` and `packageVersion`: root package metadata when available.
- `totals`: finding counts by severity.
- `findings`: sorted findings with rule id, severity, package, path, message, and remediation.

### `formatTextReport(report, options)`

Formats a human-readable terminal report. Pass `{ verbose: true }` to include resolved tarball URLs.

### `shouldFail(report, threshold)`

Returns whether a report should fail CI for `low`, `medium`, or `high`.

## Checks

- `HS001`: dependency declares an install lifecycle script and is not allowed.
- `HS002`: root `package.json` defines an install lifecycle script and is not allowed.
- `HS003`: dependency declares an install lifecycle script without integrity metadata.
- `HS004`: lockfile has no `packages` metadata, so hook status cannot be verified.

## Design notes

`hookseal` relies on npm lockfile metadata instead of installing packages or fetching tarballs. That keeps it safe to run before install and makes it useful in CI review gates. The tradeoff is scope: it only knows what the lockfile records. If a project uses another package manager, pair it with that manager's own hook approval mechanism.

The allowlist is small on purpose. Native builders and platform packages often need install hooks, but each hook should be an explicit review decision, not lockfile noise.

This is not a package-manager wrapper and it does not mutate `package.json`. Tools such as install-script blockers can control whether scripts run; `hookseal` is the review gate that answers a narrower question from committed files: "Did this lockfile introduce executable dependency hooks that we have not approved?"

## Development

```sh
npm install
npm test
npm run typecheck
npm pack --dry-run
```

Run the CLI locally:

```sh
node bin/hookseal.js --help
```

## License

MIT
