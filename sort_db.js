const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

async function main() {
  try {
    const db = await open({
      filename: "./token_holders.db",
      driver: sqlite3.Database,
    });

    await db.exec(`
      CREATE TEMPORARY TABLE sorted AS
      SELECT * FROM holders ORDER BY balance DESC;
      DELETE FROM holders;
      INSERT INTO holders SELECT * FROM sorted;
      DROP TABLE sorted;
    `);

    console.log("Database sorted by balance in descending order.");
    await db.close();
  } catch (error) {
    console.error("Error sorting database:", error);
  }
}

main();
