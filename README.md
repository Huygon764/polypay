# Private ETH Transfer using zkVerify

A privacy-preserving Ethereum transfer system that uses zero-knowledge proofs to enable anonymous ETH transfers through a pool-based mechanism.

## How It Works

### Overview
This system allows users to transfer ETH privately by breaking the on-chain link between sender and recipient through a pool-based approach combined with zero-knowledge proofs.

### High Level Architecture

```
┌─────────────────────┐    1. Generate ZK Proof     ┌─────────────────────┐
│                     │ ──────────────────────────▶ │                     │
│   User Application  │                             │     zkVerify        │
│   (Privacy Client)  │                             │   (Proof Verifier)  │
│                     │ ◀────────── 4. Get ──────── │                     │
└─────────────────────┘    Aggregation ID           └─────────────────────┘
           │                                                   │
           │                                                   │
           │ 5. Call via Relayer                               │ 2. Aggregate &
           ▼                                                   │    Store Proofs
┌─────────────────────┐                                        │
│                     │                                        ▼
│   Relayer Service   │                              ┌─────────────────────┐
│  (Anonymous Proxy)  │                              │                     │
│                     │                              │   zkVerify Chain    │
└─────────────────────┘                              │  (Proof Registry)   │
           │                                         │                     │
           │ 6. Submit Transaction                   └─────────────────────┘
           ▼                                                   │
┌─────────────────────┐    8. Query Proof Status               │
│                     │ ◀───────────────────────────────────── │
│   Smart Contract    │                                        │
│   (Privacy Pool)    │    7. Verify Aggregated Proof          │
│                     │ ──────────────────────────────────────▶│
└─────────────────────┘                                        │
           │                                                   │
           │ 9. Transfer ETH                                   │
           ▼                                                   │
┌─────────────────────┐                                        │
│                     │                                        │
│    Recipient        │                                        │
│                     │                                        │
└─────────────────────┘                                        │
                                                               │
┌─────────────────────┐    3. Submit & Wait                    │
│                     │ ───────────────────────────────────────┘
│   Ethereum Chain    │
│  (Settlement Layer) │
└─────────────────────┘
```

### Architecture Components

#### 1. Smart Contract (Pool)
- Acts as an ETH pool that holds deposited funds
- Tracks commitments and their associated amounts
- Verifies zero-knowledge proofs via zkVerify integration
- Executes transfers from pool to recipients

#### 2. Zero-Knowledge Circuit
- Proves ownership of a commitment without revealing the private key
- Validates that the user knows the secret behind a specific commitment
- Generates proofs that are verified on-chain through zkVerify

#### 3. Relayer System
- Submits transactions on behalf of users to hide the actual sender
- Pays gas fees for transaction execution
- Ensures the transaction caller is not the original depositor

## Privacy Flow

### Step 1: Deposit
User A deposits ETH → Smart Contract Pool
- Generates commitment = hash(privateKey, nonce)
- Contract stores: `commitmentAmounts[commitment] = depositAmount`
- Public info: Someone deposited X ETH with commitment Y

### Step 2: Private Transfer
User A (or someone with A's private key) initiates transfer:
1. Generate ZK proof proving ownership of commitment
2. Submit proof to zkVerify for verification
3. Relayer calls `privateTransfer()` with verified proof
4. Contract transfers ETH from pool → Recipient

### Step 3: Privacy Achievement
On-chain observers see:
- Transaction 1: User A → Contract (deposit)
- Transaction 2: Relayer → Contract → Recipient (transfer)
- No direct link between User A and Recipient

## Folder Structure

The repository is organized into three main directories:

- **`app/`**: Node.js application that serves as the frontend interface and handles zero-knowledge proof generation
- **`generate_proof/`**: Noir circuits for generating proofs of commitment ownership
- **`contracts/`**: Solidity smart contracts for the privacy pool, managed with Foundry framework

## Prerequisites

Before you begin, ensure you have the following tools installed:

- **[Node.js](https://nodejs.org/en/)**: JavaScript runtime environment
- **[Foundry](https://getfoundry.sh/)**: Ethereum development toolkit for smart contracts
- **[Noirup](https://noir-lang.org/docs/getting_started/quick_start)**: Noir toolchain installer
  
  **Important**: You must use version `1.0.0-beta.12` specifically:
  ```bash
  noirup -v 1.0.0-beta.12
  ```
  Newer versions will not work with the current circuit implementation.

## Development Setup

### Step-by-Step Setup

#### 1. Clone and Install Dependencies

```bash
git clone git@github.com:Poly-pay/polypay.git
cd polypay

# Install Node.js dependencies
cd app
npm install
cd ..
```

#### 2. Compile the Circuit

```bash
cd generate_proof/
nargo compile
```

This will generate `target/generate_proof.json`, which the application uses during proof generation.

#### 3. Environment Configuration

Navigate to the `app/` directory and set up your environment:

```bash
cd app
cp .env.template .env
```

Edit the `.env` file and configure the following variables:

- **RELAYER_API_KEY**: Get your API key from the appropriate relayer service:
  - For Testnet: Visit [https://relayer-testnet.horizenlabs.io/](https://relayer-testnet.horizenlabs.io/)
  - For Mainnet: Visit [https://relayer.horizenlabs.io/](https://relayer.horizenlabs.io/)
- **ETH_SECRET_KEY**: Your Ethereum private key

#### 4. Register Verification Key Hash

From the `app/` directory, register the verification key:

```bash
npm run registerVK
```

**Note**: This step requires your `.env` file to be properly configured. The command will register the verification key and output a `vkHash` value.

#### 5. Update Contract Environment

Copy the generated `vkHash` to the `.env` file in the `contracts/` directory.

#### 6. Deploy Smart Contract

Navigate to the contracts directory and deploy the smart contract:

```bash
cd contracts
forge script script/PrivateTransferContract.s.sol:ZkvVerifierContractScript \
  --rpc-url wss://ethereum-sepolia-rpc.publicnode.com \
  --private-key=YOUR_PRIVATE_KEY \
  --broadcast
```

**Important**: Replace `YOUR_PRIVATE_KEY` with your actual private key.

#### 7. Update App Configuration

Complete the configuration by updating these values:

- Save the deployed contract address to the `.env` file in the `app/` directory
- Update the relayer private key in `app.js`:

```javascript
this.relayerWallet = new ethers.Wallet(
  "YOUR_PRIVATE_KEY", // Replace with your relayer private key
  provider
);
```

#### 8. Run the Application

Start the application:

```bash
cd app
npm run start
```

## End-to-End User Workflow

1. **Generate a Proof**: The user interacts with the app, which uses the compiled Noir circuit and proving artifacts to generate a zero-knowledge proof.
2. **Submit Proof to zkVerify**: The DApp sends the generated proof and public inputs to zkVerify for verification
3. **Receive Proof ID**: zkVerify verifies the proof and returns proof
4. **Execute Private Transfer**: The relayer calls the smart contract with the proof, enabling anonymous transfer from pool to recipient
5. **On-Chain Attestation**: The smart contract verifies the proof through zkVerify's attestation contract

## Next Steps

Check out [zkVerify documentation](https://docs.zkverify.io/) for additional info and tutorials:
- [zkVerify Contracts](https://docs.zkverify.io/overview/contract-addresses)
- [zkVerify Supported Verifiers](https://docs.zkverify.io/overview/supported_proofs)
- [zkVerifyJS](https://docs.zkverify.io/overview/zkverifyjs)
- [Dapp Developer Tutorial](https://docs.zkverify.io/overview/getting-started/smart-contract)
- [Utility Solidity Library for DApp Developers](https://github.com/zkVerify/zkv-attestation-contracts/tree/main/contracts/verifiers)
- [zkVerify Aggregation Contract](https://github.com/zkVerify/zkv-attestation-contracts/blob/main/contracts/ZkVerifyAggregationGlobal.sol)
