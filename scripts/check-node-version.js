const REQUIRED = "20.x, 22.x, 23.x, 24.x, 25.x, or 26.x (21.x is not supported by better-sqlite3)";

const major = parseInt(process.versions.node.split(".")[0], 10);
const ok = major >= 20 && major !== 21;

if (!ok) {
  console.error(`\n✖ Node ${process.version} is not supported by this project.`);
  console.error(`  Required: ${REQUIRED}\n`);
  console.error("  Fix with whichever version manager you have:");
  console.error("    nvm install && nvm use      (nvm / nvm-windows)");
  console.error("    fnm use                     (fnm)");
  console.error("    volta install node@25.3.0   (volta)\n");
  console.error("  This project's pinned version is in .nvmrc\n");
  process.exit(1);
}
