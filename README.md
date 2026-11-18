# Stock Transfer Tool

A small app for tracking stock between Store A and Store B.

It can:
- Show current stock for notebooks, pens, and bottles.
- Create and track transfers between stores.
- Deduct stock when a transfer is dispatched.
- Add stock when a transfer is received.
- Refresh stock and transfer history every five seconds.

## Run locally

Start the backend in one terminal:

```powershell
cd backend
npm install
npm start
```

Start the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The backend uses the Supabase settings in `backend/.env`.
