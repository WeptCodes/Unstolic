# Cloudflare Pages contact form

The contact form is handled by `functions/api/contact.js`. It allows up to 20
submissions per client IP in each 60-second window, then sends accepted
submissions to `sales@unstolic.com` using Cloudflare Email Service.

## Deploy

Connect the GitHub repository to a Cloudflare Pages project. Use the repository
root as the build output directory; no build command is required. Pages detects
the `functions/` directory automatically. The form endpoint is
`/api/contact`.

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

1. Onboard and verify a sender domain with Cloudflare Email Service.
2. Create a Cloudflare API token with permission to send email.
3. In the Pages project environment variables, add:
   - `CF_ACCOUNT_ID`: your Cloudflare account ID.
   - `CF_EMAIL_API_TOKEN`: the API token; store it as a secret.
   - `CONTACT_FROM`: an allowed sender address on the verified domain.
4. Set these values for production and preview as needed, then redeploy.

The recipient is fixed to `sales@unstolic.com`; it is not taken from form input.
Never put the API token in the website source.
