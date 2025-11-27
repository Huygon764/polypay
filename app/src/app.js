const fs = require("fs");
const path = require("path");
const ethers = require("ethers");
const { poseidon2HashAsync } = require("@zkpassport/poseidon2");
const { UltraPlonkBackend } = require("@aztec/bb.js");
const { Noir } = require("@noir-lang/noir_js");
const axios = require("axios");
const { API_URL } = require("./constants");
require("dotenv").config({ path: [".env"] });

class PrivateTransferManager {
  constructor(provider, privateKey, contractAddress) {
    this.provider = provider;
    this.userPrivateKey = privateKey;
    this.wallet = new ethers.Wallet(privateKey, provider);
    // for now just assume relayer wallet is hardcoded here
    this.relayerWallet = new ethers.Wallet(
      "YOUR_PRIVATE_KEY", // relayer private key (change this to something for your own use)
      provider
    );
    this.contract = new ethers.Contract(
      contractAddress,
      ABI,
      this.relayerWallet
    ); // Use relayer wallet to send tx cause we dont want to expose user wallet (sender)
  }

  generateCommitment(privateKey, nonce) {
    const result = poseidon2HashAsync([BigInt(privateKey), BigInt(nonce)]);
    return result;
  }

  generateNullifier(privateKey, commitment) {
    const result = poseidon2HashAsync([BigInt(privateKey), BigInt(commitment)]);
    return result;
  }

  async deposit(amountInWei) {
    console.log("🔐 Depositing tokens to get private commitment...");

    const nonceTx = await this.provider.getTransactionCount(
      this.relayerWallet.address,
      "pending"
    );

    const commitment = await this.generateCommitment(
      this.userPrivateKey,
      nonceTx
    );

    try {
      const tx = await this.contract.deposit(BigInt(commitment), {
        value: amountInWei,
        nonce: nonceTx,
      });
      await tx.wait();
    } catch (error) {
      console.log("Insufficient funds for deposit", error);
    }

    console.log(`✅ Deposited! Commitment: ${commitment}`);
    return { commitment, nonce: nonceTx };
  }

  // Execute private transfer
  async privateTransfer(recipient, amountInWei, currentNonce) {
    console.log(
      `🔒 Starting private transfer of ${amountInWei} to ${recipient}...`
    );

    // Calculate commitment and nullifier
    const commitment = await this.generateCommitment(
      this.userPrivateKey,
      currentNonce
    );

    const nullifier = await this.generateNullifier(
      this.userPrivateKey,
      commitment
    );

    const input = {
      // Private inputs
      private_key: this.userPrivateKey.toString(),
      nonce: BigInt(currentNonce).toString(),

      // Public inputs
      commitment: commitment.toString(),
      nullifier: nullifier.toString(),
    };

    // Generate ZK proof
    console.log("🔄 Generating ZK proof...");
    const circuitPath = path.join(
      __dirname,
      "../../generate_proof/target/generate_proof.json"
    );

    if (!fs.existsSync(circuitPath)) {
      console.log(circuitPath);
      throw new Error(`Circuit file not found: ${circuitPath}`);
    }

    const { bytecode, abi } = JSON.parse(fs.readFileSync(circuitPath));

    const noir = new Noir({ bytecode: bytecode, abi: abi });
    const execResult = await noir.execute(input);

    const plonk = new UltraPlonkBackend(bytecode, { threads: 2 });
    const { proof, publicInputs } = await plonk.generateProof(
      execResult.witness
    );

    const proofUint8 = new Uint8Array(proof);

    const vk = fs.readFileSync(
      path.join(process.cwd(), "../data/", "vkey.json"),
      "utf-8"
    );

    const params = {
      proofType: "ultraplonk",
      vkRegistered: true,
      chainId: 11155111,
      proofOptions: {
        numberOfPublicInputs: 2,
      },
      proofData: {
        proof: Buffer.from(
          concatenatePublicInputsAndProof(publicInputs, proofUint8)
        ).toString("base64"),
        vk: JSON.parse(vk).vkHash || JSON.parse(vk).meta.vkHash,
      },
    };

    const requestResponse = await axios.post(
      `${API_URL}/submit-proof/${process.env.RELAYER_API_KEY}`,
      params
    );

    if (requestResponse.data.optimisticVerify != "success") {
      console.error("Proof verification, check proof artifacts");
      return;
    }

    while (true) {
      try {
        const jobStatusResponse = await axios.get(
          `${API_URL}/job-status/${process.env.RELAYER_API_KEY}/${requestResponse.data.jobId}`
        );
        if (jobStatusResponse.data.status === "Aggregated") {
          console.log("Job aggregated successfully");
          console.log(jobStatusResponse.data);

          // Transfer private
          console.log("Waiting for aggregation on other chain...");
          await new Promise((resolve) => setTimeout(resolve, 40000)); // wait 40s
          console.log("🚀 Executing private transfer...");
          const tx = await this.contract.privateTransfer(
            jobStatusResponse.data.aggregationId,
            0,
            jobStatusResponse.data.aggregationDetails.merkleProof,
            jobStatusResponse.data.aggregationDetails.numberOfLeaves,
            jobStatusResponse.data.aggregationDetails.leafIndex,
            ethers.getAddress(recipient),
            BigInt(amountInWei),
            BigInt(commitment),
            BigInt(nullifier)
          );

          const receiptTx = await tx.wait();
          console.log(`✅ Private transfer completed! Tx: ${receiptTx.hash}`);
          return;
        } else {
          console.log("Job status: ", jobStatusResponse.data.status);
          console.log("Waiting for job to aggregated...");
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds before checking again
        }
      } catch (error) {
        throw error;
      }
    }
  }
}

// Contract ABI
const ABI = [
  "function deposit(uint256 commitment)",
  "function privateTransfer(uint256 aggregationId, uint256 domainId, bytes32[] calldata merklePath, uint256 leafCount, uint256 index, address recipient, uint256 amount, uint256 commitment, uint256 nullifier)",
];

function hexToUint8Array(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length % 2 !== 0) hex = "0" + hex;

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function concatenatePublicInputsAndProof(publicInputsHex, proofUint8) {
  const publicInputBytesArray = publicInputsHex.flatMap((hex) =>
    Array.from(hexToUint8Array(hex))
  );

  const publicInputBytes = new Uint8Array(publicInputBytesArray);

  console.log(publicInputBytes.length, proofUint8.length);

  const newProof = new Uint8Array(publicInputBytes.length + proofUint8.length);
  newProof.set(publicInputBytes, 0);
  newProof.set(proofUint8, publicInputBytes.length);

  return newProof;
}

async function main() {
  // Setup
  const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);

  const manager = new PrivateTransferManager(
    provider,
    process.env.ETH_SECRET_KEY,
    process.env.ETH_APP_CONTRACT_ADDRESS
  );
  const amountToSend = ethers.parseEther("0.0001");

  // 1. Deposit to get private commitment
  const { commitment, nonce } = await manager.deposit(amountToSend);

  // 2. Execute private transfer
  await manager.privateTransfer(
    "0x224ECBb02B07601d21a5714BB23571Dd124F9ED6", // recipient
    amountToSend,
    nonce
  );
}

main().catch(console.error);
