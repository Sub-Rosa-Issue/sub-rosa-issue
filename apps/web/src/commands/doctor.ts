import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

export const DoctorCommand = new Command('doctor')
  .description('Validates configuration setup and prints actionable diagnostics for the keeper operator.')
  .action(async () => {
    console.log('🩺 Starting Keeper Configuration Doctor Diagnostics...\n');
    let hasFailures = false;

    // Helper to log visual status markers
    const logResult = (status: 'PASS' | 'WARN' | 'FAIL', checkName: string, hint?: string) => {
      const symbols = { PASS: '✅ [PASS]', WARN: '⚠️ [WARN]', FAIL: '❌ [FAIL]' };
      console.log(`${symbols[status]} ${checkName}`);
      if (hint) console.log(`   💡 Hint: ${hint}`);
    };

    // 1. Validate RPC Connection Structure
    const rpcUrl = process.env.KEEPER_RPC_URL;
    if (!rpcUrl) {
      logResult('FAIL', 'KEEPER_RPC_URL variable is not set.', 'Provide a valid HTTP/HTTPS RPC endpoint.');
      hasFailures = true;
    } else {
      try {
        const url = new URL(rpcUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          logResult('FAIL', `Malformed KEEPER_RPC_URL: ${rpcUrl}`, 'Ensure your provider link includes http or https schema prefix.');
          hasFailures = true;
        } else {
          logResult('PASS', 'RPC URL is structured correctly.');
        }
      } catch {
        logResult('FAIL', `Invalid KEEPER_RPC_URL configuration: "${rpcUrl}"`, 'Provide a legitimate URL structure string.');
        hasFailures = true;
      }
    }

    // 2. Validate Drand Endpoint Layout
    const drandUrl = process.env.DRAND_ENDPOINT_URL;
    if (!drandUrl) {
      logResult('WARN', 'DRAND_ENDPOINT_URL is missing.', 'Keeper fallbacks will be used if randomness triggers fail.');
    } else {
      try {
        new URL(drandUrl);
        logResult('PASS', 'Drand endpoint connection pattern is valid.');
      } catch {
        logResult('FAIL', 'Drand URL format structure is invalid.', 'Check if there are trailing symbols or malformed parameters.');
        hasFailures = true;
      }
    }

    // 3. Validate Artifact Paths & Files
    const artifactPath = process.env.CONTRACT_ARTIFACT_PATH || './artifacts/DripsContract.json';
    const absoluteArtifactPath = path.resolve(artifactPath);
    if (!fs.existsSync(absoluteArtifactPath)) {
      logResult('FAIL', `Contract artifact file not found at path: ${artifactPath}`, 'Ensure contracts are compiled or map CONTRACT_ARTIFACT_PATH accurately.');
      hasFailures = true;
    } else {
      try {
        const rawContent = fs.readFileSync(absoluteArtifactPath, 'utf8');
        JSON.parse(rawContent);
        logResult('PASS', 'Contract ABI artifact discovered and validated as clean JSON.');
      } catch {
        logResult('FAIL', 'Contract artifact file exists but contains unparsable corrupted JSON structural elements.', 'Recompile smart contract payloads.');
        hasFailures = true;
      }
    }

    // 4. Validate Network Passphrase Details
    const networkPassphrase = process.env.NETWORK_PASSPHRASE;
    if (!networkPassphrase) {
      logResult('WARN', 'NETWORK_PASSPHRASE is undefined.', 'The system will default to standalone public network settings.');
    } else {
      logResult('PASS', `Network verification passphrase recognized. (${networkPassphrase.substring(0, 8)}...)`);
    }

    // 5. Validate Optional Persistence Paths
    const persistencePath = process.env.PERSISTENCE_PATH;
    if (persistencePath) {
      const absolutePersistencePath = path.resolve(persistencePath);
      if (!fs.existsSync(absolutePersistencePath)) {
        logResult('WARN', `Optional persistence path does not exist: ${persistencePath}`, 'The directory will be created if the keeper requires state persistence, or ensure it is pre-provisioned.');
      } else {
        logResult('PASS', 'Optional persistence path is properly configured and exists.');
      }
    } else {
      logResult('PASS', 'No optional persistence path provided, continuing ephemerally.');
    }

    // Guardrail evaluation response printouts
    console.log('\n--- Diagnostic Run Summary ---');
    if (hasFailures) {
      console.log('❌ Configuration issues were caught. Rectify validation failures listed above before starting watch loops.');
      process.exit(1);
    } else {
      console.log('🚀 Operational configurations look excellent! Ready to launch your keeper supervisor pipeline safely.');
      process.exit(0);
    }
  });