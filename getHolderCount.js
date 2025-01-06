const { ethers } = require("ethers");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const express = require("express");

// constants
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PORT = 6969

// Alchemy socket settings
const TOKEN_ADDRESS = '0x8b2c510a0a1909782f37f72d225e3a9e31abc1c0';
const wss = 'wss://berachain-bartio.g.alchemy.com/v2/4aJs2xvle8qE9cLlDOHmA3UZw_-zJhRm'
const sock = new ethers.WebSocketProvider(wss)

// relevant SC functions
const TOKEN_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ];
  
// Ethers provider (from sock)
const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, sock);

// Open SQLite database
const db = await open({
    filename: "./token_holders.db",
    driver: sqlite3.Database
  });
  
  // Initialize Database
  await db.exec(`
    CREATE TABLE IF NOT EXISTS holders (
      address TEXT PRIMARY KEY,
      balance INTEGER
    );
  `);
  
// Update Holder Balance in Database
async function updateBalance(address, delta) {
  if (!address || address === ZERO_ADDRESS) return;

  // Fetch current balance
  const holder = await db.get("SELECT balance FROM holders WHERE address = ?", [address]);
  const currentBalance = BigInt(holder?.balance || 0);
  const newBalance = currentBalance + BigInt(delta);

  if (newBalance > 0) {
    await db.run("INSERT OR REPLACE INTO holders (address, balance) VALUES (?, ?)", [address, newBalance.toString()]);
  } else {
    await db.run("DELETE FROM holders WHERE address = ?", [address]);
  }
}

// Get Holder Count
async function getHolderCount() {
  const result = await db.get("SELECT COUNT(*) as count FROM holders WHERE balance > 0");
  return result.count;
}
// Fetch and update initial holders
async function initializeHolders() {
    console.log("Initializing token holders...");
  
    // Get the latest block for historical event querying
    const latestBlock = await sock.getBlockNumber();
  
    // Get all Transfer events since block 0
    const logs = await sock.getLogs({
      address: TOKEN_ADDRESS,
      topics: [ethers.id("Transfer(address,address,uint256)")],
      fromBlock: latestBlock - 100,
      toBlock: latestBlock,
    });
  
    // Parse Transfer events to determine holders
    const balances = {};
    for (const log of logs) {
      const parsedLog = tokenContract.interface.parseLog(log);
      const from = parsedLog.args.from;
      const to = parsedLog.args.to;
      const value = BigInt(parsedLog.args.value);
  
      // Decrease balance of sender
      if (from !== ZERO_ADDRESS) {
        balances[from] = (balances[from] || BigInt(0)) - value;
      }
  
      // Increase balance of recipient
      balances[to] = (balances[to] || BigInt(0)) + value;
    }
  
    // Write the balances to the database
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
  
  // Call initialization before starting the event listener
  await initializeHolders();
  

  // Event Listener for Transfer Events
sock.on(
    {
      address: TOKEN_ADDRESS,
      topics: [ethers.id("Transfer(address,address,uint256)")]
    },
    async (log) => {
      try {
        const parsedLog = tokenContract.interface.parseLog(log);
  
        const from = parsedLog.args.from;
        const to = parsedLog.args.to;
        const value = BigInt(parsedLog.args.value);
  
        // Update balances
        await updateBalance(from, -value);
        await updateBalance(to, value);
  
        // Log details
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
 
// HTTP server setup
const app = express();

app.get("/holders", async (req, res) => {
  try {
    const holderCount = await getHolderCount();
    res.json({ holders: holderCount });
  } catch (error) {
    console.error("Error fetching holder count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`HTTP server is running on http://localhost:${PORT}`);
});
