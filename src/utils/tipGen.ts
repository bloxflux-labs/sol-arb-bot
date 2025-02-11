import {
  Keypair,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import dotenv from "dotenv";
import { logger } from "../logger";
import { connection } from "./connectionUtils";

dotenv.config();

const mainPayer = Keypair.generate();

async function tipGen() {
  // 生成 100 个代付账号，每个账号预存 0.01 SOL
  const tipPayers: Keypair[] = [];
  for (let i = 0; i < 100; i++) {
    const tipPayer = Keypair.generate();
    // 主钱包向代付账号预存 0.01 SOL
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: mainPayer.publicKey,
      toPubkey: tipPayer.publicKey,
      lamports: 10_000_000, // 0.01 SOL
    });
    // 发送预存交易
    await sendTransaction(transferInstruction, mainPayer);
    tipPayers.push(tipPayer);
  }
  return tipPayers;
}

const tipPayers = await tipGen();

// 定期检查代付账号余额并转回
async function checkAndTransferBack() {
  for (const tipPayer of tipPayers) {
    const balance = await connection.getBalance(tipPayer.publicKey);
    if (balance > 10_000_000) {
      // 余额超过 0.01 SOL
      const transferBackInstruction = SystemProgram.transfer({
        fromPubkey: tipPayer.publicKey,
        toPubkey: mainPayer.publicKey,
        lamports: balance - 5_000, // 保留 5000 lamports 作为交易费用
      });

      // 发送转回交易
      try {
        await sendTransaction(transferBackInstruction, tipPayer);
        logger.info(`代付账号 ${tipPayer.publicKey.toBase58()} 余额已转回`);
      } catch (error) {
        logger.error(`代付账号 ${tipPayer.publicKey.toBase58()} 余额转回失败: ${error.message}`);
      }
    }
  }
}

// 发送交易的方法
async function sendTransaction(
  instruction: TransactionInstruction,
  payer: Keypair,
  signers: Keypair[] = []
) {
  // 创建交易
  const transaction = new Transaction().add(instruction);

  // 设置交易费用支付者
  transaction.feePayer = payer.publicKey;

  // 获取最新的区块哈希
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  // 签名交易
  transaction.sign(payer, ...signers);

  // 发送并确认交易
  try {
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer, ...signers]);
    logger.info(`交易成功，签名: ${signature}`);
    return signature;
  } catch (error) {
    logger.error(`交易失败: ${error.message}`);
    throw error;
  }
}

// 每 10 分钟执行一次转回逻辑
setInterval(checkAndTransferBack, 10 * 60 * 1000);
