# EgMail

A static GitHub Pages inbox viewer for `www.egmail.me`. The page generates lowercase address prefixes or reopens an address on one of the configured domains, then reads its mailbox through the existing public inbox endpoint.

## Supported domains

- `otpgmail.me`
- `ogmail.tech`
- `egmail.me`

Generated prefixes contain lowercase letters only. Custom prefixes are normalized to lowercase and accept letters, numbers, dots, underscores, and hyphens.

## Inbox API

The frontend sends a read-only `GET` request to `https://egmail.me/{address}`. The current API response may contain `address`, `stats`, `received_emails`, and `sent_emails`; each received item has `from`, `subject`, `date`, and `content`. If no messages are available, the API returns a `message` such as “No emails found for this address.” The site does not send email, create provider-side accounts, or change mail-domain routing.

Email bodies are rendered with a safe allow-list. Scripts, forms, embedded media, remote images, and link destinations are removed to reduce tracking and active-content risks.

## Browser storage and privacy

This repository is a static site. Saved addresses and preferences are stored in that browser's local storage; message bodies are not saved by the page. The address list can be exported and imported manually, but there is no account system, server-side database, or automatic cross-browser synchronization.

The mailbox API is public and address-based. A person who knows an address may be able to retrieve its messages, including verification emails. Do not use these inboxes for sensitive accounts, account recovery, banking, or private correspondence. An address generated in the browser is a suggestion; provider-side availability and mail delivery depend on the existing mail service.

## Deploy

The repository uses the `www.egmail.me` custom domain through `CNAME`. GitHub Pages serves the root-level static files from the repository's configured branch. Push changes to the existing Pages source branch and wait for the Pages deployment to complete.
