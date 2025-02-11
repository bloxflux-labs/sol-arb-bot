import { Keypair } from "@solana/web3.js";
import { logger } from "../logger";
import { connection } from "./connectionUtils";

// 检查临时钱包余额
export async function checkTempWalletBalance(tempWallet: Keypair) {
  const balance = await connection.getBalance(tempWallet.publicKey);
  if (balance > 0) {
    logger.warn(`临时钱包 ${tempWallet.publicKey.toBase58()} 有余额未转回: ${balance} lamports`);
  }
}
