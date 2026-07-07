import type { APIRoute } from 'astro';
import { clearCookieHeader } from '../../../lib/ads/auth';

export const prerender = false;

// GET so a plain link works; POST too for form buttons.
const signOut = () =>
  new Response(null, {
    status: 302,
    headers: { Location: '/ads/login', 'Set-Cookie': clearCookieHeader() },
  });

export const GET: APIRoute = signOut;
export const POST: APIRoute = signOut;
