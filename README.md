# EgMail

EgMail is a static GitHub Pages inbox viewer for `www.egmail.me`. The Pages frontend is published from the repository root on `main`; the existing `CNAME` remains `www.egmail.me`. The interface generates lowercase address prefixes or reopens an address on one of the configured domains.

## Supported domains and inbox service

Supported domains are `otpgmail.me`, `ogmail.tech`, and `egmail.me`. Generated prefixes contain lowercase letters only. Custom prefixes are normalized to lowercase and accept letters, numbers, dots, underscores, and hyphens.

The frontend sends a read-only `GET` request to `https://egmail.me/{address}`. A response may contain `address`, `stats`, `received_emails`, and `sent_emails`; each received item has `from`, `subject`, `date`, and `content`. The site does not send email, create provider-side accounts, or change mail-domain routing. Real inbox retrieval is not currently verified: a read-only request from the cloud test environment returned HTTP 403, and no response body or mailbox content was read.

Email bodies are rendered with a safe allow-list. Scripts, forms, embedded media, remote images, and link destinations are removed to reduce tracking and active-content risks. OTP view displays only a single confidently detected relevant code and context; ambiguous or unrelated codes are omitted.

## Accounts and privacy

GitHub Pages is static and cannot run Express or MySQL. Account sign-up/sign-in, saved inbox synchronization, and synchronized settings use the separate public account backend at `https://egmailauth-27vxmcwy.manus.space`. The account API origin is configured in the frontend's `<meta name="egmail-api-origin">` and can be changed without editing the account client.

The backend accepts credentialed CORS only from `https://www.egmail.me`, `https://egmail.me`, and `https://b-panther.github.io`. Account requests include cookies and CSRF headers. Production cookies use `Secure; SameSite=None; Partitioned` for cross-site API requests. Partitioned-cookie support and privacy settings vary by browser; if a browser blocks those cookies, account sessions may not persist from Pages. A same-site account API hostname would require supported custom-domain binding and an explicitly approved DNS change.

The mailbox API is public and address-based. Anyone who knows an address may be able to request its messages, including verification emails. Linking an address to an account synchronizes the address and preferences only; it does **not** make the inbox private or restrict API access. Do not use these inboxes for banking, account recovery, sensitive accounts, or private correspondence. Message bodies are not stored by the account backend.

## Direct inbox URLs

GitHub Pages uses the root `404.html` app shell so a direct UI URL such as `https://www.egmail.me/name@egmail.me` can load the address in the browser. The apex URL `https://egmail.me/<address>` is the existing public inbox API and is intentionally not replaced. No DNS records are changed by this repository.

## Browser storage and backups

When signed out, saved addresses and preferences are stored in that browser's local storage. Signed-in addresses and supported preferences sync through the separate backend. The address list can be exported and imported manually. Neither local storage nor account sync changes mailbox privacy.

## Deploy

GitHub Pages serves the repository root from `main`. Keep the `CNAME` file set to `www.egmail.me`; do not change DNS as part of a static frontend update. The static files include `index.html`, `404.html`, `styles.css`, `app.js`, `account.js`, `otp.js`, `favicon.svg`, and `og-image.svg`.
