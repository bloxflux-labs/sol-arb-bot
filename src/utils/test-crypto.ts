import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { decrypt, encrypt } from "./cryptoUtils";

// 测试加密和解密
const originalKey = process.env.PRIVATE_KEY;
// const originalKey = "";
if (!originalKey) {
  throw new Error("PRIVATE_KEY is not defined in environment variables");
}
const encryptedKey = encrypt(originalKey);
console.log("Encrypted Key:", encryptedKey);

// 从环境变量中获取加密后的私钥并解密
// const encryptedPrivateKey = process.env.ENCRYPTED_PRIVATE_KEY;
// if (!encryptedPrivateKey) {
//   throw new Error("ENCRYPTED_PRIVATE_KEY is not defined in environment variables");
// }
// console.log("Encrypted Private Key:", encryptedPrivateKey);

const decryptedKey = decrypt(encryptedKey);
// console.log("Decrypted Key:", decryptedKey);

const payer = Keypair.fromSecretKey(bs58.decode(decryptedKey));
console.log(`payer: ${payer.publicKey.toBase58()}`);
