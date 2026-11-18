
const API_URL =
    import.meta.env.VITE_API_URL || 'http://localhost:5000';

async function request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
    }

    return data;
}

export function getStock() {
    return request('/api/stock');
}

export function getTransfers() {
    return request('/api/transfers');
}

export function createTransfer(transfer) {
    return request('/api/transfers', {
        method: 'POST',
        body: JSON.stringify(transfer)
    });
}

export function dispatchTransfer(id) {
    return request(`/api/transfers/${id}/dispatch`, {
        method: 'POST'
    });
}

export function receiveTransfer(id) {
    return request(`/api/transfers/${id}/receive`, {
        method: 'POST'
    });
}
