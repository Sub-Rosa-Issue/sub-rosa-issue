import { GrantScoringPilot } from "./pilot.js";

async function main() {
  const pilot = new GrantScoringPilot();
  const receipt = await pilot.runFixtureLifecycle();

  console.log("Sub Rosa — sealed grant scoring pilot (fixture mode)\n");
  console.log(`Program: ${receipt.title} (${receipt.programId})`);
  console.log(`Judges: ${receipt.judges.length} · Projects: ${receipt.projects.length}`);
  console.log(`Reveal round R: ${receipt.revealRound}\n`);

  console.log("Ranked projects:");
  for (const row of receipt.rankings) {
    console.log(
      `  #${row.rank} ${row.projectName} — avg ${row.averageScore.toFixed(2)} / 10`,
    );
    for (const score of row.judgeScores) {
      console.log(`       ${score.judgeId}: ${score.displayScore.toFixed(2)} / 10`);
    }
  }

  console.log("\nOrganizer receipt:");
  console.log(JSON.stringify(receipt, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
