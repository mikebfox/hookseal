import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

import { auditPackageLock, auditProject, formatTextReport, shouldFail } from "../src/index.js";

function lockWithPackages(packages) {
  return {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "fixture",
        version: "1.0.0"
      },
      ...packages
    }
  };
}

test("reports unapproved dependency install hooks", () => {
  const report = auditPackageLock(lockWithPackages({
    "node_modules/esbuild": {
      version: "0.25.0",
      resolved: "https://registry.npmjs.org/esbuild/-/esbuild-0.25.0.tgz",
      integrity: "sha512-test",
      hasInstallScript: true
    }
  }));

  assert.equal(report.ok, false);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].id, "HS001");
  assert.equal(report.findings[0].packageName, "esbuild");
  assert.equal(shouldFail(report), true);
});

test("allows reviewed packages by exact name or version", () => {
  const lockfile = lockWithPackages({
    "node_modules/esbuild": {
      version: "0.25.0",
      integrity: "sha512-test",
      hasInstallScript: true
    },
    "node_modules/@parcel/watcher": {
      version: "2.5.1",
      integrity: "sha512-test",
      hasInstallScript: true
    }
  });

  const report = auditPackageLock(lockfile, {
    allowedPackages: ["esbuild", "@parcel/watcher@2.5.1"]
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
});

test("flags old lockfiles without packages metadata", () => {
  const report = auditPackageLock({
    name: "old-lock",
    lockfileVersion: 1,
    dependencies: {
      leftpad: {
        version: "1.0.0"
      }
    }
  });

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].id, "HS004");
  assert.equal(report.findings[0].severity, "high");
});

test("reports root install lifecycle scripts unless allowed", () => {
  const report = auditPackageLock(lockWithPackages({}), {
    packageJson: {
      name: "root-hooks",
      version: "1.0.0",
      scripts: {
        prepare: "npm run build",
        test: "node --test"
      }
    }
  });

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].id, "HS002");
  assert.match(formatTextReport(report), /Root package defines prepare/);

  const allowed = auditPackageLock(lockWithPackages({}), {
    packageJson: {
      scripts: {
        prepare: "npm run build"
      }
    },
    allowedRootScripts: ["prepare"]
  });
  assert.equal(allowed.ok, true);
});

test("CLI emits JSON and honors policy files", () => {
  const dir = mkdtempSync(join(tmpdir(), "hookseal-"));
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "cli-fixture",
    version: "1.0.0"
  }));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lockWithPackages({
    "node_modules/native-builder": {
      version: "1.2.3",
      integrity: "sha512-test",
      hasInstallScript: true
    }
  })));
  writeFileSync(join(dir, ".hookseal.json"), JSON.stringify({
    allow: ["native-builder@1.2.3"]
  }));

  const output = execFileSync(process.execPath, [
    join(process.cwd(), "bin/hookseal.js"),
    dir,
    "--json"
  ], {
    cwd: join(process.cwd()),
    encoding: "utf8"
  });
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.equal(auditProject({ cwd: dir }).ok, true);
});
