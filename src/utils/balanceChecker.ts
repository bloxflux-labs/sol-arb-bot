import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// Solana 网络连接
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL);

// USDC 的 Mint 地址
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// WSOL 的 Mint 地址
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// 读取钱包地址文件
const WALLET_FILE = path.join(__dirname, "../../wallet.txt");

// 查询 SOL 余额
async function getSolBalance(publicKey: PublicKey): Promise<number> {
  const balance = await connection.getBalance(publicKey);
  return balance / 1e9; // 转换为 SOL
}

// 查询 USDC 余额
async function getUsdcBalance(publicKey: PublicKey): Promise<number> {
  const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
    mint: USDC_MINT,
  });

  if (accounts.value.length > 0) {
    return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
  }
  return 0;
}

// 查询 WSOL 余额
async function getWsolBalance(publicKey: PublicKey): Promise<number> {
  const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
    mint: WSOL_MINT,
  });

  if (accounts.value.length > 0) {
    return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
  }
  return 0;
}

// 主函数
async function main() {
  // 读取钱包地址文件
  const walletAddresses = fs
    .readFileSync(WALLET_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim());

  if (walletAddresses.length === 0) {
    console.log("No wallet addresses found in wallet.txt");
    return;
  }

  console.log(`Checking balances for ${walletAddresses.length} wallets...\n`);

  // 查询每个钱包的余额
  for (const address of walletAddresses) {
    try {
      const publicKey = new PublicKey(address);
      const solBalance = await getSolBalance(publicKey);
      const usdcBalance = await getUsdcBalance(publicKey);
      const wsolBalance = await getWsolBalance(publicKey);

      console.log(`Wallet: ${address}`);
      console.log(`SOL Balance: ${solBalance}`);
      console.log(`USDC Balance: ${usdcBalance}`);
      console.log(`WSOL Balance: ${wsolBalance}\n`);
    } catch (error) {
      console.error(`Error checking balance for ${address}:`, error);
    }
  }
}

main().catch(console.error);
