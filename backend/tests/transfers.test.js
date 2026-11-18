import test from 'node:test';
import assert from 'node:assert/strict';

const API_URL = process.env.TEST_API_URL?.replace(/\/$/, '');
const testDatabaseReady =
    API_URL &&
    process.env.TEST_DATABASE_CONFIRMATION === 'separate-test-project';

async function api(path, method = 'GET', body) {
    const options = { method };

    if (body !== undefined) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_URL}${path}`, options);

    return {
        status: response.status,
        data: await response.json()
    };
}

async function getStock() {
    const result = await api('/api/stock');
    assert.equal(result.status, 200);
    return result.data;
}

async function createTransfer(productId, sourceStoreId, destinationStoreId, quantity) {
    const result = await api('/api/transfers', 'POST', {
        productId,
        sourceStoreId,
        destinationStoreId,
        quantity
    });

    return result;
}

async function getStockQuantity(productId, storeId) {
    const stockData = await getStock();
    const row = stockData.stock.find(item =>
        item.product_id === productId && item.store_id === storeId
    );

    assert.ok(row, 'Expected a stock row for the selected product and store');
    return row.quantity;
}

test('health endpoint responds', { skip: !testDatabaseReady }, async () => {
    const result = await api('/api/health');
    assert.equal(result.status, 200);
});

test('invalid transfer input is rejected', { skip: !testDatabaseReady }, async () => {
    const stockData = await getStock();
    const productId = stockData.products[0].id;
    const sourceStoreId = stockData.stores[0].id;
    const destinationStoreId = stockData.stores[1].id;

    for (const quantity of [0, -1, 1.5, '2']) {
        const result = await createTransfer(
            productId,
            sourceStoreId,
            destinationStoreId,
            quantity
        );
        assert.equal(result.status, 400);
    }

    const sameStoreResult = await createTransfer(
        productId,
        sourceStoreId,
        sourceStoreId,
        1
    );
    assert.equal(sameStoreResult.status, 400);

    const invalidIdResult = await api('/api/transfers/not-a-uuid/dispatch', 'POST');
    assert.equal(invalidIdResult.status, 400);
});

test('receiving a pending transfer leaves status and stock unchanged', {
    skip: !testDatabaseReady
}, async () => {
    const stockData = await getStock();
    const { id: productId } = stockData.products[0];
    const sourceStoreId = stockData.stores[0].id;
    const destinationStoreId = stockData.stores[1].id;
    const sourceBefore = await getStockQuantity(productId, sourceStoreId);
    const destinationBefore = await getStockQuantity(productId, destinationStoreId);

    const created = await createTransfer(
        productId,
        sourceStoreId,
        destinationStoreId,
        1
    );
    assert.equal(created.status, 201);

    const receiveResult = await api(
        `/api/transfers/${created.data.id}/receive`,
        'POST'
    );
    assert.equal(receiveResult.status, 400);

    const transfers = await api('/api/transfers');
    const transfer = transfers.data.find(item => item.id === created.data.id);
    assert.equal(transfer.status, 'Pending');
    assert.equal(await getStockQuantity(productId, sourceStoreId), sourceBefore);
    assert.equal(await getStockQuantity(productId, destinationStoreId), destinationBefore);
});

test('duplicate dispatch and receive do not change stock twice', {
    skip: !testDatabaseReady
}, async () => {
    const stockData = await getStock();
    const availableStock = stockData.stock.find(item => item.quantity >= 1);
    assert.ok(availableStock, 'The test database needs at least one unit of stock');

    const destinationStoreId = stockData.stores.find(
        store => store.id !== availableStock.store_id
    ).id;
    const sourceBefore = availableStock.quantity;
    const destinationBefore = await getStockQuantity(
        availableStock.product_id,
        destinationStoreId
    );

    const created = await createTransfer(
        availableStock.product_id,
        availableStock.store_id,
        destinationStoreId,
        1
    );
    assert.equal(created.status, 201);

    const dispatchPath = `/api/transfers/${created.data.id}/dispatch`;
    assert.equal((await api(dispatchPath, 'POST')).status, 200);
    assert.equal((await api(dispatchPath, 'POST')).status, 400);
    assert.equal(
        await getStockQuantity(availableStock.product_id, availableStock.store_id),
        sourceBefore - 1
    );

    const receivePath = `/api/transfers/${created.data.id}/receive`;
    assert.equal((await api(receivePath, 'POST')).status, 200);
    assert.equal((await api(receivePath, 'POST')).status, 400);
    assert.equal(
        await getStockQuantity(availableStock.product_id, destinationStoreId),
        destinationBefore + 1
    );
});

test('insufficient stock cannot be dispatched', { skip: !testDatabaseReady }, async () => {
    const stockData = await getStock();
    const emptyStock = stockData.stock.find(item => item.quantity === 0);
    assert.ok(emptyStock, 'The test database needs an empty stock row');

    const destinationStoreId = stockData.stores.find(
        store => store.id !== emptyStock.store_id
    ).id;
    const created = await createTransfer(
        emptyStock.product_id,
        emptyStock.store_id,
        destinationStoreId,
        1
    );
    assert.equal(created.status, 201);

    const dispatchResult = await api(
        `/api/transfers/${created.data.id}/dispatch`,
        'POST'
    );
    assert.equal(dispatchResult.status, 400);
    assert.equal(await getStockQuantity(emptyStock.product_id, emptyStock.store_id), 0);
});

test('competing dispatches cannot use the same available stock twice', {
    skip: !testDatabaseReady
}, async () => {
    const stockData = await getStock();
    const availableStock = [...stockData.stock].sort(
        (first, second) => second.quantity - first.quantity
    )[0];
    assert.ok(availableStock.quantity > 1, 'The test database needs stock for this test');

    const destinationStoreId = stockData.stores.find(
        store => store.id !== availableStock.store_id
    ).id;
    const quantity = availableStock.quantity;
    const transferIds = [];

    for (let index = 0; index < 2; index += 1) {
        const created = await createTransfer(
            availableStock.product_id,
            availableStock.store_id,
            destinationStoreId,
            quantity
        );
        assert.equal(created.status, 201);
        transferIds.push(created.data.id);
    }

    const results = await Promise.all(transferIds.map(id =>
        api(`/api/transfers/${id}/dispatch`, 'POST')
    ));

    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(results.filter(result => result.status === 400).length, 1);
    assert.equal(
        await getStockQuantity(availableStock.product_id, availableStock.store_id),
        0
    );

    const transfers = await api('/api/transfers');
    const competingTransfers = transfers.data.filter(item =>
        transferIds.includes(item.id)
    );
    assert.equal(competingTransfers.filter(item => item.status === 'In Transit').length, 1);
    assert.equal(competingTransfers.filter(item => item.status === 'Pending').length, 1);
});