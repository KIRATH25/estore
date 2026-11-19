# Stock Transfer Tool

## Run locally

Add your Supabase URL and service role key to `backend/.env`. Keep this file private.

Start the backend in one terminal:

```powershell
cd backend
npm install
npm start
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

For a new database, run `database/schema.sql` and `database/seed.sql` in the Supabase SQL Editor.

## Push to GitHub

From the project folder, run:

```powershell
git add -A
git commit -m "Update stock transfer app"
git push origin main
```

The `.gitignore` excludes local environment files and generated files.
