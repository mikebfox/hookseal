export type Severity = "low" | "medium" | "high";

export interface HooksealFinding {
  id: "HS001" | "HS002" | "HS003" | "HS004";
  severity: Severity;
  packageName: string | null;
  version: string | null;
  path: string;
  message: string;
  remediation: string;
  dev?: boolean;
  optional?: boolean;
  resolved?: string | null;
  script?: string;
}

export interface HooksealReport {
  ok: boolean;
  lockfileVersion: number | string | null;
  packageName: string | null;
  packageVersion: string | null;
  totals: Record<Severity, number>;
  findings: HooksealFinding[];
}

export interface HooksealOptions {
  cwd?: string;
  lockfile?: string;
  packagePath?: string;
  lockfilePath?: string;
  policyPath?: string | false;
  packageJson?: Record<string, unknown> | null;
  allow?: string[];
  allowedPackages?: string[];
  allowedRootScripts?: string[];
  includeDev?: boolean;
}

export declare const DEFAULT_POLICY_FILE: ".hookseal.json";

export declare class HooksealError extends Error {
  name: "HooksealError";
}

export declare function auditProject(options?: HooksealOptions): HooksealReport;
export declare function auditPackageLock(lockfile: Record<string, unknown>, options?: HooksealOptions): HooksealReport;
export declare function readPolicyFile(path: string): Record<string, unknown>;
export declare function formatTextReport(report: HooksealReport, options?: { verbose?: boolean }): string;
export declare function severityAtLeast(actual: Severity, threshold: Severity): boolean;
export declare function shouldFail(report: HooksealReport, threshold?: Severity): boolean;
export declare function findNearestProjectFile(startDir: string, fileName: string): string | null;
