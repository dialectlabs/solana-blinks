import { ActionGetResponse, ActionPostRequest, ActionPostResponse, ACTIONS_CORS_HEADERS, BLOCKCHAIN_IDS } from "@solana/actions";
import { createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, Connection, VersionedTransaction, } from "@solana/web3.js";

// CAIP-2 Solana Devnet
const blockchain = BLOCKCHAIN_IDS.devnet;

// Create a connection to Solana
const connection = new Connection(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com');

// Headers
const headers = {
    ...ACTIONS_CORS_HEADERS,
    'x-blockchain-ids': blockchain,
    'x-action-version': '2.4'
};

// Helper function to check if token is SOL
const isSolToken = (token: string): boolean => {
    return token.toUpperCase() === 'SOL' || token.toUpperCase() === 'SOLANA' || token === 'So11111111111111111111111111111111111111112';
};

// Helper function to get token decimals
const getTokenDecimals = async (tokenMint: PublicKey): Promise<number> => {
    const mintInfo = await getMint(connection, tokenMint);
    return mintInfo.decimals;
};

// Helper function to calculate token amount with decimals
const calculateTokenAmount = (amount: number, decimals: number): bigint => {
    return BigInt(amount * Math.pow(10, decimals));
};

// Helper function to create SOL transfer transaction
const createSolTransferTransaction = async (payer: PublicKey, recipient: PublicKey, amount: number): Promise<VersionedTransaction> => {
    // Create a transfer instruction
    const transferInstruction = SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: amount * LAMPORTS_PER_SOL
    });

    // Get the recent blockhash
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Create a transaction message
    const transactionMessage = new TransactionMessage({
        payerKey: payer,
        recentBlockhash,
        instructions: [transferInstruction]
    }).compileToV0Message();

    return new VersionedTransaction(transactionMessage);
};

// Helper function to create SPL token transfer transaction
const createSplTokenTransferTransaction = async (payer: PublicKey, recipient: PublicKey, token: string, amount: number): Promise<VersionedTransaction> => {
    // Create a token mint
    const tokenMint = new PublicKey(token);

    // Get the recipient token address
    const recipientTokenAddress = await getAssociatedTokenAddress(tokenMint, recipient);

    // Get the payer token address
    const payerTokenAddress = await getAssociatedTokenAddress(tokenMint, payer);

    // Get the recipient token account
    const recipientTokenAccount = await connection.getAccountInfo(recipientTokenAddress);

    // Create a transaction instruction
    const ix = [];

    // Check if the recipient token account does not exist
    if (!recipientTokenAccount) {
        ix.push(createAssociatedTokenAccountInstruction(
            payer,
            recipientTokenAddress,
            recipient,
            tokenMint
        ));
    }

    // Get the token decimals
    const decimals = await getTokenDecimals(tokenMint);

    // Calculate the token amount
    const tokenAmount = calculateTokenAmount(amount, decimals);

    // Create a transfer checked instruction
    ix.push(
        createTransferCheckedInstruction(
            payerTokenAddress,
            tokenMint,
            recipientTokenAddress,
            payer,
            tokenAmount,
            decimals
        )
    );

    // Create a transaction message
    const transactionMessage = new TransactionMessage({
        payerKey: payer,
        instructions: ix,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    }).compileToV0Message();

    // Return a new versioned transaction
    return new VersionedTransaction(transactionMessage);
};

// OPTIONS handler
export const OPTIONS = async () => {
    return new Response(null, { headers });
}

// GET handler
export const GET = async (req: Request) => {
    // Construct an URL
    const url = new URL(req.url);

    // Create a image URL
    const imageUrl = new URL('/transfer_blink.png', url).toString();

    // Create a payload
    const payload: ActionGetResponse = {
        type: 'action',
        title: 'Solana Transfer Blink',
        description: 'Transfer any token on Solana with this Blink.',
        icon: imageUrl,
        label: 'Send tokens',
        links: {
            actions: [
                {
                    type: 'transaction',
                    href: `/api/actions/transfer?toWallet={toWallet}&token={token}&amount={amount}`,
                    label: 'Send',
                    parameters: [
                        {
                            name: 'toWallet',
                            required: true,
                            type: 'text',
                            label: 'Enter recipient wallet address'
                        },
                        {
                            name: 'token',
                            required: true,
                            type: 'text',
                            label: 'Enter the token you want to send'
                        },
                        {
                            name: 'amount',
                            required: true,
                            type: 'number',
                            label: 'Enter the amount you want to send'
                        }
                    ]
                }
            ]
        }
    }

    // Return the payload
    return new Response(JSON.stringify(payload), { headers });
}

// POST handler
export const POST = async (req: Request) => {
    try {
        // Extract the parameters from the request
        const url = new URL(req.url);
        const wallet = url.searchParams.get('toWallet');
        const token = url.searchParams.get('token');
        const amount = url.searchParams.get('amount');

        // Check if the parameters are provided
        if (!wallet || !token || !amount) {
            return new Response(JSON.stringify({ error: 'Missing required parameters, you need to provide a wallet, token and amount.' }), { status: 400 });
        }

        // Extract the account from the request
        const request: ActionPostRequest = await req.json();
        const { account } = request;

        // Create a public key from the wallet address
        const recipient = new PublicKey(wallet);
        const payer = new PublicKey(account);

        // Convert the amount to a number
        const amountNumber = Number(amount);

        // Create a transaction
        const transaction = isSolToken(token)
            ? await createSolTransferTransaction(payer, recipient, amountNumber)
            : await createSplTokenTransferTransaction(payer, recipient, token, amountNumber);

        // Create a payload
        const payload = {
            type: 'transaction',
            transaction: Buffer.from(transaction.serialize()).toString('base64'),
        };

        // Return the payload
        return new Response(JSON.stringify(payload), { headers });

    } catch (error) {
        // Log the error
        console.error(error);

        // Return an error response
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
    }
}