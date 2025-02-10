import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// 生成符合要求的钱包地址
function generateVanityWallet(prefix: string, suffix: string, count: number): Keypair[] {
  const wallets: Keypair[] = [];
  let attempts = 0;

  while (wallets.length < count) {
    attempts++;
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();

    // 检查是否匹配前缀和后缀
    if (publicKey.startsWith(prefix) && publicKey.endsWith(suffix)) {
      wallets.push(keypair);
      console.log(`Found matching wallet: ${publicKey}`);
    }

    // 每10000次尝试打印进度
    if (attempts % 10000 === 0) {
      console.log(`Attempts: ${attempts}, Found: ${wallets.length}`);
    }
  }

  return wallets;
}

// 主函数
async function main() {
  const prefix = "567"; // 自定义前缀
  const suffix = ""; // 自定义后缀
  const count = 5; // 要生成的钱包数量

  console.log(
    `Generating ${count} wallets starting with '${prefix}' and ending with '${suffix}'...`
  );

  const startTime = Date.now();
  const wallets = generateVanityWallet(prefix, suffix, count);
  const endTime = Date.now();

  console.log(`\nGenerated ${wallets.length} wallets in ${(endTime - startTime) / 1000} seconds:`);

  // 打印生成的钱包信息
  wallets.forEach((wallet, index) => {
    console.log(`\nWallet ${index + 1}:`);
    console.log(`Public Key: ${wallet.publicKey.toBase58()}`);
    console.log(`Private Key: ${bs58.encode(wallet.secretKey)}`);
  });
}

main().catch(console.error);
