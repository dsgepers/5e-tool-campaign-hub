import {normalizeExternalIdentity} from "./external-identity.js";

export const AUTH_PROVIDER_REGISTRY_CAPABILITY = "auth.provider_registry.v1";

const STATUS_AVAILABLE = "available";
const PUBLIC_STATUSES = new Set([STATUS_AVAILABLE, "disabled", "configuration_error"]);

function getExpectedPath ({slug, suffix}) {
	return `/auth/${slug}/${suffix}`;
}

function normalizeCapabilities (capabilities) {
	if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
		throw new TypeError(`Authentication provider capabilities are required.`);
	}
	if (![false, "S256"].includes(capabilities.pkce)) {
		throw new TypeError(`Authentication provider PKCE capability must be false or S256.`);
	}
	if (typeof capabilities.oidcNonce !== "boolean") {
		throw new TypeError(`Authentication provider OIDC nonce capability must be boolean.`);
	}
	return Object.freeze({
		pkce: capabilities.pkce,
		oidcNonce: capabilities.oidcNonce,
	});
}

function normalizeAvailableProvider (provider) {
	if (!provider || typeof provider !== "object") throw new TypeError(`Authentication provider is required.`);
	const {slug, label, startPath, callbackPath} = provider;
	if (typeof slug !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(slug)) {
		throw new TypeError(`Authentication provider slug is invalid.`);
	}
	if (typeof label !== "string" || !label.trim() || Array.from(label.trim()).length > 50) {
		throw new TypeError(`Authentication provider label is invalid.`);
	}
	if (startPath !== getExpectedPath({slug, suffix: "start"})) {
		throw new TypeError(`Authentication provider start path must match its slug.`);
	}
	if (callbackPath !== getExpectedPath({slug, suffix: "callback"})) {
		throw new TypeError(`Authentication provider callback path must match its slug.`);
	}
	if (provider.authenticationType === "password") {
		if (slug !== "local" || typeof provider.pVerifyCredentials !== "function"
			|| typeof provider.getAuthorizationUrl !== "function" || typeof provider.getIdentities !== "function" || typeof provider.hasIdentity !== "function") {
			throw new TypeError("Local authentication provider is invalid.");
		}
		return Object.freeze({
			slug,
			label: label.trim(),
			startPath,
			callbackPath,
			authenticationType: "password",
			capabilities: normalizeCapabilities(provider.capabilities),
			getAuthorizationUrl: context => provider.getAuthorizationUrl(context),
			pVerifyCredentials: credentials => provider.pVerifyCredentials(credentials),
			getIdentities: () => provider.getIdentities(),
			hasIdentity: subject => provider.hasIdentity(subject),
		});
	}
	if (typeof provider.getAuthorizationUrl !== "function" || typeof provider.pExchangeCodeForIdentity !== "function") {
		throw new TypeError(`Authentication provider must implement authorization and code exchange.`);
	}
	const capabilities = normalizeCapabilities(provider.capabilities);
	return Object.freeze({
		slug,
		label: label.trim(),
		startPath,
		callbackPath,
		capabilities,
		getAuthorizationUrl: context => provider.getAuthorizationUrl(context),
		pExchangeCodeForIdentity: async context => {
			const identity = normalizeExternalIdentity(await provider.pExchangeCodeForIdentity(context));
			if (identity.provider !== slug) throw new TypeError(`Authentication provider returned a mismatched identity.`);
			return identity;
		},
	});
}

function normalizeRegistration (registration) {
	if (registration?.status === STATUS_AVAILABLE) {
		const provider = normalizeAvailableProvider(registration.provider);
		return Object.freeze({
			slug: provider.slug,
			label: provider.label,
			startPath: provider.startPath,
			callbackPath: provider.callbackPath,
			status: STATUS_AVAILABLE,
			provider,
		});
	}
	const {slug, label, startPath, callbackPath, status} = registration || {};
	if (!PUBLIC_STATUSES.has(status) || status === STATUS_AVAILABLE) {
		throw new TypeError(`Unavailable authentication provider status is invalid.`);
	}
	if (typeof slug !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(slug)) {
		throw new TypeError(`Unavailable authentication provider slug is invalid.`);
	}
	if (startPath !== getExpectedPath({slug, suffix: "start"}) || callbackPath !== getExpectedPath({slug, suffix: "callback"})) {
		throw new TypeError(`Unavailable authentication provider paths must match its slug.`);
	}
	if (typeof label !== "string" || !label.trim() || Array.from(label.trim()).length > 50) {
		throw new TypeError(`Unavailable authentication provider label is invalid.`);
	}
	return Object.freeze({slug, label: label.trim(), startPath, callbackPath, status, provider: null});
}

export function createAuthProviderRegistration ({
	slug,
	label,
	status = STATUS_AVAILABLE,
	fnCreate,
	onConfigurationError = null,
}) {
	const startPath = getExpectedPath({slug, suffix: "start"});
	const callbackPath = getExpectedPath({slug, suffix: "callback"});
	if (status !== STATUS_AVAILABLE) return {slug, label, startPath, callbackPath, status};
	try {
		return {status, provider: fnCreate()};
	} catch (error) {
		onConfigurationError?.({slug, code: error?.code || error?.name || "CONFIGURATION_ERROR"});
		return {slug, label, startPath, callbackPath, status: "configuration_error"};
	}
}

export class AuthProviderRegistry {
	constructor ({registrations}) {
		if (!Array.isArray(registrations) || !registrations.length) {
			throw new TypeError(`At least one authentication provider registration is required.`);
		}
		this._registrations = registrations.map(normalizeRegistration);
		const slugs = new Set();
		const paths = new Set();
		for (const registration of this._registrations) {
			if (slugs.has(registration.slug)) throw new TypeError(`Duplicate authentication provider slug.`);
			slugs.add(registration.slug);
			for (const path of [registration.startPath, registration.callbackPath]) {
				if (paths.has(path)) throw new TypeError(`Duplicate authentication provider route.`);
				paths.add(path);
			}
		}
		if (!this._registrations.some(it => it.status === STATUS_AVAILABLE)) {
			throw new TypeError(`At least one authentication provider must be available.`);
		}
		Object.freeze(this._registrations);
	}

	getAvailableProviders () {
		return this._registrations
			.filter(it => it.status === STATUS_AVAILABLE)
			.map(it => it.provider);
	}

	getPublicMetadata () {
		return this._registrations.map(({slug, label, startPath, status}) => ({slug, label, startPath, status}));
	}
}

export function getLegacyGitHubAuthProviderRegistry (oauthProvider) {
	if (!oauthProvider) throw new TypeError(`oauthProvider is required.`);
	return new AuthProviderRegistry({
		registrations: [{
			status: STATUS_AVAILABLE,
			provider: {
				slug: "github",
				label: "GitHub",
				startPath: "/auth/github/start",
				callbackPath: "/auth/github/callback",
				capabilities: {pkce: "S256", oidcNonce: false},
				getAuthorizationUrl: context => oauthProvider.getAuthorizationUrl(context),
				pExchangeCodeForIdentity: async context => {
					const identity = await oauthProvider.pExchangeCode(context);
					return {
						provider: identity.provider,
						subject: identity.subject ?? identity.providerSubject,
						displayName: identity.displayName,
						handle: identity.handle ?? identity.login,
					};
				},
			},
		}],
	});
}
