import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const triggerNames = [
  "enforce_session_capacity",
  "account_session_write",
  "enforce_session_update_capacity",
  "account_session_update",
  "enforce_session_delete_capacity",
  "account_session_delete",
  "enforce_habit_write_capacity",
  "account_habit_write",
  "enforce_habit_update_capacity",
  "account_habit_update",
  "enforce_habit_delete_capacity",
  "account_habit_delete",
  "enforce_completion_write_capacity",
  "account_completion_write",
  "enforce_completion_update_capacity",
  "account_completion_update",
  "enforce_completion_delete_capacity",
  "account_completion_delete"
];

const local = process.argv.includes("--local");
const environmentIndex = process.argv.indexOf("--env");
const environment = environmentIndex === -1 ? undefined : process.argv[environmentIndex + 1];
const persistenceIndex = process.argv.indexOf("--persist-to");
const persistence = persistenceIndex === -1 ? undefined : process.argv[persistenceIndex + 1];

if (environmentIndex !== -1 && !environment) throw new Error("--env requires an environment name.");
if (persistenceIndex !== -1 && (!persistence || !local)) {
  throw new Error("--persist-to requires a directory and --local.");
}

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const target = local ? ["--local"] : ["--remote"];
const environmentArgs = environment ? ["--env", environment] : [];
const persistenceArgs = persistence ? ["--persist-to", persistence] : [];

function execute(args) {
  return execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", "DB", ...target, ...environmentArgs, ...persistenceArgs, ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"]
    }
  );
}

execute(["--file", "database/security-triggers.sql"]);

const output = execute([
  "--json",
  "--command",
  "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name;"
]);
const appliedNames = JSON.parse(output)[0]
  .results.map(({ name }) => name)
  .sort();
const expectedNames = [...triggerNames].sort();

if (JSON.stringify(appliedNames) !== JSON.stringify(expectedNames)) {
  throw new Error(`Security trigger verification failed: ${JSON.stringify(appliedNames)}.`);
}
