// Stops a deploy that would go to the wrong copy of the hub (docs/DEPLOY.md). Workers Builds sets
// WORKERS_CI_BRANCH: the live hub deploys only from main, the preview never from main.
const target = process.argv[2];
const branch = process.env.WORKERS_CI_BRANCH;
if (branch) {
  if (target === "live" && branch !== "main") {
    console.error(`Refusing to deploy the live hub from branch "${branch}": only main goes live.`);
    process.exit(1);
  }
  if (target === "preview" && branch === "main") {
    console.error("Refusing to deploy the preview from main: main deploys the live hub.");
    process.exit(1);
  }
}
console.log(`Deploying the ${target} hub${branch ? ` from ${branch}` : ""}.`);
