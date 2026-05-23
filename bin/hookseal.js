#!/usr/bin/env node
import { auditProject, formatTextReport, HooksealError, shouldFail } from "../src/index.js";

const HELP = `hookseal

Audit npm package-lock install lifecycle hooks against a small allowlist.

Usage:
  hookseal [path] [options]

Arguments:
  path                     Project directory or package-lock.json path. Defaults to cwd.

Options:
  --allow <name>           Allow package name or package@version. Repeatable.
  --allow-root <script>    Allow a root lifecycle script such as prepare. Repeatable.
  --policy <path>          Read JSON policy file. Defaults to .hookseal.json when present.
  --no-policy              Do not read .hookseal.json.
  --no-dev                 Ignore dev-only dependency hooks.
  --fail-on <severity>     low, medium, or high. Default: medium.
  --json                   Print JSON report.
  --verbose                Include resolved tarball URLs in text output.
  --no-fail                Always exit with code 0.
  --help                   Show help.
  --version                Show version.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP.trimEnd());
    return;
  }
  if (args.version) {
    const packageJson = await import("../package.json", { with: { type: "json" } });
    console.log(packageJson.default.version);
    return;
  }

  const target = args.path ?? process.cwd();
  const options = buildProjectOptions(target, args);
  const report = auditProject(options);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report, { verbose: args.verbose }));
  }

  if (!args.noFail && shouldFail(report, args.failOn)) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const result = {
    allow: [],
    allowRootScripts: [],
    failOn: "medium",
    includeDev: true,
    policyPath: undefined,
    path: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--version":
      case "-v":
        result.version = true;
        break;
      case "--json":
        result.json = true;
        break;
      case "--verbose":
        result.verbose = true;
        break;
      case "--no-fail":
        result.noFail = true;
        break;
      case "--no-dev":
        result.includeDev = false;
        break;
      case "--no-policy":
        result.policyPath = false;
        break;
      case "--allow":
        result.allow.push(readValue(argv, ++index, "--allow"));
        break;
      case "--allow-root":
        result.allowRootScripts.push(readValue(argv, ++index, "--allow-root"));
        break;
      case "--policy":
        result.policyPath = readValue(argv, ++index, "--policy");
        break;
      case "--fail-on":
        result.failOn = readValue(argv, ++index, "--fail-on");
        if (!["low", "medium", "high"].includes(result.failOn)) {
          throw new HooksealError("--fail-on must be low, medium, or high");
        }
        break;
      default:
        if (arg.startsWith("-")) {
          throw new HooksealError(`Unknown option: ${arg}`);
        }
        if (result.path) {
          throw new HooksealError(`Unexpected argument: ${arg}`);
        }
        result.path = arg;
    }
  }

  return result;
}

function buildProjectOptions(target, args) {
  if (target.endsWith("package-lock.json")) {
    return {
      cwd: target.slice(0, -"package-lock.json".length) || ".",
      lockfile: target,
      policyPath: args.policyPath,
      allowedPackages: args.allow.length > 0 ? args.allow : undefined,
      allowedRootScripts: args.allowRootScripts.length > 0 ? args.allowRootScripts : undefined,
      includeDev: args.includeDev
    };
  }

  return {
    cwd: target,
    policyPath: args.policyPath,
    allowedPackages: args.allow.length > 0 ? args.allow : undefined,
    allowedRootScripts: args.allowRootScripts.length > 0 ? args.allowRootScripts : undefined,
    includeDev: args.includeDev
  };
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new HooksealError(`${flag} requires a value`);
  }
  return value;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`hookseal: ${message}`);
  process.exitCode = 2;
});
