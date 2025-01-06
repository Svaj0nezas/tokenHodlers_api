const { ethers } = require("ethers");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const express = require("express");
const cors = require("cors");

// Enable CORS


// constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PORT = 6969;

// Alchemy socket settings
const TOKEN_ADDRESS = "0x5212ab48f20a5a34bc43112055c70583996c6fa4";
const wss = "wss://berachain-bartio.g.alchemy.com/v2/4aJs2xvle8qE9cLlDOHmA3UZw_-zJhRm";
const sock = new ethers.WebSocketProvider(wss);

// relevant SC functions
const TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, sock);

async function main() {
  // Open SQLite database
  const db = await open({
    filename: "./token_holders.db",
    driver: sqlite3.Database,
  });

  // Initialize Database
  await db.exec(`
    CREATE TABLE IF NOT EXISTS holders (
      address TEXT PRIMARY KEY,
      balance INTEGER
    );
  `);

  async function updateBalance(address, delta) {
    if (!address || address === ZERO_ADDRESS) return;

    const holder = await db.get("SELECT balance FROM holders WHERE address = ?", [address]);
    const currentBalance = BigInt(holder?.balance || 0);
    const newBalance = currentBalance + delta;

    if (newBalance > 0) {
      await db.run("INSERT OR REPLACE INTO holders (address, balance) VALUES (?, ?)", [
        address,
        newBalance.toString(),
      ]);
    } else {
      await db.run("DELETE FROM holders WHERE address = ?", [address]);
    }
  }

  async function getHolderCount() {
    const result = await db.get("SELECT COUNT(*) as count FROM holders WHERE balance > 0");
    return result.count;
  }

  async function initializeHolders() {
    console.log("Initializing token holders...");
    const latestBlock = await sock.getBlockNumber();
    const logs = await sock.getLogs({
      address: TOKEN_ADDRESS,
      topics: [ethers.id("Transfer(address,address,uint256)")],
      fromBlock: latestBlock - 100000,
      toBlock: latestBlock,
    });

    const balances = {};
    for (const log of logs) {
      const parsedLog = tokenContract.interface.parseLog(log);
      const from = parsedLog.args.from;
      const to = parsedLog.args.to;
      const value = BigInt(parsedLog.args.value);

      if (from !== ZERO_ADDRESS) {
        balances[from] = (balances[from] || BigInt(0)) - value;
      }
      balances[to] = (balances[to] || BigInt(0)) + value;
    }

    for (const [address, balance] of Object.entries(balances)) {
      if (balance > 0) {
        await db.run(
          "INSERT OR REPLACE INTO holders (address, balance) VALUES (?, ?)",
          [address, balance.toString()]
        );
      }
    }
    console.log("Initial holders have been recorded.");
  }

  await initializeHolders();

  sock.on(
    {
      address: TOKEN_ADDRESS,
      topics: [ethers.id("Transfer(address,address,uint256)")],
    },
    async (log) => {
      try {
        const parsedLog = tokenContract.interface.parseLog(log);
        const from = parsedLog.args.from;
        const to = parsedLog.args.to;
        const value = BigInt(parsedLog.args.value);

        await updateBalance(from, -value);
        await updateBalance(to, value);

        const holderCount = await getHolderCount();
        console.log(`Transfer detected: ${ethers.formatUnits(value, 18)} tokens`);
        console.log(`From: ${from}`);
        console.log(`To: ${to}`);
        console.log(`Unique Holders: ${holderCount}`);
      } catch (error) {
        console.error("Error processing transfer event:", error);
      }
    }
  );

  console.log("Listening for Transfer events...");

  const app = express();
  app.use(cors());
  app.get("/holders", async (req, res) => {
    try {
      const holderCount = await getHolderCount();
      res.json({ contract: TOKEN_ADDRESS,
                holders: holderCount });
    } catch (error) {
      console.error("Error fetching holder count:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.listen(PORT, () => {
    console.log(`HTTP server is running on http://localhost:${PORT}`);
  });
}

// Call the main function
main().catch((error) => {
  console.error("Fatal error:", error);
});
