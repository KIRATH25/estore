
import { useEffect, useRef, useState } from 'react';

import {
    getStock,
    getTransfers,
    createTransfer,
    dispatchTransfer,
    receiveTransfer
} from './api';

function App() {
    const [stockData, setStockData] = useState({
        products: [],
        stores: [],
        stock: []
    });

    const [transfers, setTransfers] = useState([]);

    const [form, setForm] = useState({
        productId: '',
        sourceStoreId: '',
        destinationStoreId: '',
        quantity: '1'
    });

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [actionId, setActionId] = useState('');

    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const dataRequestRef = useRef(null);

    function loadData() {
        if (dataRequestRef.current) {
            return dataRequestRef.current;
        }

        const request = Promise.all([getStock(), getTransfers()])
            .then(([stockResult, transferResult]) => {
                setStockData(stockResult);
                setTransfers(transferResult);

                setForm(current => ({
                    ...current,
                    productId:
                        current.productId ||
                        stockResult.products[0]?.id ||
                        '',
                    sourceStoreId:
                        current.sourceStoreId ||
                        stockResult.stores[0]?.id ||
                        '',
                    destinationStoreId:
                        current.destinationStoreId ||
                        stockResult.stores[1]?.id ||
                        ''
                }));
            });

        const trackedRequest = request.finally(() => {
            if (dataRequestRef.current === trackedRequest) {
                dataRequestRef.current = null;
            }
        });

        dataRequestRef.current = trackedRequest;
        return trackedRequest;
    }

    async function reloadAfterOperation() {
        const currentRequest = dataRequestRef.current;

        if (currentRequest) {
            await currentRequest.catch(() => {});
        }

        await loadData();
    }

    useEffect(() => {
        loadData()
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));

        const intervalId = setInterval(() => {
            if (!dataRequestRef.current) {
                loadData().catch(err => setError(err.message));
            }
        }, 5000);

        return () => clearInterval(intervalId);
    }, []);

    function getQuantity(productId, storeId) {
        const item = stockData.stock.find(
            row =>
                row.product_id === productId &&
                row.store_id === storeId
        );

        return item ? item.quantity : 0;
    }

    function updateForm(event) {
        const { name, value } = event.target;

        setForm(current => ({
            ...current,
            [name]: value
        }));
    }

    async function handleRefresh() {
        setRefreshing(true);
        setError('');
        setMessage('');

        try {
            await reloadAfterOperation();
        } catch (err) {
            setError(err.message);
        } finally {
            setRefreshing(false);
        }
    }

    async function handleCreate(event) {
        event.preventDefault();

        setError('');
        setMessage('');

        const quantity = Number(form.quantity);

        if (
            !Number.isSafeInteger(quantity) ||
            quantity <= 0
        ) {
            setError('Enter a positive whole number');
            return;
        }

        if (form.sourceStoreId === form.destinationStoreId) {
            setError('Select two different stores');
            return;
        }

        setSaving(true);

        try {
            await createTransfer({
                productId: form.productId,
                sourceStoreId: form.sourceStoreId,
                destinationStoreId: form.destinationStoreId,
                quantity
            });

            setMessage('Transfer created successfully');

            setForm(current => ({
                ...current,
                quantity: '1'
            }));

            await reloadAfterOperation();

        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleAction(id, action) {
        setActionId(id);
        setError('');
        setMessage('');

        try {
            if (action === 'dispatch') {
                await dispatchTransfer(id);
                setMessage('Transfer dispatched successfully');
            } else {
                await receiveTransfer(id);
                setMessage('Transfer received successfully');
            }

            await reloadAfterOperation();

        } catch (err) {
            setError(err.message);

            // Reload in case another request changed the stock.
            try {
                await reloadAfterOperation();
            } catch (refreshError) {
                setError(refreshError.message);
            }
        } finally {
            setActionId('');
        }
    }

    function formatDate(date) {
        if (!date) {
            return '-';
        }

        return new Date(date).toLocaleString();
    }

    if (loading) {
        return (
            <main className="container">
                <p>Loading stock data...</p>
            </main>
        );
    }

    const storeA = stockData.stores[0];
    const storeB = stockData.stores[1];

    return (
        <main className="container">

            <header className="header">
                <div>
                    <h1>Stock Transfer Tool</h1>
                    <p>Manage stock between two stores</p>
                </div>

                <button
                    type="button"
                    className="secondary-button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                >
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </header>

            {error && (
                <div className="message error">
                    {error}
                </div>
            )}

            {message && (
                <div className="message success">
                    {message}
                </div>
            )}

            <section className="section">

                <h2>Available stock</h2>

                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>{storeA?.name || 'Store A'}</th>
                                <th>{storeB?.name || 'Store B'}</th>
                            </tr>
                        </thead>

                        <tbody>
                            {stockData.products.map(product => (
                                <tr key={product.id}>
                                    <td>{product.name}</td>

                                    <td>
                                        {storeA
                                            ? getQuantity(product.id, storeA.id)
                                            : 0}
                                    </td>

                                    <td>
                                        {storeB
                                            ? getQuantity(product.id, storeB.id)
                                            : 0}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

            </section>

            <section className="section">

                <h2>Create a transfer</h2>

                <form onSubmit={handleCreate}>

                    <div className="form-grid">

                        <div className="form-group">
                            <label htmlFor="product">Product</label>

                            <select
                                id="product"
                                name="productId"
                                value={form.productId}
                                onChange={updateForm}
                                required
                            >
                                <option value="">Select product</option>

                                {stockData.products.map(product => (
                                    <option
                                        key={product.id}
                                        value={product.id}
                                    >
                                        {product.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="source">Source store</label>

                            <select
                                id="source"
                                name="sourceStoreId"
                                value={form.sourceStoreId}
                                onChange={updateForm}
                                required
                            >
                                <option value="">Select source</option>

                                {stockData.stores.map(store => (
                                    <option
                                        key={store.id}
                                        value={store.id}
                                    >
                                        {store.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="destination">
                                Destination store
                            </label>

                            <select
                                id="destination"
                                name="destinationStoreId"
                                value={form.destinationStoreId}
                                onChange={updateForm}
                                required
                            >
                                <option value="">Select destination</option>

                                {stockData.stores.map(store => (
                                    <option
                                        key={store.id}
                                        value={store.id}
                                    >
                                        {store.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="quantity">Quantity</label>

                            <input
                                id="quantity"
                                type="number"
                                name="quantity"
                                min="1"
                                step="1"
                                value={form.quantity}
                                onChange={updateForm}
                                required
                            />
                        </div>

                    </div>

                    <p className="help-text">
                        Available at source:{' '}
                        {form.productId && form.sourceStoreId
                            ? getQuantity(
                                form.productId,
                                form.sourceStoreId
                            )
                            : 0}
                    </p>

                    <button
                        type="submit"
                        className="primary-button"
                        disabled={saving}
                    >
                        {saving ? 'Creating...' : 'Create transfer'}
                    </button>

                </form>

            </section>

            <section className="section">

                <h2>Transfer history</h2>

                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Quantity</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th>Action</th>
                            </tr>
                        </thead>

                        <tbody>
                            {transfers.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="empty">
                                        No transfers created yet.
                                    </td>
                                </tr>
                            ) : (
                                transfers.map(transfer => (
                                    <tr key={transfer.id}>
                                        <td>{transfer.product_name}</td>

                                        <td>{transfer.source_name}</td>

                                        <td>{transfer.destination_name}</td>

                                        <td>{transfer.quantity}</td>

                                        <td>
                                            <span
                                                className={
                                                    'status ' +
                                                    transfer.status
                                                        .toLowerCase()
                                                        .replace(' ', '-')
                                                }
                                            >
                                                {transfer.status}
                                            </span>
                                        </td>

                                        <td>
                                            {formatDate(transfer.created_at)}
                                        </td>

                                        <td>
                                            {transfer.status === 'Pending' && (
                                                <button
                                                    type="button"
                                                    className="primary-button small"
                                                    disabled={actionId !== ''}
                                                    onClick={() =>
                                                        handleAction(
                                                            transfer.id,
                                                            'dispatch'
                                                        )
                                                    }
                                                >
                                                    {actionId === transfer.id
                                                        ? 'Please wait...'
                                                        : 'Dispatch'}
                                                </button>
                                            )}

                                            {transfer.status === 'In Transit' && (
                                                <button
                                                    type="button"
                                                    className="primary-button small"
                                                    disabled={actionId !== ''}
                                                    onClick={() =>
                                                        handleAction(
                                                            transfer.id,
                                                            'receive'
                                                        )
                                                    }
                                                >
                                                    {actionId === transfer.id
                                                        ? 'Please wait...'
                                                        : 'Receive'}
                                                </button>
                                            )}

                                            {transfer.status === 'Received' && (
                                                <span>Completed</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

            </section>

            <footer>
                Stock Transfer Tool
            </footer>

        </main>
    );
}

export default App;
