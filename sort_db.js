import sqlite3 from "sqlite3";
import { open } from "sqlite";

async function sortDatabase() {
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
}

sortDatabase().catch((error) => {
  console.error("Error sorting database:", error);
});
