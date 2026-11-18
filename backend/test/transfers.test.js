
import test from 'node:test';
import assert from 'node:assert/strict';

const API_URL = process.env.API_URL || 'http://localhost:5000';

async function api(path, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_URL}${path}`, options);

    return {
        status: response.status,
        data: await response.json()
    };
}

async function createTestTransfer(productId, sourceId, destinationId, quantity) {
    const result = await api('/api/transfers', 'POST', {
        productId,
        sourceStoreId: sourceId,
        destinationStoreId: destinationId,
        quantity
    });

    assert.equal(
        result.status,
        201,
        'Test transfer should be created'
    );

    return result.data.id;
}

// Test 1: A transfer cannot be received before dispatch.
test('receiving a pending transfer must fail', async () => {
    const stockData = await api('/api/stock');

    const product = stockData.data.products[0];
    const source = stockData.data.stores[0];
    const destination = stockData.data.stores[1];

    const transferId = await createTestTransfer(
        product.id,
        source.id,
        destination.id,
        1
    );

    const result = await api(
        `/api/transfers/${transferId}/receive`,
        'POST'
    );

    assert.equal(result.status, 400);

    assert.match(
        result.data.error,
        /dispatched/i
    );
});

// Test 2: Two dispatch requests cannot use the same available stock.
test('two competing dispatches cannot both succeed', async () => {
    const stockData = await api('/api/stock');

    const availableStock = stockData.data.stock.find(
        item => item.quantity > 0
    );

    assert.ok(
        availableStock,
        'The test database must have at least one non-empty stock record'
    );

    const destination = stockData.data.stores.find(
        store => store.id !== availableStock.store_id
    );

    const productId = availableStock.product_id;
    const sourceId = availableStock.store_id;
    const destinationId = destination.id;

    // Both transfers request all currently available stock.
    const firstTransfer = await createTestTransfer(
        productId,
        sourceId,
        destinationId,
        availableStock.quantity
    );

    const secondTransfer = await createTestTransfer(
        productId,
        sourceId,
        destinationId,
        availableStock.quantity
    );

    // Dispatch both transfers at almost the same time.
    const results = await Promise.all([
        api(`/api/transfers/${firstTransfer}/dispatch`, 'POST'),
        api(`/api/transfers/${secondTransfer}/dispatch`, 'POST')
    ]);

    const successfulRequests = results.filter(
        result => result.status === 200
    );

    const failedRequests = results.filter(
        result => result.status !== 200
    );

    assert.equal(
        successfulRequests.length,
        1,
        'Exactly one dispatch should succeed'
    );

    assert.equal(
        failedRequests.length,
        1,
        'The other dispatch must fail'
    );
});
