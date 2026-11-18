# Stock Transfer Tool

This application tracks stock at Store A and Store B. A transfer starts as Pending. Dispatching it removes the quantity from the source store and changes the status to In Transit. Receiving it adds the quantity to the destination store and marks it Received.

The frontend uses React and Vite. The backend is a Node.js HTTP server that calls PostgreSQL functions in Supabase. The planned hosts are GitHub Pages for the frontend and Render for the backend.

## Starting stock

| Product | Store A | Store B |
| --- | ---: | ---: |
| Notebook | 12 | 3 |
| Pen | 20 | 8 |
| Bottle | 5 | 0 |

The seed script inserts these values only when a stock row is missing. Running it again does not restore stock that has changed during transfers.

## Project files

```text
.github/workflows/deploy.yml  GitHub Pages build and deployment
backend/server.js             HTTP routes and request validation
backend/supabase.js            Supabase client setup
backend/tests/transfers.test.js  Integration tests
database/schema.sql            Tables, constraints, permissions, and functions
database/seed.sql              Products, stores, and starting stock
frontend/src/                  React application and styles
```

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor in the Supabase dashboard.
3. Run `database/schema.sql`, followed by `database/seed.sql`.
4. Copy the project URL and service role key from the project settings. Keep the service role key on the backend. Never put it in a frontend variable or commit it.

Row Level Security is enabled for all four tables. The `service_role` can read the tables and call the three database functions. The public and authenticated roles cannot read or modify these tables through the API. The functions run as their owner and make each transfer change in one PostgreSQL transaction.

## Run locally

Use Node.js 22 or newer.

In PowerShell, create the backend environment file and enter the values for your Supabase project:

```powershell
Copy-Item backend/.env.example backend/.env
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL=http://localhost:5173`, and `PORT=5000` in `backend/.env`. The URL can be the project URL or its `/rest/v1` endpoint. Do not commit this file.

Install and start the backend:

```powershell
cd backend
npm install
npm start
```

In a second terminal, set up and start the frontend:

```powershell
Copy-Item frontend/.env.example frontend/.env.local
cd frontend
npm install
npm run dev
```

The local frontend uses `VITE_API_URL=http://localhost:5000`. Open the URL printed by Vite, usually `http://localhost:5173`.

## API routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Check whether the Node.js server is running |
| GET | `/api/stock` | Read products, stores, and stock quantities |
| GET | `/api/transfers` | Read transfer history |
| POST | `/api/transfers` | Create a Pending transfer |
| POST | `/api/transfers/:id/dispatch` | Dispatch a Pending transfer |
| POST | `/api/transfers/:id/receive` | Receive an In Transit transfer |

The backend validates request values. PostgreSQL also checks quantities, store IDs, transfer status, timestamps, and stock constraints. The frontend reloads stock and transfer history after a successful operation and polls every five seconds. The health route checks the server only; it does not check the database connection.

## Stock updates

Creating a transfer adds a Pending record and leaves stock unchanged. `dispatch_transfer` locks the transfer row and source stock row. It checks the status and available quantity, then subtracts stock and records the dispatch time. `receive_transfer` locks the transfer and destination stock rows, then adds stock and records the receiving time.

Each function call runs in one database transaction. If a check fails, PostgreSQL rolls back the changes. The stock row lock makes concurrent dispatches wait for each other, so two requests cannot both spend the same units.

## Tests

The backend uses Node.js's built-in test runner. The integration tests cover invalid input, receiving before dispatch, repeated dispatch and receive, insufficient stock, and concurrent dispatches. They change database records, so use a separate Supabase test project. Tests are skipped unless both variables below are set. The confirmation value is an acknowledgement; it does not verify which Supabase project the server uses.

Start the backend with the test project's credentials, then run this in another terminal from `backend`:

```powershell
$env:TEST_API_URL = 'http://localhost:5000'
$env:TEST_DATABASE_CONFIRMATION = 'separate-test-project'
npm test
```

The concurrency test uses all stock in one source row. To reset the test project, run this SQL only in that test project:

```sql
begin;
truncate table public.transfers;
update public.store_stock as stock
set quantity = case
    when products.name = 'Notebook' and stores.name = 'Store A' then 12
    when products.name = 'Notebook' and stores.name = 'Store B' then 3
    when products.name = 'Pen' and stores.name = 'Store A' then 20
    when products.name = 'Pen' and stores.name = 'Store B' then 8
    when products.name = 'Bottle' and stores.name = 'Store A' then 5
    else 0
end
from public.products, public.stores
where stock.product_id = products.id
    and stock.store_id = stores.id;
commit;
```

## Deployment

The Vite base path is `/estore/`, and the frontend project URL is `https://kirath25.github.io/estore/`. In the repository's Settings, configure GitHub Pages to use GitHub Actions. Add an Actions variable named `VITE_API_URL` with the deployed Render service's base URL, without a trailing slash. The workflow fails when the variable is missing.

The backend is deployed on Render at `https://estore-fxq0.onrender.com`. Its health, stock, and transfer routes have returned successful responses. The free instance can take longer to answer after it has been idle.

The Render Web Service settings are:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `npm start` |
| Plan | Free |

Render has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `FRONTEND_URL=https://kirath25.github.io` configured. The browser origin does not include `/estore/`. Set the repository Actions variable `VITE_API_URL` to `https://estore-fxq0.onrender.com` without a trailing slash. This variable belongs in GitHub repository settings, not Render. The Pages site is not live yet, so the full deployed frontend-to-backend flow has not been checked.

## Limitations and possible next steps

The application has no user authentication or transfer permissions by user. The backend uses one Supabase service role key, stored as a Render secret. Database setup currently requires running the SQL files manually. A later update could add a migration process, authentication, and more automated tests around the HTTP routes.

AI tools were used for planning, code drafting, troubleshooting, and code review.