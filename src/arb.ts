import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import axios from "axios";
import bs58 from "bs58";
import { Buffer } from "buffer";
import dotenv from "dotenv";
import { logger } from "./logger";
import { decrypt } from "./utils/cryptoUtils";
dotenv.config();

const rpcUrl = process.env.RPC_URL || "";
// const grpcUrl = process.env.GRPC_URL || "";
const jupiterUrl = process.env.JUPITER_URL || "";
const jitoUrl = process.env.JITO_URL || "";

// 从环境变量中获取加密后的私钥并解密
const encryptedPrivateKey = process.env.ENCRYPTED_PRIVATE_KEY;
if (!encryptedPrivateKey) {
  throw new Error("ENCRYPTED_PRIVATE_KEY is not defined in environment variables");
}
const decryptedKey = decrypt(encryptedPrivateKey);

// wallet
const payer = Keypair.fromSecretKey(bs58.decode(decryptedKey));
logger.info(`payer: ${payer.publicKey.toBase58()}`);

const connection = new Connection(rpcUrl, "processed");
const quoteUrl = `${jupiterUrl}/quote`;
const swapInstructionUrl = `${jupiterUrl}/swap-instructions`;

// WSOL and USDC mint address
const wSolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function instructionFormat(instruction) {
  return {
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(instruction.data, "base64"),
  };
}

// 新增统计变量
let jitoRequestCount = 0;
let error429Count = 0;
let lastLogTime = Date.now();

// 每10秒输出统计信息
function logStatistics() {
  const now = Date.now();
  if (now - lastLogTime >= 10000) {
    // 10秒
    logger.warn(`统计信息 - 每10秒Jito请求量: ${jitoRequestCount}, 429错误次数: ${error429Count}`);
    jitoRequestCount = 0;
    error429Count = 0;
    lastLogTime = now;
  }
}

const jitoTipAccounts = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

async function run() {
  const start = Date.now();

  // quote0: WSOL -> USDC
  const quote0Params = {
    inputMint: wSolMint,
    outputMint: usdcMint,
    amount: 1_000_000_000, // 1 WSOL
    onlyDirectRoutes: false,
    slippageBps: 0,
    maxAccounts: 20,
  };
  const quote0Resp = await axios.get(quoteUrl, { params: quote0Params });

  // quote1: USDC -> WSOL
  const quote1Params = {
    inputMint: usdcMint,
    outputMint: wSolMint,
    amount: quote0Resp.data.outAmount,
    onlyDirectRoutes: false,
    slippageBps: 0,
    maxAccounts: 20,
  };
  const quote1Resp = await axios.get(quoteUrl, { params: quote1Params });

  // profit but not real
  const diffLamports = quote1Resp.data.outAmount - quote0Params.amount;
  // console.log("diffLamports:", diffLamports);
  const jitoTip = Math.floor(diffLamports * 0.95);

  // threhold
  const thre = 10000;
  if (diffLamports > thre) {
    logger.info(`diffLamports: ${diffLamports}`);
    // merge quote0 and quote1 response
    let mergedQuoteResp = quote0Resp.data;
    mergedQuoteResp.outputMint = quote1Resp.data.outputMint;
    mergedQuoteResp.outAmount = String(quote0Params.amount + jitoTip);
    mergedQuoteResp.otherAmountThreshold = String(quote0Params.amount + jitoTip);
    mergedQuoteResp.priceImpactPct = "0";
    mergedQuoteResp.routePlan = mergedQuoteResp.routePlan.concat(quote1Resp.data.routePlan);

    // swap
    let swapData = {
      userPublicKey: payer.publicKey.toBase58(),
      wrapAndUnwrapSol: false,
      useSharedAccounts: false,
      computeUnitPriceMicroLamports: 1,
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: true,
      quoteResponse: mergedQuoteResp,
    };
    const instructionsResp = await axios.post(swapInstructionUrl, swapData);
    const instructions = instructionsResp.data;

    // bulid tx
    let ixs: TransactionInstruction[] = [];

    // 1. cu
    const computeUnitLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
      units: instructions.computeUnitLimit,
    });
    ixs.push(computeUnitLimitInstruction);

    // 2. setup
    const setupInstructions = instructions.setupInstructions.map(instructionFormat);
    ixs = ixs.concat(setupInstructions);

    // 3. save balance instruction from your program

    // 4. swap
    const swapInstructions = instructionFormat(instructions.swapInstruction);
    ixs.push(swapInstructions);

    // 5. cal real profit and pay for jito from your program
    // a simple transfer instruction here
    // the real profit and tip should be calculated in your program
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(jitoTipAccounts[Math.floor(Math.random() * 8)]), // a random account from jito tip accounts
      lamports: jitoTip,
    });
    ixs.push(tipInstruction);

    // ALT
    const addressLookupTableAccounts = await Promise.all(
      instructions.addressLookupTableAddresses.map(async (address) => {
        const result = await connection.getAddressLookupTable(new PublicKey(address));
        return result.value;
      })
    );

    // v0 tx
    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(addressLookupTableAccounts);
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);

    // simulate
    // const simulationResult = await connection.simulateTransaction(transaction);
    // console.log(JSON.stringify(simulationResult));

    // send bundle
    const serializedTransaction = transaction.serialize();
    const base58Transaction = bs58.encode(serializedTransaction);

    const bundle = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[base58Transaction]],
    };

    const bundle_resp = await axios.post(`${jitoUrl}/api/v1/bundles`, bundle, {
      headers: {
        "Content-Type": "application/json",
      },
    } as any);
    jitoRequestCount++; // 成功请求计数

    const bundle_id = bundle_resp.data.result;
    logger.info(`sent to jito, bundle id: ${bundle_id}`);

    // cal time cost
    const end = Date.now();
    const duration = end - start;

    // console.log(`${wSolMint} - ${usdcMint}`);
    logger.info(`slot: ${mergedQuoteResp.contextSlot}, total duration: ${duration}ms`);
  }
}

async function main() {
  while (1) {
    try {
      await run();
    } catch (error) {
      if (error.isAxiosError && error.response?.status === 429) {
        error429Count++; // 429错误计数
        logger.error(`429: 请求过于频繁`);
        // await wait(1000); // 等待1秒
      } else {
        logger.error(`发生错误: ${error.message}`);
      }
    }

    // 输出统计信息
    logStatistics();

    // wait 20ms
    // await wait(20);
  }
}

main();
