import { createHandler } from '../supabase/functions/edumanager/handler.ts';
// Standalone Deno smoke server only; does not emulate the Supabase gateway/database.
Deno.serve(
  { hostname: '127.0.0.1', port: 8000 },
  createHandler(['http://127.0.0.1:5173', 'http://localhost:5173']),
);
