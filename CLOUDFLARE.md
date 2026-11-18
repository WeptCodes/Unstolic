# Cloudflare Pages contact form

The contact form is handled by `functions/api/contact.js`. It allows up to 20
submissions per client IP in each 60-second window, then sends accepted
submissions to `sales@unstolic.com` using Cloudflare Email Service.

## Deploy

Connect the GitHub repository to a Cloudflare Pages project. Use the repository
root as the build output directory; no build command is required. Pages detects
the `functions/` directory automatically. The form endpoint is
`/api/contact`.

The root `_headers` file applies security headers to static site responses,
including a Content Security Policy that permits only the site's hashed inline
scripts and the consent-gated Microsoft Clarity loader. If you change inline
scripts in an HTML page, update their SHA-256 hashes in `_headers` or the
browser will block those scripts. These headers are applied by Cloudflare Pages;
they are not applied when serving the files directly from GitHub Pages.

## Configure rate limiting

1. Create a KV namespace in Cloudflare.
2. In the Pages project, open **Settings > Bindings > Add > KV namespace**.
3. Set the variable name to `RATE_LIMIT` and select the namespace.
4. Configure the binding in both production and preview environments if both
   are used, then redeploy.

The counter uses a hashed client IP and expires after 90 seconds. Cloudflare KV
is eventually consistent, so this is a practical burst limit rather than a
strictly atomic counter under simultaneous requests.

## Configure email delivery

1. Make sure the sending domain uses Cloudflare DNS, then onboard it in
   **Compute > Email Service > Email Sending**. Cloudflare configures the
   required sending and bounce DNS records.
2. Create a Cloudflare API token with **Email Sending: Edit** permission.
3. In the Pages project environment variables, add:
   - `CF_ACCOUNT_ID`: your Cloudflare account ID.
   - `CF_EMAIL_API_TOKEN`: the API token; store it as a secret.
   - `CONTACT_FROM`: a sender address on the onboarded domain, such as
     `website@yourdomain.com`.
4. Set these values for production and preview as needed, then redeploy.

The recipient is fixed to `sales@unstolic.com`; it is not taken from form input.
The submitted email address is used as `Reply-To`, so sales can reply directly
to the sender. Cloudflare requires a Workers Paid plan to send to arbitrary
recipients; the Free plan can send only to verified destination addresses in
the Cloudflare account. Never put the API token in the website source.
