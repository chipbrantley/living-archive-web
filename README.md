# Living Archive — web

The first live page of Living Archive, pulling data from the Airtable base.

Built with [Astro](https://astro.build) + the Netlify adapter.

## Run it locally

You need Node.js 20.x or newer. Check with `node -v`.

From this folder (`living-archive-web/`):

```bash
npm install
npm run dev
```

Astro will print a local URL — something like `http://localhost:4321`. Open it:

- `/` is the landing page. It pings Airtable and confirms the connection works.
- `/image/1675427` is a real image detail page (Selma March, Day 1 — leaders with leis).
- `/image/1673928`, `/image/1673325` are other live examples.

If the landing page shows a red "Couldn't reach Airtable" error, the token isn't set correctly.

## Environment variables

This project reads from `.env.local` (already in `.gitignore` so it never hits the repo).

```
AIRTABLE_PAT=patXXXXXXXXXXXXXX.YYYYYYYYYYYYYYYYYYY
AIRTABLE_BASE_ID=appjFGayzzd9dZ3gF
```

For the live Netlify deploy, set the same two variables in **Site settings → Environment variables**.

## Deploy to Netlify

After the local version works:

1. Create a GitHub repo (suggested name: `living-archive-web`) and push this folder.
2. In Netlify: **Add new site → Import an existing project → GitHub**, pick the repo.
3. Build command: `npm run build`. Publish directory: `dist`.
4. Add the two environment variables under **Site settings → Environment variables**.
5. Deploy. Netlify gives you a URL like `https://[site-name].netlify.app`.

The Netlify adapter handles the server-side rendering — each request fetches fresh data from Airtable.

## What this proves

That a request to a public URL can:

1. Be served by Netlify
2. Make an authenticated call to Airtable using a server-side token
3. Render the result with the Living Archive's design language

Everything after this is a matter of expanding what's on each page (caption, people, event,
Roll context, the actual image file) — the wiring is the same.

## Project structure

```
living-archive-web/
├── astro.config.mjs          Astro + Netlify adapter, server-side rendering
├── package.json
├── tsconfig.json
├── .gitignore                Ignores .env.local, node_modules, dist
├── .env.local                Local secrets (NOT committed)
└── src/
    ├── lib/
    │   └── airtable.ts       Thin REST client for Airtable
    ├── pages/
    │   ├── index.astro       Landing page
    │   └── image/
    │       └── [id].astro    Dynamic image detail page
    └── styles/
        └── global.css        Shared design tokens & components
```

## Field references

Right now the data layer reads these fields:

- **Images**: Image number, Photographer prefix, Prints
- **Prints**: PP #, Print size, Mounting, Authentication

When Take Stock metadata lands on the Images table (caption, dimensions, file source,
max-printable size), the page will surface those automatically — no changes to the data
layer needed beyond adding the new fields to the return type.
