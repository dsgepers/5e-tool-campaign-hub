import {LocalPasswordProvider} from "./local-password-provider.js";
import {
	AuthProviderRegistry,
	createAuthProviderRegistration,
} from "./auth-provider-registry.js";
import {DiscordOAuthProvider} from "./discord-oauth-provider.js";
import {GitHubOAuthProvider} from "./github-oauth-provider.js";
import {GoogleOAuthProvider} from "./google-oauth-provider.js";
import {normalizeIdentityRetentionRequiredProviders} from "./account-identities.js";

const PROVIDERS = Object.freeze({
	github: {
		label: "GitHub",
		clientIdName: "GITHUB_CLIENT_ID",
		clientSecretName: "GITHUB_CLIENT_SECRET",
		Provider: GitHubOAuthProvider,
	},
	discord: {
		label: "Discord",
		clientIdName: "DISCORD_CLIENT_ID",
		clientSecretName: "DISCORD_CLIENT_SECRET",
		Provider: DiscordOAuthProvider,
	},
	google: {
		label: "Google",
		clientIdName: "GOOGLE_CLIENT_ID",
		clientSecretName: "GOOGLE_CLIENT_SECRET",
		Provider: GoogleOAuthProvider,
	},
});

function getCsv (value) {
	return (value || "")
		.split(",")
		.map(it => it.trim())
		.filter(Boolean);
}

function getProviderSet (rawValue, fallback = []) {
	const values = getCsv(rawValue);
	const normalized = values.length ? values : fallback;
	const out = new Set();
	for (const value of normalized) {
		if (!Object.hasOwn(PROVIDERS, value)) throw new TypeError(`Unsupported authentication provider.`);
		if (out.has(value)) throw new TypeError(`Duplicate authentication provider.`);
		out.add(value);
	}
	return out;
}

function getCredential (env, name) {
	const value = env[name];
	if (
		typeof value !== "string"
		|| !value
		|| value !== value.trim()
		|| Array.from(value).length > 4_096
	) {
		const error = new TypeError(`Authentication provider credential is invalid.`);
		error.code = "INVALID_CREDENTIAL";
		throw error;
	}
	return value;
}

export function getAllowedOAuthSubjects (rawValue) {
	const entries = getCsv(rawValue);
	const seen = new Set();
	for (const entry of entries) {
		const separatorIndex = entry.indexOf(":");
		if (separatorIndex <= 0) throw new TypeError(`OAuth rollback subject is invalid.`);
		const provider = entry.slice(0, separatorIndex);
		const subject = entry.slice(separatorIndex + 1);
		if (!Object.hasOwn(PROVIDERS, provider) || !subject || subject !== subject.trim() || Array.from(subject).length > 255) {
			throw new TypeError(`OAuth rollback subject is invalid.`);
		}
		if ((provider === "github" || provider === "discord") && !/^[1-9][0-9]{0,19}$/.test(subject)) {
			throw new TypeError(`OAuth rollback subject is invalid.`);
		}
		if (seen.has(entry)) throw new TypeError(`Duplicate OAuth rollback subject.`);
		seen.add(entry);
	}
	return entries;
}

export function createAuthProviderConfiguration ({
	env = process.env,
	onConfigurationError = null,
	fnFetchByProvider = {},
}) {
	const mode = env.HUB_AUTH_MODE || "oauth";
	if (mode === "local") {
		const provider = LocalPasswordProvider.fromFile(env.HUB_LOCAL_USERS_FILE);
		return {
			authProviderRegistry: new AuthProviderRegistry({registrations: [{status: "available", provider}]}),
			identityRetentionRequiredProviders: ["local"],
		};
	}
	if (mode !== "oauth") throw new TypeError("HUB_AUTH_MODE must be oauth or local.");
	const configured = getProviderSet(env.HUB_AUTH_PROVIDERS, ["github"]);
	const emergencyDisabled = getProviderSet(env.HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS);
	if (configured.has("discord") !== configured.has("google")) {
		throw new TypeError(`Discord and Google must be configured together.`);
	}
	const identityRetentionRequiredProviders = normalizeIdentityRetentionRequiredProviders(
		getCsv(env.HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS).length
			? getCsv(env.HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS)
			: ["github"],
		{configuredProviders: configured},
	);
	const registrations = Object.entries(PROVIDERS).map(([slug, definition]) => {
		const status = configured.has(slug) && !emergencyDisabled.has(slug) ? "available" : "disabled";
		return createAuthProviderRegistration({
			slug,
			label: definition.label,
			status,
			fnCreate: () => new definition.Provider({
				clientId: getCredential(env, definition.clientIdName),
				clientSecret: getCredential(env, definition.clientSecretName),
				...(fnFetchByProvider[slug] ? {fnFetch: fnFetchByProvider[slug]} : {}),
			}),
			onConfigurationError,
		});
	});

	return {
		authProviderRegistry: new AuthProviderRegistry({registrations}),
		identityRetentionRequiredProviders,
	};
}
