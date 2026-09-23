// ============================================================
// L&K Sandwich — Supabase connection settings
// ============================================================
// Fill these in with YOUR project's values:
// Supabase Dashboard → Project Settings → API
//   - "Project URL"      → SUPABASE_URL
//   - "anon public" key  → SUPABASE_ANON_KEY
//
// The anon key is safe to expose in client-side code — it only
// grants the access allowed by your Row Level Security policies
// (see supabase/schema.sql), which restrict writes to logged-in
// admins only.
// ============================================================

export const SUPABASE_URL = "https://chaxkujdkybcgekryudr.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_RZ5tOa2uIWwmuUcBTYNkRA_OTWqYOfu";

export const STORAGE_BUCKET = "product-images";

// Public Web Push application-server key. The matching private key belongs
// only in Supabase Edge Function secrets and must never be added here.
export const VAPID_PUBLIC_KEY = "BGuDlwR0_MR7kEOS41yUGkABDQ4ZVtw3Mbgcqrk7quG4waCY5S6QRJK2ygV92dcrgpUNlCpRf_WUcxaSlBPMnPU";
