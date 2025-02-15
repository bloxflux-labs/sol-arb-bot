import {
  ComputeBudgetProgram,
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
import { getAddressLookupTables } from "./utils/altUtils";
import { checkTempWalletBalance } from "./utils/balanceUtils";
import { getBlockhashWithCache } from "./utils/blockhashUtils";
import { decrypt } from "./utils/cryptoUtils";
import { getRandomTipAccount } from "./utils/jitoUtils";
import { timedLog } from "./utils/logUtils";

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

// 最小利润
const minQuoteProfit = parseInt(process.env.MIN_QUOTE_PROFIT || "10000");
logger.info(`最小利润: ${minQuoteProfit}`);

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

// const connection = new Connection(rpcUrl, "processed");
const quoteUrl = `${jupiterUrl}/quote`;
const swapInstructionUrl = `${jupiterUrl}/swap-instructions`;

// WSOL and USDC mint address
const wSolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

// 全局操作计数器
let operationCounter = 0;

// 记录临时钱包
const tempWallets: { keypair: Keypair; used: boolean }[] = [];

// 获取下一个临时钱包
function getNextTempWallet() {
  const tempWallet = Keypair.generate();
  tempWallets.push({ keypair: tempWallet, used: false });
  return tempWallet;
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
  if (diffLamports > minQuoteProfit) {
    lastStepTime = timedLog(`检测到套利机会，差额: ${diffLamports}`, start, lastStepTime);
    const payer = getNextMainPayer();
    // 创建临时钱包
    // const tempWallet = getNextTempWallet();
    const tempWallet = getNextTipPayer();

    lastStepTime = timedLog(`当前使用的payer: ${payer.publicKey.toBase58()}`, start, lastStepTime);
    lastStepTime = timedLog(
      `当前使用的tempWallet: ${tempWallet.publicKey.toBase58()}`,
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

    // 主钱包向临时钱包转账
    // const transferToTempInstruction = SystemProgram.transfer({
    //   fromPubkey: payer.publicKey,
    //   toPubkey: tempWallet.publicKey,
    //   lamports: jitoTip + 10000, // 转账金额 = tip + 少量额外费用
    // });
    // ixs.push(transferToTempInstruction);

    // 随机选择小费账户
    const randomTipAccount = getRandomTipAccount();

    // tip 交易指令
    const tipIxs: TransactionInstruction[] = [
      SystemProgram.transfer({
        fromPubkey: tempWallet.publicKey,
        toPubkey: new PublicKey(randomTipAccount),
        lamports: jitoTip,
      }),
    ];

    const blockhash = await getBlockhashWithCache();

    // 获取地址查找表
    const addressLookupTableAccounts = await getAddressLookupTables(
      instructions.addressLookupTableAddresses
    );

    // 构建 tip 交易
    const tipMessageV0 = new TransactionMessage({
      payerKey: tempWallet.publicKey,
      recentBlockhash: blockhash,
      instructions: tipIxs,
    }).compileToV0Message(addressLookupTableAccounts);
    const tipTransaction = new VersionedTransaction(tipMessageV0);
    tipTransaction.sign([tempWallet]); // 临时钱包签名

    // 临时钱包余额转回主钱包
    // const transferBackInstruction = SystemProgram.transfer({
    //   fromPubkey: tempWallet.publicKey,
    //   toPubkey: payer.publicKey,
    //   lamports: 10000, // 转回剩余的少量费用
    // });
    // ixs.push(transferBackInstruction);

    lastStepTime = timedLog(`get addressLookupTableAccounts`, start, lastStepTime);

    // 构建主交易
    const mainMessageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(addressLookupTableAccounts);
    const mainTransaction = new VersionedTransaction(mainMessageV0);
    mainTransaction.sign([payer]); // 主钱包签名

    // simulate
    // const simulationResult = await connection.simulateTransaction(transaction);
    // console.log(JSON.stringify(simulationResult));

    // 序列化交易
    const serializedMainTransaction = mainTransaction.serialize();
    const serializedTipTransaction = tipTransaction.serialize();

    // 构建 Bundle
    const bundle = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [
        [
          bs58.encode(serializedMainTransaction), // 主交易
          bs58.encode(serializedTipTransaction), // tip 交易
        ],
      ],
    };

    // 发送 Bundle
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
        // 检查临时钱包余额
        await checkTempWalletBalance(tempWallet);
      }
    } catch (error: any) {
      const duration = Date.now() - start;
      if (error.isAxiosError && error.response?.status === 429) {
        error429Count++; // 429 错误计数
        // logger.error(`429: 请求过于频繁, 耗时: ${duration}ms`);
      } else {
        lastStepTime = timedLog(`请求失败，错误: ${error.message}`, start, lastStepTime);
        // 检查临时钱包余额
        await checkTempWalletBalance(tempWallet);
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
