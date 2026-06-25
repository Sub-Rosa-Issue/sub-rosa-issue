# Testnet Wallet Proof

## Manual Verification Required

As an automated agent, I am unable to interact with browser extension wallets (like Freighter or Albedo) to cryptographically sign a transaction and produce a valid Testnet hash. 

Therefore, **manual verification remains required** to confirm the end-to-end integration of the Stellar Wallets Kit adapter.

### Verification Checklist for Reviewer

Please follow these steps to generate the proof and verify the adapter works:

1. **Start the Web App**
   Run `pnpm web:dev` and open the demo page in your browser.

2. **Connect Wallet**
   - Click "Connect Wallet".
   - The Stellar Wallets Kit modal should appear.
   - Select Freighter (or another supported wallet).
   - Ensure the wallet connects successfully. 
   - **Expected Result:** The UI should show "Connected on Testnet" (if on testnet).

3. **Verify Wrong-Network Blocking**
   - Switch your wallet to Mainnet or Futurenet.
   - Try connecting again (or view the UI if state updates).
   - **Expected Result:** The UI should display a red "Wrong Network" indicator and all action buttons (Commit/Reveal) should be disabled.

4. **Verify Unsupported Capabilities Blocking**
   - Use a wallet known to not support Soroban Auth Entries (e.g., Albedo).
   - **Expected Result:** The UI should display an "Unsupported Wallet" alert and block contract execution.

5. **Generate Transaction Proof**
   - Ensure you are on **Testnet**.
   - Create a round, or join an existing one.
   - Click to **Commit** your sealed entry.
   - Sign the transaction and the Soroban Auth Entry in your wallet.
   - **Expected Result:** The transaction succeeds and is confirmed on-chain.
   
Please paste the resulting transaction hash or signed XDR here once manual verification is complete:

- **Wallet Used:** [e.g. Freighter v5.x]
- **Network:** Testnet
- **Commit Transaction Hash:** [Paste Hash Here]
- **Reveal Transaction Hash:** [Paste Hash Here]
