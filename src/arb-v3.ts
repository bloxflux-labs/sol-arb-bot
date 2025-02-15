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
if (!rpcUrl || !jupiterUrl || !jitoUrl) {
  logger.error(`
    ========================================================
    错误：缺少环境变量, RPC_URL: ${rpcUrl}, JUPITER_URL: ${jupiterUrl}, JITO_URL: ${jitoUrl}
  `);
  process.exit(1);
}

// 套利主钱包数量
const mainPayerCount = parseInt(process.env.MAIN_PAYER_COUNT || "1");

// 代付钱包数量
const tipPayerCount = parseInt(process.env.TIP_PAYER_COUNT || "10");

// 动态生成加密私钥数组
const encryptedMainPrivateKeys: string[] = [];
const encryptedTipPrivateKeys: string[] = [];

for (let i = 1; i <= mainPayerCount; i++) {
  const key = process.env[`ENCRYPTED_MAIN_PRIVATE_KEY_${i}`];
  if (key) {
    encryptedMainPrivateKeys.push(key);
  }
}

for (let i = 1; i <= tipPayerCount; i++) {
  const key = process.env[`ENCRYPTED_TIP_PRIVATE_KEY_${i}`];
  if (key) {
    encryptedTipPrivateKeys.push(key);
  }
}

if (encryptedMainPrivateKeys.length === 0 || encryptedTipPrivateKeys.length === 0) {
  logger.error(`
    ========================================================
    错误：未找到足够的加密私钥！
    请确保：
    1. 已正确配置 .env 文件
    2. 主私钥格式为 ENCRYPTED_MAIN_PRIVATE_KEY_1 ... ENCRYPTED_MAIN_PRIVATE_KEY_N
    3. 代付私钥格式为 ENCRYPTED_TIP_PRIVATE_KEY_1 ... ENCRYPTED_TIP_PRIVATE_KEY_N
    4. 私钥已正确加密
    5. 程序已加载 .env 文件
    ========================================================
  `);
  process.exit(1);
} else {
  logger.info(
    `成功加载 ${encryptedMainPrivateKeys.length} 个主钱包和 ${encryptedTipPrivateKeys.length} 个代付钱包`
  );
}

// 创建主钱包和代付钱包
const mainPayers = encryptedMainPrivateKeys.map((key) => {
  const decryptedKey = decrypt(key!);
  return Keypair.fromSecretKey(bs58.decode(decryptedKey));
});

const tipPayers = encryptedTipPrivateKeys.map((key) => {
  const decryptedKey = decrypt(key!);
  return Keypair.fromSecretKey(bs58.decode(decryptedKey));
});

// 当前使用的主钱包索引
let currentMainPayerIndex = 0;

// 获取下一个主钱包
function getNextMainPayer() {
  const mainPayer = mainPayers[currentMainPayerIndex];
  currentMainPayerIndex = (currentMainPayerIndex + 1) % mainPayers.length;
  return mainPayer;
}

// 当前使用的代付钱包索引
let currentTipPayerIndex = 0;

// 获取下一个代付钱包
function getNextTipPayer() {
  const tipPayer = tipPayers[currentTipPayerIndex];
  currentTipPayerIndex = (currentTipPayerIndex + 1) % tipPayers.length;
  return tipPayer;
}

const connection = new Connection(rpcUrl, "processed");
const quoteUrl = `${jupiterUrl}/quote`;
const swapInstructionUrl = `${jupiterUrl}/swap-instructions`;

// WSOL and USDC mint address
const wSolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// 统计变量
let totalRequestCount = 0; // 总请求计数
let jitoRequestCount = 0; // 成功请求计数
let error429Count = 0; // 429 错误计数
let lastLogTime = Date.now();

// 每10秒输出统计信息
function logStatistics() {
  const now = Date.now();
  if (now - lastLogTime >= 10000) {
    logger.warn(
      `统计 - 过去 10 秒：发送请求总量: ${totalRequestCount
        .toString()
        .padStart(3, " ")}, 成功响应量: ${jitoRequestCount
        .toString()
        .padStart(3, " ")}, 平均每秒成功: ${(jitoRequestCount / 10)
        .toFixed(1)
        .padStart(4, " ")}, 429 错误次数: ${error429Count.toString().padStart(3, " ")}`
    );
    // 重置统计变量
    totalRequestCount = 0;
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

// 全局操作计数器
let operationCounter = 0;

// 带耗时的日志输出
function timedLog(message: string, startTime: number, lastStepTime?: number) {
  const elapsed = Date.now() - startTime;
  const stepTime = lastStepTime ? Date.now() - lastStepTime : 0;
  logger.info(
    `[总耗时 ${elapsed.toString().padStart(4, " ")}ms] ` +
      `[步骤耗时 ${stepTime.toString().padStart(4, " ")}ms] ${message}`
  );
  return Date.now(); // 返回当前时间作为下一步的lastStepTime
}

async function run() {
  const start = Date.now();
  const currentOperationId = operationCounter++;
  let lastStepTime = start;

  // lastStepTime = timedLog(`---- 开始执行套利操作 #${currentOperationId} ----`, start, lastStepTime);

  // quote0: WSOL -> USDC
  // lastStepTime = timedLog("获取 WSOL -> USDC 报价", start, lastStepTime);
  const quote0Params = {
    inputMint: wSolMint,
    outputMint: usdcMint,
    amount: 1_000_000_000, // 1 WSOL
    onlyDirectRoutes: false,
    slippageBps: 0,
    maxAccounts: 20,
  };
  const quote0Resp = await axios.get(quoteUrl, { params: quote0Params });
  // lastStepTime = timedLog(
  //   `WSOL -> USDC 报价完成，价格: ${quote0Resp.data.outAmount}`,
  //   start,
  //   lastStepTime
  // );

  // quote1: USDC -> WSOL
  // lastStepTime = timedLog("获取 USDC -> WSOL 报价", start, lastStepTime);
  const quote1Params = {
    inputMint: usdcMint,
    outputMint: wSolMint,
    amount: quote0Resp.data.outAmount,
    onlyDirectRoutes: false,
    slippageBps: 0,
    maxAccounts: 20,
  };
  const quote1Resp = await axios.get(quoteUrl, { params: quote1Params });
  // lastStepTime = timedLog(
  //   `USDC -> WSOL 报价完成，价格: ${quote1Resp.data.outAmount}`,
  //   start,
  //   lastStepTime
  // );

  // profit but not real
  const diffLamports = quote1Resp.data.outAmount - quote0Params.amount;
  // console.log("diffLamports:", diffLamports);
  const jitoTip = Math.floor(diffLamports * 0.95);

  // threhold
  const thre = 10000;
  if (diffLamports > thre) {
    lastStepTime = timedLog(`检测到套利机会，差额: ${diffLamports}`, start, lastStepTime);
    const payer = getNextMainPayer();
    const tipPayer = getNextTipPayer();
    lastStepTime = timedLog(`当前使用的payer: ${payer.publicKey.toBase58()}`, start, lastStepTime);
    lastStepTime = timedLog(
      `当前使用的tipPayer: ${tipPayer.publicKey.toBase58()}`,
      start,
      lastStepTime
    );

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

    lastStepTime = timedLog(`get instructions`, start, lastStepTime);

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
      fromPubkey: tipPayer.publicKey,
      toPubkey: new PublicKey(jitoTipAccounts[Math.floor(Math.random() * 8)]), // 从 Jito tip 账户中随机选择一个
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

    lastStepTime = timedLog(`get addressLookupTableAccounts`, start, lastStepTime);

    // v0 tx
    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(addressLookupTableAccounts);
    const transaction = new VersionedTransaction(messageV0);
    // 签名交易（需要主钱包和代付钱包都签名）
    transaction.sign([payer, tipPayer]);

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

    try {
      totalRequestCount++; // 总请求计数
      // lastStepTime = timedLog(`发送交易到Jito`, start, lastStepTime);

      const bundle_resp = await axios.post(`${jitoUrl}/api/v1/bundles`, bundle, {
        headers: {
          "Content-Type": "application/json",
        },
      } as any);

      if (bundle_resp.status === 200) {
        jitoRequestCount++; // 成功请求计数
        const bundle_id = bundle_resp.data.result;
        lastStepTime = timedLog(`交易成功发送到Jito, bundle id: ${bundle_id}`, start, lastStepTime);
        // lastStepTime = timedLog(`slot: ${mergedQuoteResp.contextSlot}`, start, lastStepTime);
      } else {
        lastStepTime = timedLog(`请求失败，状态码: ${bundle_resp.status}`, start, lastStepTime);
      }
    } catch (error: any) {
      const duration = Date.now() - start;
      if (error.isAxiosError && error.response?.status === 429) {
        error429Count++; // 429 错误计数
        // logger.error(`429: 请求过于频繁, 耗时: ${duration}ms`);
      } else {
        lastStepTime = timedLog(`请求失败，错误: ${error.message}`, start, lastStepTime);
      }
    }
  }
  // lastStepTime = timedLog(`---- 套利操作 #${currentOperationId} 完成 ----`, start, lastStepTime);
}

async function main() {
  while (1) {
    try {
      await run();
    } catch (error) {
      logger.error(`发生错误: ${error.message}`);
    }

    // 输出统计信息
    logStatistics();

    // wait 20ms
    // await wait(20);
  }
}

main();
