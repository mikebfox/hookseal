import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const INSTALL_HOOKS = new Set(["preinstall", "install", "postinstall", "prepare"]);
const SEVERITY_SCORE = new Map([
  ["low", 0],
  ["medium", 1],
  ["high", 2]
]);

export const DEFAULT_POLICY_FILE = ".hookseal.json";

export function auditProject(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const lockfilePath = resolve(cwd, options.lockfile ?? "package-lock.json");
  const packagePath = resolve(cwd, options.packagePath ?? "package.json");
  const policyPath = options.policyPath === false
    ? null
    : resolve(cwd, options.policyPath ?? DEFAULT_POLICY_FILE);

  const policy = policyPath && existsSync(policyPath)
    ? readPolicyFile(policyPath)
    : {};

  const mergedOptions = mergeOptions(policy, options);
  const lockfile = readJsonFile(lockfilePath, "package-lock");
  const packageJson = existsSync(packagePath)
    ? readJsonFile(packagePath, "package")
    : null;

  return auditPackageLock(lockfile, {
    ...mergedOptions,
    packageJson,
    lockfilePath,
    packagePath
  });
}

export function auditPackageLock(lockfile, options = {}) {
  if (!lockfile || typeof lockfile !== "object" || Array.isArray(lockfile)) {
    throw new HooksealError("package-lock must be a JSON object");
  }

  const findings = [];
  const allowedPackages = normalizeAllowlist(options.allowedPackages ?? options.allow);
  const allowedRootScripts = new Set(options.allowedRootScripts ?? []);
  const includeDev = options.includeDev !== false;
  const rootPackage = options.packageJson ?? lockfile.packages?.[""] ?? null;

  if (!lockfile.packages || typeof lockfile.packages !== "object") {
    findings.push({
      id: "HS004",
      severity: "high",
      packageName: null,
      version: null,
      path: options.lockfilePath ?? "package-lock.json",
      message: "Lockfile has no packages metadata, so install hooks cannot be verified.",
      remediation: "Regenerate the lockfile with npm 7 or newer before relying on hookseal."
    });
  } else {
    for (const [packagePath, entry] of Object.entries(lockfile.packages)) {
      if (packagePath === "" || !entry || typeof entry !== "object") {
        continue;
      }
      if (entry.link === true || entry.hasInstallScript !== true) {
        continue;
      }
      if (!includeDev && entry.dev === true) {
        continue;
      }

      const packageName = entry.name ?? packageNameFromLockPath(packagePath);
      const version = typeof entry.version === "string" ? entry.version : null;
      const allowedBy = allowedMatch(allowedPackages, packageName, version);
      if (allowedBy) {
        continue;
      }

      findings.push({
        id: entry.integrity ? "HS001" : "HS003",
        severity: entry.integrity ? "medium" : "high",
        packageName,
        version,
        path: packagePath,
        dev: entry.dev === true,
        optional: entry.optional === true,
        resolved: typeof entry.resolved === "string" ? entry.resolved : null,
        message: entry.integrity
          ? `${formatPackage(packageName, version)} declares an install lifecycle script and is not allowed.`
          : `${formatPackage(packageName, version)} declares an install lifecycle script without integrity metadata.`,
        remediation: entry.integrity
          ? "Review the package hook, then add an exact package or package@version to the hookseal allowlist if it is required."
          : "Regenerate the lockfile from the registry and review the package before allowing this hook."
      });
    }
  }

  if (rootPackage && typeof rootPackage === "object") {
    const scripts = rootPackage.scripts && typeof rootPackage.scripts === "object"
      ? rootPackage.scripts
      : {};
    for (const scriptName of Object.keys(scripts).sort()) {
      if (!INSTALL_HOOKS.has(scriptName) || allowedRootScripts.has(scriptName)) {
        continue;
      }
      findings.push({
        id: "HS002",
        severity: "medium",
        packageName: rootPackage.name ?? null,
        version: rootPackage.version ?? null,
        path: "package.json",
        script: scriptName,
        message: `Root package defines ${scriptName}, which runs during install or publish-adjacent flows.`,
        remediation: "Keep root install hooks rare; add the script name to allowedRootScripts only after review."
      });
    }
  }

  findings.sort(compareFindings);

  return {
    ok: findings.length === 0,
    lockfileVersion: lockfile.lockfileVersion ?? null,
    packageName: rootPackage?.name ?? lockfile.name ?? null,
    packageVersion: rootPackage?.version ?? lockfile.version ?? null,
    totals: countBySeverity(findings),
    findings
  };
}

export function readPolicyFile(path) {
  const policy = readJsonFile(path, "policy");
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new HooksealError(`Policy file must contain a JSON object: ${path}`);
  }
  return policy;
}

export function formatTextReport(report, options = {}) {
  const lines = [];
  const title = report.packageName
    ? `hookseal ${report.packageName}${report.packageVersion ? `@${report.packageVersion}` : ""}`
    : "hookseal report";

  lines.push(title);

  if (report.findings.length === 0) {
    lines.push("No unapproved install hooks found.");
    return lines.join("\n");
  }

  lines.push(`${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} found.`);

  for (const finding of report.findings) {
    const subject = finding.packageName
      ? formatPackage(finding.packageName, finding.version)
      : finding.path;
    const suffix = finding.script ? ` script=${finding.script}` : "";
    lines.push("");
    lines.push(`[${finding.severity}] ${finding.id} ${subject}${suffix}`);
    lines.push(`  ${finding.message}`);
    lines.push(`  Path: ${finding.path}`);
    if (finding.resolved && options.verbose) {
      lines.push(`  Resolved: ${finding.resolved}`);
    }
    lines.push(`  Fix: ${finding.remediation}`);
  }

  return lines.join("\n");
}

export function severityAtLeast(actual, threshold) {
  const actualScore = SEVERITY_SCORE.get(actual);
  const thresholdScore = SEVERITY_SCORE.get(threshold);
  if (actualScore === undefined || thresholdScore === undefined) {
    throw new HooksealError(`Unknown severity: ${actualScore === undefined ? actual : threshold}`);
  }
  return actualScore >= thresholdScore;
}

export function shouldFail(report, threshold = "medium") {
  return report.findings.some((finding) => severityAtLeast(finding.severity, threshold));
}

export class HooksealError extends Error {
  constructor(message) {
    super(message);
    this.name = "HooksealError";
  }
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new HooksealError(`Missing ${label} file: ${path}`);
    }
    throw new HooksealError(`Could not read ${label} file ${path}: ${error.message}`);
  }
}

function mergeOptions(policy, options) {
  return {
    ...policy,
    ...options,
    allowedPackages: options.allowedPackages ?? options.allow ?? policy.allowedPackages ?? policy.allow,
    allowedRootScripts: options.allowedRootScripts ?? policy.allowedRootScripts,
    includeDev: options.includeDev ?? policy.includeDev
  };
}

function normalizeAllowlist(values = []) {
  if (!Array.isArray(values)) {
    throw new HooksealError("allowedPackages must be an array");
  }
  return new Set(values.map((value) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new HooksealError("allowedPackages entries must be non-empty strings");
    }
    return value.trim();
  }));
}

function allowedMatch(allowedPackages, packageName, version) {
  if (!packageName) {
    return null;
  }
  if (allowedPackages.has(packageName)) {
    return packageName;
  }
  if (version && allowedPackages.has(`${packageName}@${version}`)) {
    return `${packageName}@${version}`;
  }
  return null;
}

function packageNameFromLockPath(packagePath) {
  const marker = "node_modules/";
  const markerIndex = packagePath.lastIndexOf(marker);
  const last = markerIndex === -1
    ? packagePath
    : packagePath.slice(markerIndex + marker.length);
  const segments = last.split("/");
  if (segments[0]?.startsWith("@")) {
    return `${segments[0]}/${segments[1] ?? ""}`;
  }
  return segments[0] || packagePath;
}

function formatPackage(packageName, version) {
  if (!packageName) {
    return "unknown package";
  }
  return version ? `${packageName}@${version}` : packageName;
}

function countBySeverity(findings) {
  const totals = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    totals[finding.severity] += 1;
  }
  return totals;
}

function compareFindings(a, b) {
  const severityDelta = SEVERITY_SCORE.get(b.severity) - SEVERITY_SCORE.get(a.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return `${a.path}${a.id}`.localeCompare(`${b.path}${b.id}`);
}

export function findNearestProjectFile(startDir, fileName) {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
