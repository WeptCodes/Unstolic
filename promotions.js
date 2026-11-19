(function() {
	const promotionList = document.querySelector('[data-promotion-list]');
	if (!promotionList || window.location.protocol === 'file:') return;

	const emptyState = promotionList.querySelector('[data-promotion-empty]');

	function isValidDate(value) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		const timestamp = Date.parse(`${value}T00:00:00.000Z`);
		return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
	}

	function getTodayInLusaka() {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Africa/Lusaka',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(new Date());
		const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
		return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
	}

	function addTextElement(parent, tagName, className, text) {
		const element = document.createElement(tagName);
		if (className) element.className = className;
		element.textContent = text;
		parent.append(element);
		return element;
	}

	function createPromotionCard(promotion, index) {
		if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion)) {
			throw new TypeError(`Promotion ${index + 1} must be an object.`);
		}
		if (typeof promotion.title !== 'string' || !promotion.title.trim() || promotion.title.length > 100) {
			throw new TypeError(`Promotion ${index + 1} has an invalid title.`);
		}
		if (typeof promotion.description !== 'string' || !promotion.description.trim() || promotion.description.length > 600) {
			throw new TypeError(`Promotion ${index + 1} has an invalid description.`);
		}

		const validUntil = promotion.validUntil ?? '';
		const branches = promotion.branches ?? '';
		const terms = promotion.terms ?? '';
		if (validUntil !== '' && (typeof validUntil !== 'string' || !isValidDate(validUntil))) {
			throw new TypeError(`Promotion ${index + 1} has an invalid validUntil date.`);
		}
		if (typeof branches !== 'string' || branches.length > 200) {
			throw new TypeError(`Promotion ${index + 1} has invalid branches.`);
		}
		if (typeof terms !== 'string' || terms.length > 400) {
			throw new TypeError(`Promotion ${index + 1} has invalid terms.`);
		}

		if (validUntil && validUntil < getTodayInLusaka()) return null;

		const card = document.createElement('article');
		card.className = 'promotion-card';
		addTextElement(card, 'span', 'promotion-badge', 'Current deal');
		addTextElement(card, 'h3', '', promotion.title.trim());
		addTextElement(card, 'p', '', promotion.description.trim());

		const details = document.createElement('div');
		details.className = 'promotion-details';
		if (branches.trim()) addTextElement(details, 'p', '', `Available at: ${branches.trim()}`);
		if (validUntil) {
			const date = new Intl.DateTimeFormat('en-ZM', {
				dateStyle: 'long',
				timeZone: 'UTC'
			}).format(new Date(`${validUntil}T12:00:00.000Z`));
			addTextElement(details, 'p', '', `Valid until: ${date}`);
		}
		if (terms.trim()) addTextElement(details, 'p', '', terms.trim());
		if (details.childElementCount) card.append(details);

		const link = addTextElement(card, 'a', 'button blue', 'Enquire about this deal');
		link.href = '#contact';
		return card;
	}

	async function loadPromotions() {
		const response = await fetch('./promotions.json', {
			headers: { Accept: 'application/json' },
			cache: 'no-store'
		});
		if (!response.ok) throw new Error(`Promotions request failed with status ${response.status}.`);

		const promotions = await response.json();
		if (!Array.isArray(promotions)) throw new TypeError('Promotions data must be a JSON array.');

		const cards = promotions.map(createPromotionCard).filter(Boolean);
		if (cards.length) promotionList.replaceChildren(...cards);
	}

	loadPromotions().catch(error => {
		console.error('Current promotions could not be loaded.', error);
		if (emptyState) {
			emptyState.textContent = 'Current deals could not be loaded. Please contact our team for the latest offers.';
		}
	});
})();
