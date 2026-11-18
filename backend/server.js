
import http from 'node:http';
import { URL } from 'node:url';
import { supabase } from './supabase.js';

const PORT = process.env.PORT || 5000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    process.env.FRONTEND_URL
].filter(Boolean);

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json'
    });

    res.end(JSON.stringify(data));
}

function setCors(req, res) {
    const origin = req.headers.origin;

    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (!origin || allowedOrigins.includes(origin)) {
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }

        return true;
    }

    return false;
}

async function readBody(req) {
    let body = '';

    for await (const chunk of req) {
        body += chunk;

        if (body.length > 100000) {
            throw Object.assign(
                new Error('Request body is too large'),
                { status: 413 }
            );
        }
    }

    try {
        const data = JSON.parse(body || '{}');

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error();
        }

        return data;
    } catch {
        throw Object.assign(
            new Error('Request body must be a JSON object'),
            { status: 400 }
        );
    }
}

function handleDatabaseError(error) {
    const safeMessages = {
        P0001: error.message,
        P0002: 'Transfer not found',
        '22023': error.message,
        '22P02': 'IDs must be valid UUIDs',
        '23514': 'Transfer data did not meet a database rule',
        '23503': 'The selected product or store is not available',
        '23505': 'A record with the same value already exists'
    };
    const message = safeMessages[error.code];
    const result = new Error(message || 'Database request failed');

    result.status = error.code === 'P0002'
        ? 404
        : message
            ? 400
            : 500;

    return result;
}

async function getStock() {
    const results = await Promise.all([
        supabase.from('products').select('id, name').order('name'),
        supabase.from('stores').select('id, name').order('name'),
        supabase
            .from('store_stock')
            .select('product_id, store_id, quantity')
    ]);

    for (const result of results) {
        if (result.error) {
            throw handleDatabaseError(result.error);
        }
    }

    return {
        products: results[0].data,
        stores: results[1].data,
        stock: results[2].data
    };
}

async function getTransfers() {
    const results = await Promise.all([
        supabase
            .from('transfers')
            .select('*')
            .order('created_at', { ascending: false }),

        supabase.from('products').select('id, name'),

        supabase.from('stores').select('id, name')
    ]);

    for (const result of results) {
        if (result.error) {
            throw handleDatabaseError(result.error);
        }
    }

    const productNames = new Map(
        results[1].data.map(product => [
            product.id,
            product.name
        ])
    );

    const storeNames = new Map(
        results[2].data.map(store => [
            store.id,
            store.name
        ])
    );

    const transfers = results[0].data.map(transfer => ({
        ...transfer,
        product_name: productNames.get(transfer.product_id),
        source_name: storeNames.get(transfer.source_store_id),
        destination_name: storeNames.get(transfer.destination_store_id)
    }));

    return transfers;
}

async function createTransfer(body) {
    const {
        productId,
        sourceStoreId,
        destinationStoreId,
        quantity
    } = body;

    if (
        !UUID_PATTERN.test(productId || '') ||
        !UUID_PATTERN.test(sourceStoreId || '') ||
        !UUID_PATTERN.test(destinationStoreId || '')
    ) {
        throw Object.assign(
            new Error('Select a valid product and both stores'),
            { status: 400 }
        );
    }

    if (
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
    ) {
        throw Object.assign(
            new Error('Quantity must be a positive whole number'),
            { status: 400 }
        );
    }

    if (sourceStoreId === destinationStoreId) {
        throw Object.assign(
            new Error('Source and destination must be different'),
            { status: 400 }
        );
    }

    const { data, error } = await supabase.rpc(
        'create_transfer',
        {
            p_product_id: productId,
            p_source_store_id: sourceStoreId,
            p_destination_store_id: destinationStoreId,
            p_quantity: quantity
        }
    );

    if (error) {
        throw handleDatabaseError(error);
    }

    return {
        id: data,
        message: 'Transfer created successfully'
    };
}

async function changeTransferStatus(id, action) {
    if (!UUID_PATTERN.test(id)) {
        throw Object.assign(
            new Error('Transfer ID must be a valid UUID'),
            { status: 400 }
        );
    }

    const functionName =
        action === 'dispatch'
            ? 'dispatch_transfer'
            : 'receive_transfer';

    const { data, error } = await supabase.rpc(
        functionName,
        {
            p_transfer_id: id
        }
    );

    if (error) {
        throw handleDatabaseError(error);
    }

    return {
        id: data,
        message:
            action === 'dispatch'
                ? 'Transfer dispatched successfully'
                : 'Transfer received successfully'
    };
}

async function handleRequest(req, res) {
    const corsAllowed = setCors(req, res);

    if (!corsAllowed) {
        sendJson(res, 403, {
            error: 'Origin not allowed'
        });

        return;
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(
        req.url,
        `http://${req.headers.host || 'localhost'}`
    );

    const path = url.pathname;

    try {
        if (req.method === 'GET' && path === '/api/health') {
            sendJson(res, 200, {
                message: 'Node.js backend is running'
            });

            return;
        }

        if (req.method === 'GET' && path === '/api/stock') {
            const stock = await getStock();
            sendJson(res, 200, stock);
            return;
        }

        if (req.method === 'GET' && path === '/api/transfers') {
            const transfers = await getTransfers();
            sendJson(res, 200, transfers);
            return;
        }

        if (req.method === 'POST' && path === '/api/transfers') {
            const body = await readBody(req);
            const result = await createTransfer(body);

            sendJson(res, 201, result);
            return;
        }

        const match = path.match(
            /^\/api\/transfers\/([^/]+)\/(dispatch|receive)$/
        );

        if (req.method === 'POST' && match) {
            const transferId = match[1];
            const action = match[2];

            const result = await changeTransferStatus(
                transferId,
                action
            );

            sendJson(res, 200, result);
            return;
        }

        sendJson(res, 404, {
            error: 'API route not found'
        });

    } catch (error) {
        console.error('Request failed:', error.message);

        sendJson(res, error.status || 500, {
            error: error.status
                ? error.message
                : 'The server could not complete the request'
        });
    }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});
