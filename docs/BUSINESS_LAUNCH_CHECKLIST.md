# AlgoVerse business launch checklist

Steps to finish **before accepting real payments**. Legend:
**[You]** needs your account or decision · **[CA]** chartered accountant · **[Lawyer]**
legal professional · **[Code]** implemented in this repository.

Nothing here is legal, tax or financial advice. See `docs/SAAS_ARCHITECTURE.md` for sources.

## 1. Business identity
- [ ] [You] Decide how you sell: as an individual/unregistered seller, a sole proprietorship, or a company/LLP
- [ ] [CA] Confirm the registration needed for that choice
- [ ] [You] Business name, support email, and contact address shown on the site (fill the placeholders in the policy pages)
- [ ] [You] Decide on a custom domain (recommended for trust and payment-provider review)

## 2. Payment provider (Razorpay recommended, pending approval)
- [ ] [You] Create the account yourself on razorpay.com. Never share keys in chat.
- [ ] [You] KYC: PAN, Aadhaar (for individuals), and a bank account in the seller's name. Razorpay says verification typically takes 1-3 business days.
- [ ] [You] Ask Razorpay to enable **Subscriptions** (and UPI AutoPay / eMandate). Get a quote for subscription pricing on UPI and eMandate ("on request" on their pricing page).
- [ ] [You] Make sure the website has live Privacy, Terms, Refund/Cancellation, Contact and Pricing pages before submitting it for review. [Code] provides the pages.
- [ ] [You] Create **test-mode** plans (monthly/annual), then add the env vars in Vercel (Preview only)
- [ ] [You] Configure the webhook URL and secret in the Razorpay dashboard (test mode first)
- [ ] [You] Understand settlement timing and the fees on your settlement reports

## 3. Tax and accounting
- [ ] [CA] GST applicability (registration thresholds, whether online education services / OIDAR rules apply, place of supply)
- [ ] [CA] Whether and how to issue invoices for each subscription charge. [Code] can generate them once the format is decided.
- [ ] [CA] Retention period for payment and invoice records (affects account deletion)
- [ ] [CA] Income tax treatment and bookkeeping; Razorpay fee + GST input credit

## 4. Legal and privacy
- [ ] [Lawyer] Review the Privacy Policy, Terms of Service, and Refund & Cancellation Policy
- [ ] [Lawyer] DPDP Act / Rules 2025 readiness (most obligations apply from 14 May 2027): notice, consent, grievance redressal, breach process
- [ ] [Lawyer] **Minors policy**: 18+ only, or verifiable parental consent
- [ ] [Lawyer] Consumer-protection / e-commerce rules (grievance officer, pricing and renewal disclosures)
- [ ] [Lawyer] Using third-party educational links and embedded YouTube videos commercially
- [ ] [You] Name a grievance / privacy contact and a monitored mailbox

## 5. Infrastructure
- [ ] [You] **Upgrade Vercel to Pro** before any checkout or pricing is publicly live (Hobby is non-commercial only)
- [ ] [You] Supabase: separate **dev** and **production** projects, production on Pro (backups, no pausing), Mumbai region
- [ ] [You] SMTP provider for auth emails, with a verified sending domain (SPF/DKIM)
- [ ] [You] Gemini: a production key on a billing-enabled Google Cloud project, **plus a budget alert**
- [ ] [You] Separate env vars for Development / Preview / Production in Vercel
- [ ] [You] Two-factor authentication on GitHub, Vercel, Supabase, Razorpay, Google Cloud and your email

## 6. Testing before going live
- [ ] [Code] `npm test`, typecheck, lint, build, RLS isolation tests, entitlement tests, webhook tests all pass
- [ ] [You] Full test-mode purchase on a Vercel preview: monthly, annual, failed payment, cancel, renewal (use Razorpay test cards and UPI)
- [ ] [You] Sync test on two real devices (phone + laptop), including offline edits
- [ ] [You] Test account export and deletion end to end
- [ ] [You] Optional: independent security review / penetration test

## 7. Operations
- [ ] [You] Support process: reply time, refund-request handling, a place to log requests
- [ ] [You] Refund operations: who approves, how to issue from the Razorpay dashboard, and how access is removed ([Code] handles access through webhooks)
- [ ] [You] Monitoring: Vercel logs/alerts, Supabase usage alerts, Gemini spend alerts, Razorpay webhook failure emails
- [ ] [You] Backups: confirm Supabase daily backups exist; do a restore drill into the dev project once
- [ ] [You] Incident response: who to contact, how to rotate keys (Gemini, Supabase service role, Razorpay), user and Board notification steps for a data breach (with your lawyer)

## 8. Go-live (only after explicit approval)
- [ ] [You] Switch Razorpay to live mode and add live keys to **Production** env only
- [ ] [You] Create live plans with the final prices and update the plan env vars
- [ ] [Code] Remove any "test mode" banners; final regression run on production
- [ ] [You] Do one real low-value purchase and refund to confirm the full cycle
