const MAX_REQUESTS = 20;
const WINDOW_SECONDS = 60;
const MAX_BODY_BYTES = 12000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const RECIPIENT = 'sales@unstolic.com';

function jsonResponse(body, status, headers = {}) {
	return Response.json(body, {
		status,
		headers: { 'Cache-Control': 'no-store', ...headers }
	});
}

async function readBody(request) {
	const length = Number(request.headers.get('Content-Length'));
	if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
	if (!request.body) return '';

	const reader = request.body.getReader();
	const chunks = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function sanitize(value, collapseWhitespace = false) {
	const clean = value.normalize('NFC').replace(CONTROL_CHARACTERS, '').trim();
	return collapseWhitespace ? clean.replace(/\s+/g, ' ') : clean;
}

async function rateLimit(request, env) {
	const ipAddress = request.headers.get('CF-Connecting-IP');
	if (!ipAddress) {
		console.error('Contact rate limit failed: Cloudflare client IP header is missing.');
		return { response: jsonResponse({ error: 'Contact service is temporarily unavailable.' }, 503) };
	}
	if (!env.RATE_LIMIT) {
		console.error('Contact rate limit failed: RATE_LIMIT KV binding is not configured.');
		return { response: jsonResponse({ error: 'Contact service is not configured.' }, 503) };
	}

	const currentTime = Math.floor(Date.now() / 1000);
	const windowStart = Math.floor(currentTime / WINDOW_SECONDS);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ipAddress));
	const ipHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
	const key = `contact:${ipHash}:${windowStart}`;

	try {
		const storedCount = await env.RATE_LIMIT.get(key);
		const count = storedCount === null ? 0 : Number(storedCount);
		if (!Number.isSafeInteger(count) || count < 0) {
			console.error('Contact rate limit failed: invalid request counter in KV.');
			return { response: jsonResponse({ error: 'Contact service is temporarily unavailable.' }, 503) };
		}
		if (count >= MAX_REQUESTS) {
			const retryAfter = WINDOW_SECONDS - (currentTime % WINDOW_SECONDS);
			return {
				response: jsonResponse(
					{ error: 'Too many messages. Please try again in a minute.' },
					429,
					{ 'Retry-After': String(retryAfter) }
				)
			};
		}
		await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 90 });
		return { response: null };
	} catch (error) {
		console.error('Contact rate limit storage failed.', error);
		return { response: jsonResponse({ error: 'Contact service is temporarily unavailable.' }, 503) };
	}
}

export async function onRequest({ request, env }) {
	if (request.method !== 'POST') {
		return jsonResponse({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
	}

	const origin = request.headers.get('Origin');
	if (origin) {
		try {
			if (new URL(origin).origin !== new URL(request.url).origin) {
				return jsonResponse({ error: 'Forbidden.' }, 403);
			}
		} catch {
			return jsonResponse({ error: 'Forbidden.' }, 403);
		}
	}

	const contentType = request.headers.get('Content-Type') || '';
	if (!contentType.includes('application/json')) {
		return jsonResponse({ error: 'Unsupported content type.' }, 415);
	}

	const limited = await rateLimit(request, env);
	if (limited.response) return limited.response;

	let bodyText;
	try {
		bodyText = await readBody(request);
	} catch (error) {
		console.warn('Contact request body could not be decoded.', error);
		return jsonResponse({ error: 'Invalid request body.' }, 400);
	}
	if (bodyText === null) {
		return jsonResponse({ error: 'Message is too large.' }, 413);
	}

	let input;
	try {
		input = JSON.parse(bodyText);
	} catch (error) {
		console.warn('Contact request body is not valid JSON.', error);
		return jsonResponse({ error: 'Invalid request body.' }, 400);
	}
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return jsonResponse({ error: 'Invalid request body.' }, 400);
	}
	if (typeof input.honeypot === 'string' && input.honeypot.trim()) {
		return jsonResponse({ error: 'Invalid submission.' }, 400);
	}
	if (typeof input.name !== 'string' || typeof input.email !== 'string' || typeof input.message !== 'string') {
		return jsonResponse({ error: 'Please complete all fields.' }, 400);
	}

	const name = sanitize(input.name, true);
	const email = sanitize(input.email);
	const message = sanitize(input.message);
	if (!name || name.length > 100 || !EMAIL_PATTERN.test(email) || email.length > 254 || !message || message.length > 3000) {
		return jsonResponse({ error: 'Please check your name, email address, and message.' }, 400);
	}

	const accountId = env.CF_ACCOUNT_ID;
	const apiToken = env.CF_EMAIL_API_TOKEN;
	const sender = env.CONTACT_FROM;
	if (!accountId || !apiToken || !sender) {
		console.error('Contact email failed: Cloudflare Email Service variables are not configured.');
		return jsonResponse({ error: 'Contact service is not configured.' }, 503);
	}

	let emailResponse;
	try {
		emailResponse = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					to: RECIPIENT,
					from: sender,
					reply_to: email,
					subject: `Website contact from ${name}`,
					text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
				}),
				signal: AbortSignal.timeout(10000)
			}
		);
	} catch (error) {
		console.error('Cloudflare Email Service request failed.', error);
		return jsonResponse({ error: 'We could not send your message. Please try again later.' }, 502);
	}

	let emailResult;
	try {
		emailResult = await emailResponse.json();
	} catch (error) {
		console.error('Cloudflare Email Service returned an invalid response.', error);
		return jsonResponse({ error: 'We could not send your message. Please try again later.' }, 502);
	}
	if (!emailResponse.ok || emailResult.success !== true) {
		console.error('Cloudflare Email Service rejected the message.', {
			status: emailResponse.status,
			errors: emailResult.errors
		});
		return jsonResponse({ error: 'We could not send your message. Please try again later.' }, 502);
	}

	return jsonResponse({ success: true }, 200);
}
