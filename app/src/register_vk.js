const fs = require("fs");
const path = require("path");
const { UltraPlonkBackend } = require("@aztec/bb.js");
const axios = require("axios");
const { API_URL } = require("./constants");
require("dotenv").config({ path: [".env"] });

const resolve = (...p) => path.join(__dirname, ...p);
const DATA_DIR = resolve("../../data");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function getVerificationKey() {
  const circuitPath = path.join(
    __dirname,
    "../../generate_proof/target/generate_proof.json"
  );

  if (!fs.existsSync(circuitPath)) {
    console.log(circuitPath);
    throw new Error(`Circuit file not found: ${circuitPath}`);
  }

  const { bytecode } = JSON.parse(fs.readFileSync(circuitPath));
  const backend = new UltraPlonkBackend(bytecode, {
    threads: 2,
  });
  const vk = await backend.getVerificationKey();
  return vk;
}

async function registerVk(vk) {
  if (!process.env.RELAYER_API_KEY) {
    throw new Error("RELAYER_API_KEY is not set in environment");
  }

  const params = {
    proofType: "ultraplonk",
    vk: Buffer.from(vk).toString("base64"),
    proofOptions: { numberOfPublicInputs: 1 },
  };

  const outputPath = path.join(DATA_DIR, "vkey.json");

  try {
    const { data } = await axios.post(
      `${API_URL}/register-vk/${process.env.RELAYER_API_KEY}`,
      params
    );
    console.log("VK registered successfully:", data);
    writeJson(outputPath, { success: true, ...data });
    return data;
  } catch (error) {
    const errorData = error.response?.data || { message: error.message };
    console.error("Failed to register VK:", errorData);
    writeJson(outputPath, { success: false, error: errorData });
    throw error;
  }
}

async function run() {
  console.log("Getting verification key...");
  const vk = await getVerificationKey();

  console.log("Registering VK with relayer...");
  await registerVk(vk);

  console.log("Done!");
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
