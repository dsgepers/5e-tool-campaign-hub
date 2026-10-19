import {getLocalLoginHtml} from "./local-login-html.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import {
	getCsrfToken,
	getDeterministicToken,
	getPkceChallenge,
	getRandomToken,
	getSha256,
	isConstantTimeEqual,
} from "./security.js";
import {HubStoreError} from "./hub-store-error.js";
import {HUB_CAPABILITY_ROLL_HISTORY} from "../../js/hub/hub-roll-history.js";
import {AuthProviderError} from "./auth-provider-error.js";
import {
	AUTH_PROVIDER_REGISTRY_CAPABILITY,
	getLegacyGitHubAuthProviderRegistry,
} from "./auth-provider-registry.js";
import {PROJECTION_POLICY_VERSION, PROJECTION_PRESET_KEYS} from "./character-projection.js";
import {
	CAMPAIGN_RULES_SCHEMA_VERSION,
	getCampaignBrewHash,
	normalizeCampaignRules,
	normalizeCampaignRulesPolicyForStorage,
	validateCampaignBrewBundle,
} from "./campaign-content.js";
import {pGetCampaignContentCatalog} from "./campaign-content-policy.js";
import {
	CAMPAIGN_RULES_POLICY_CAPABILITY,
	getPublicCampaignRulesCatalog,
} from "../../js/hub/hub-campaign-rules.js";
import {HubOutboxDispatcher, HubRealtime} from "./realtime.js";
import {getSafeRequestId, HubMetrics} from "./observability.js";
import {getClientIpHeader, getRequestClientIp} from "./client-ip.js";
import {SAFE_ITEM_SUMMARY_FIELDS} from "./hub-actions.js";
import {PEER_SOURCE_COSTS_PROTOCOL_VERSION} from "../../js/hub/hub-source-costs.js";
import {
	MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
	MULTI_TARGET_OPERATIONS_MAX_TARGETS,
	MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION,
} from "../../js/hub/hub-multi-target-operations.js";
import {ACTIVE_CAMPAIGN_CONTEXT_CAPABILITY} from "./hub-capabilities.js";
import {
	ACCOUNT_ENTITLEMENTS_CAPABILITY,
	parseOperatorAccountIds,
} from "./account-entitlements.js";
import {
	ACCOUNT_IDENTITY_LINKING_CAPABILITY,
	ACCOUNT_IDENTITY_LINK_TTL_SECONDS,
	getPublicExternalIdentity,
	normalizeIdentityRetentionRequiredProviders,
} from "./account-identities.js";
import {HUB_PROTOCOL_VERSION} from "../../js/hub/hub-capabilities.js";
import crypto from "node:crypto";

const {normalizeIP} = rateLimit;
const SESSION_COOKIE = "__Host-hub_session";
const OAUTH_COOKIE = "__Host-hub_oauth";
const OAUTH_COOKIE_PREFIX = `${OAUTH_COOKIE}-`;
const INVITE_ADMISSION_CAPABILITY = "auth.invite_admission.v1";
const HUB_LEGACY_PROTOCOL_VERSION = "3";
const HUB_PROTOCOL_5_VERSION = "5";
const SUPPORTED_HUB_PROTOCOL_VERSIONS = new Set([
	HUB_LEGACY_PROTOCOL_VERSION,
	PEER_SOURCE_COSTS_PROTOCOL_VERSION,
	HUB_PROTOCOL_5_VERSION,
	HUB_PROTOCOL_VERSION,
]);
const SAFE_ITEM_SUMMARY_KEYS = new Set(SAFE_ITEM_SUMMARY_FIELDS);
const getProtocolCompatiblePendingActions = ({actions, protocolVersion}) => {
	if (protocolVersion !== HUB_LEGACY_PROTOCOL_VERSION) return actions;
	return actions.filter(action =>
		action?.contractVersion == null
		&& action?.sourceCostState == null
		&& action?.templateRegistryVersion == null,
	);
};
const getSafeItemSummarySchema = () => ({
	type: "object",
	required: ["name", "source"],
	additionalProperties: false,
	properties: {
		name: {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"},
		source: {type: "string", minLength: 1, maxLength: 50, pattern: "\\S"},
		page: {type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
		rarity: {type: "string", maxLength: 80},
		weight: {type: "number", minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
		value: {type: "number", minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
		typeCode: {type: "string", maxLength: 80},
		edition: {type: "string", enum: ["classic", "one"]},
	},
});
const DEFAULT_DM_WORKSPACE = {
	mv: 0,
	w: 3,
	h: 3,
	ctc: false,
	fs: false,
	lk: false,
	sla: "1",
	sls: {"1": {ps: [], ex: []}},
};

function getCookieOptions ({isSecure, maxAge}) {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isSecure,
		signed: true,
		maxAge,
	};
}

function getOAuthLinkState ({transactionId, secret}) {
	return `${transactionId}.${getDeterministicToken({
		secret,
		namespace: "hub-oauth-link-state",
		parts: [transactionId],
	})}`;
}

function getClearCookieOptions ({isSecure}) {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isSecure,
	};
}

function getSignedCookie (request, name) {
	const raw = request.cookies[name];
	if (!raw) return null;
	const unsigned = request.unsignCookie(raw);
	return unsigned.valid ? unsigned.value : null;
}

function getOAuthTransactionCookieName (transactionId) {
	return `${OAUTH_COOKIE_PREFIX}${transactionId}`;
}

function getOAuthState (transactionId) {
	return `${transactionId}.${getRandomToken()}`;
}

function getOAuthTransactionIdFromState (state) {
	if (typeof state !== "string") return null;
	const separatorIndex = state.indexOf(".");
	if (separatorIndex === -1) return null;
	const transactionId = state.slice(0, separatorIndex);
	const secret = state.slice(separatorIndex + 1);
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)
		|| !/^[A-Za-z0-9_-]{32,}$/.test(secret)
	) return null;
	return transactionId;
}

function getOAuthTransactionCookieIds (request) {
	return Object.keys(request.cookies || {})
		.filter(name => name.startsWith(OAUTH_COOKIE_PREFIX))
		.map(name => {
			const transactionId = name.slice(OAUTH_COOKIE_PREFIX.length);
			return getSignedCookie(request, name) === transactionId ? transactionId : null;
		})
		.filter(Boolean);
}

function validateConfig (config) {
	if (!config?.appOrigin) throw new TypeError(`config.appOrigin is required.`);
	if (!config?.cookieSecret || config.cookieSecret.length < 32) throw new TypeError(`config.cookieSecret must be at least 32 characters.`);
	if (!config?.csrfSecret || config.csrfSecret.length < 32) throw new TypeError(`config.csrfSecret must be at least 32 characters.`);
	const inviteTokenSecrets = config.inviteTokenSecrets
		|| [
			config.inviteTokenSecret
			|| (process.env.NODE_ENV === "test" ? "test-only-invite-token-secret-value" : null),
		];
	if (
		!Array.isArray(inviteTokenSecrets)
		|| !inviteTokenSecrets.length
		|| inviteTokenSecrets.length > 4
		|| inviteTokenSecrets.some(secret => typeof secret !== "string" || secret.length < 32)
		|| new Set(inviteTokenSecrets).size !== inviteTokenSecrets.length
	) {
		throw new TypeError(`config.inviteTokenSecrets must contain 1-4 unique secrets of at least 32 characters.`);
	}
	if (config.metricsToken != null && config.metricsToken.length < 32) throw new TypeError(`config.metricsToken must be at least 32 characters.`);
	const parsedAppOrigin = new URL(config.appOrigin);
	const appOrigin = parsedAppOrigin.origin;
	if (config.appOrigin !== appOrigin) throw new TypeError(`config.appOrigin must be an exact origin.`);
	if (parsedAppOrigin.protocol !== "https:") throw new TypeError(`config.appOrigin must use HTTPS.`);
	const clientIpHeader = getClientIpHeader(config.clientIpHeader);
	if (clientIpHeader && config.trustProxy) {
		throw new TypeError(`clientIpHeader and trustProxy cannot be enabled together.`);
	}
	const normalized = {
		sessionTtlSeconds: 60 * 60 * 24 * 30,
		oauthStateTtlSeconds: 10 * 60,
		inviteContextTtlSeconds: 5 * 60,
		isInviteAccountAdmissionEnabled: false,
		isAccountEntitlementsEnabled: false,
		isAccountIdentityLinkingEnabled: false,
		identityRetentionRequiredProviders: ["github"],
		operatorAccountIds: [],
		isSecure: new URL(appOrigin).protocol === "https:",
		trustProxy: false,
		metricsToken: null,
		...config,
		inviteTokenSecrets,
		appOrigin,
		clientIpHeader,
	};
	normalized.operatorAccountIds = parseOperatorAccountIds(normalized.operatorAccountIds);
	normalized.identityRetentionRequiredProviders = normalizeIdentityRetentionRequiredProviders(
		normalized.identityRetentionRequiredProviders,
	);
	return normalized;
}

function getSafeReturnTo ({rawReturnTo, appOrigin}) {
	if (typeof rawReturnTo !== "string") return "/hub.html";
	try {
		const url = new URL(rawReturnTo, appOrigin);
		if (url.origin !== appOrigin) return "/hub.html";
		if (url.pathname.startsWith("//")) return "/hub.html";
		if (
			[...url.searchParams.keys()].some(key => /invite|context/i.test(key))
			|| /(?:^|[?&#])(?:invite|invitecontext|context)=/i.test(url.hash)
		) return "/hub.html";
		const returnTo = `${url.pathname}${url.search}${url.hash}`;
		return returnTo.length <= 2_048 ? returnTo : "/hub.html";
	} catch {
		return "/hub.html";
	}
}

function getSafeInviteReturnTo ({rawReturnTo, appOrigin}) {
	const safe = getSafeReturnTo({rawReturnTo, appOrigin});
	try {
		const url = new URL(safe, appOrigin);
		if (url.hash) return "/hub.html";
		if (url.pathname === "/hub.html") return "/hub.html";
		if (url.pathname !== "/campaign.html") return "/hub.html";
		if ([...url.searchParams.keys()].some(key => key !== "id")) return "/hub.html";
		const campaignId = url.searchParams.get("id");
		if (campaignId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(campaignId)) {
			return "/hub.html";
		}
		return campaignId == null ? "/campaign.html" : `/campaign.html?id=${encodeURIComponent(campaignId)}`;
	} catch {
		return "/hub.html";
	}
}

export async function createHubApp ({
	store,
	authProviderRegistry = null,
	oauthProvider = null,
	config: rawConfig,
	logger = false,
	realtime: realtimeOverride = null,
	isStartOutboxDispatcher = false,
	metrics: metricsOverride = null,
}) {
	if (!store) throw new TypeError(`store is required.`);
	if (authProviderRegistry && oauthProvider) throw new TypeError(`Provide authProviderRegistry or oauthProvider, not both.`);
	const providerRegistry = authProviderRegistry || getLegacyGitHubAuthProviderRegistry(oauthProvider);
	const config = validateConfig(rawConfig);
	const registeredProviderSlugs = new Set(providerRegistry.getPublicMetadata().map(provider => provider.slug));
	if (registeredProviderSlugs.has("local") && config.isAccountIdentityLinkingEnabled) {
		throw new TypeError("Local login does not support OAuth identity linking. Disable HUB_ACCOUNT_IDENTITY_LINKING_ENABLED.");
	}
	if (config.identityRetentionRequiredProviders.some(provider => !registeredProviderSlugs.has(provider))) {
		throw new TypeError(`Identity retention providers must be registered authentication providers.`);
	}
	if (config.isInviteAccountAdmissionEnabled && !config.isAccountEntitlementsEnabled) {
		throw new TypeError(`Invite account admission requires account entitlement enforcement.`);
	}
	const metrics = metricsOverride || new HubMetrics();
	const app = Fastify({
		logger,
		trustProxy: config.trustProxy,
		bodyLimit: 2 * 1024 * 1024,
		genReqId: request => getSafeRequestId(request) || crypto.randomUUID(),
	});
	store.setAccountEntitlementsEnabled?.(config.isAccountEntitlementsEnabled);
	if (!config.isOperatorReconciliationComplete && config.operatorAccountIds.length) {
		await store.pReconcileConfiguredOperatorEntitlements?.({
			accountIds: config.operatorAccountIds,
			onWarning: warning => app.log.warn(warning, "Configured Hub operator account was not found"),
		});
	}
	if (
		config.isAccountEntitlementsEnabled
		&& !await store.pHasActivePlatformOperator?.()
	) {
		throw new TypeError(`Account entitlement enforcement requires an active platform operator.`);
	}
	await app.register(cookie, {secret: config.cookieSecret});
	let realtime;
	await app.register(websocket, {
		options: {maxPayload: 16 * 1024},
		preClose: async function () {
			realtime?.stop?.();
			const sockets = [...this.websocketServer.clients];
			const closePromises = sockets.map(socket => new Promise(resolve => {
				if (socket.readyState === 3) return resolve();
				socket.once("close", resolve);
				if (socket.readyState === 1) socket.close(1001, "Server shutdown");
			}));
			let timeout;
			await Promise.race([
				Promise.all(closePromises),
				new Promise(resolve => {
					timeout = setTimeout(resolve, 1_000);
					timeout.unref?.();
				}),
			]);
			if (timeout) clearTimeout(timeout);
			for (const socket of sockets) {
				if (socket.readyState !== 3) socket.terminate();
			}
			await new Promise((resolve, reject) => {
				this.websocketServer.close(error => error ? reject(error) : resolve());
			});
		},
	});
	if (registeredProviderSlugs.has("local")) {
		app.addContentTypeParser("application/x-www-form-urlencoded", {parseAs: "string", bodyLimit: 8_192}, (request, body, done) => {
			const fields = new URLSearchParams(body);
			if ([...fields.keys()].length !== new Set(fields.keys()).size) {
				return done(new HubStoreError("INVALID_REQUEST", "Duplicate form fields.", {status: 400}));
			}
			done(null, Object.fromEntries(fields));
		});
	}
	await app.register(rateLimit, {
		global: false,
		max: 30,
		timeWindow: "1 minute",
		keyGenerator: request => normalizeIP(getRequestClientIp({
			request,
			clientIpHeader: config.clientIpHeader,
		})),
	});
	app.decorateRequest("hubClientIp", null);
	app.addHook("onSend", async (request, reply, payload) => {
		reply.header("x-request-id", request.id);
		reply.header("x-content-type-options", "nosniff");
		reply.header("x-frame-options", "DENY");
		reply.header("referrer-policy", "same-origin");
		reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
		if (request.url.startsWith("/api/") || request.url.startsWith("/auth/")) {
			reply.header("cache-control", "no-store");
		}
		return payload;
	});
	app.addHook("onRequest", async request => {
		request.hubRequestStartedAt = performance.now();
		request.hubClientIp = getRequestClientIp({request, clientIpHeader: config.clientIpHeader});
	});
	app.addHook("onResponse", async (request, reply) => {
		metrics.observeRequest({
			method: request.method,
			route: request.routeOptions?.url || "unknown",
			statusCode: reply.statusCode,
			durationMs: performance.now() - request.hubRequestStartedAt,
		});
	});

	app.decorateRequest("hubAuth", null);
	app.decorateRequest("hubRequestStartedAt", 0);
	app.addHook("preValidation", async request => {
		const values = [
			...Object.entries(request.params || {}).filter(([key]) => key.endsWith("Id")),
			...Object.entries(request.query || {}).filter(([key]) => key.endsWith("Id")),
		];
		for (const [, value] of values) {
			if (value == null) continue;
			if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(`${value}`)) {
				throw new HubStoreError("INVALID_ID", `Invalid identifier.`);
			}
		}
	});
	realtime = realtimeOverride || new HubRealtime({store});
	const outboxDispatcher = new HubOutboxDispatcher({store, realtime});
	app.decorate("hubRealtime", realtime);
	app.decorate("hubOutboxDispatcher", outboxDispatcher);
	app.decorate("hubMetrics", metrics);
	if (isStartOutboxDispatcher) outboxDispatcher.start();
	app.addHook("onClose", async () => {
		outboxDispatcher.stop();
	});
	app.setErrorHandler((error, request, reply) => {
		if (error instanceof AuthProviderError) {
			return reply.code(error.status).send({error: error.code});
		}
		if (error instanceof HubStoreError) {
			return reply.code(error.status).send({
				error: error.code,
				...(error.details == null ? {} : {details: error.details}),
			});
		}
		if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
			return reply.code(413).send({error: "PAYLOAD_TOO_LARGE"});
		}
		if (error.validation) return reply.code(400).send({error: "INVALID_REQUEST"});
		if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
			return reply.code(error.statusCode).send({error: error.code || "REQUEST_REJECTED"});
		}
		request.log.error(error);
		return reply.code(500).send({error: "INTERNAL_ERROR"});
	});

	const pGetAuth = async request => {
		if (request.hubAuth) return request.hubAuth;
		const token = getSignedCookie(request, SESSION_COOKIE);
		if (!token) return null;
		request.hubAuth = await store.pGetSessionByTokenHash({tokenHash: getSha256(token)});
		const localProvider = providerRegistry.getAvailableProviders().find(provider => provider.authenticationType === "password");
		if (request.hubAuth && localProvider) {
			const identities = await store.pListExternalIdentities({accountId: request.hubAuth.account.id});
			if (!identities.some(identity => identity.id === request.hubAuth.session.authenticatedViaIdentityId
				&& identity.provider === "local" && localProvider.hasIdentity(identity.subject))) request.hubAuth = null;
		}
		return request.hubAuth;
	};

	const deletionPendingAllowedPaths = new Set([
		"/api/live",
		"/api/ready",
		"/api/metrics",
		"/api/session",
		"/api/account/export",
		"/api/account/deletion",
		"/api/account/deletion/request",
		"/api/account/deletion/cancel",
		"/api/logout",
		"/api/health",
		"/api/meta",
	]);
	app.addHook("preHandler", async (request, reply) => {
		const pathname = request.url.split("?")[0];
		if (
			["/api/live", "/api/ready", "/api/health", "/api/meta", "/api/metrics"].includes(pathname)
			|| pathname.startsWith("/auth/")
			|| pathname.startsWith("/api/account/reauthentication/")
			|| pathname.startsWith("/api/operator/")
		) return;
		const auth = await pGetAuth(request);
		if (auth?.account.status !== "deletion_requested") return;
		if (pathname.startsWith("/api/account/reauthentication/")) return;
		if (deletionPendingAllowedPaths.has(pathname)) return;
		return reply.code(423).send({error: "ACCOUNT_DELETION_PENDING"});
	});

	const requireAuth = async (request, reply) => {
		const auth = await pGetAuth(request);
		if (auth) return;
		return reply.code(401).send({error: "AUTH_REQUIRED"});
	};

	/**
	 * Reads whose response shape is an ADR 0011 authorization envelope. An older client
	 * would misread these silently rather than failing, so they are version-gated exactly
	 * like mutations.
	 */
	const requireProtocolVersion = async (request, reply) => {
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		if (!SUPPORTED_HUB_PROTOCOL_VERSIONS.has(request.headers["x-hub-protocol-version"])) {
			return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
		}
	};

	const requirePeerSourceCostsProtocol = async (request, reply) => {
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		if (![PEER_SOURCE_COSTS_PROTOCOL_VERSION, HUB_PROTOCOL_5_VERSION, HUB_PROTOCOL_VERSION].includes(request.headers["x-hub-protocol-version"])) {
			return reply.code(426).send({
				error: "PROTOCOL_UPDATE_REQUIRED",
				protocolVersion: HUB_PROTOCOL_VERSION,
			});
		}
	};

	const requireMultiTargetProtocol = async (request, reply) => {
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		if (request.headers["x-hub-protocol-version"] !== MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION) {
			return reply.code(426).send({
				error: "PROTOCOL_UPDATE_REQUIRED",
				protocolVersion: HUB_PROTOCOL_VERSION,
			});
		}
	};

	const requireMutationSecurity = async (request, reply) => {
		if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		const expected = getCsrfToken({csrfSecret: config.csrfSecret, sessionId: auth.session.id});
		if (!isConstantTimeEqual(request.headers["x-csrf-token"], expected)) {
			return reply.code(403).send({error: "INVALID_CSRF"});
		}
		if (!SUPPORTED_HUB_PROTOCOL_VERSIONS.has(request.headers["x-hub-protocol-version"])) {
			return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
		}
	};
	const requireCurrentProtocolVersion = async (request, reply) => {
		if (request.headers["x-hub-protocol-version"] === HUB_PROTOCOL_VERSION) return;
		return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
	};
	const multiTargetRateWindows = new Map();
	const requireMultiTargetMutation = ({accountLimit, campaignLimit}) => async (request, reply) => {
		await requireMutationSecurity(request, reply);
		if (reply.sent) return;
		await requireCurrentProtocolVersion(request, reply);
		if (reply.sent) return;
		const now = Date.now();
		const minute = 60_000;
		if (multiTargetRateWindows.size > 10_000) {
			for (const [key, value] of multiTargetRateWindows) {
				if (now - value.startedAt >= minute) multiTargetRateWindows.delete(key);
			}
		}
		const keys = [
			[`account:${request.routeOptions.url}:${request.hubAuth.account.id}`, accountLimit],
			[`campaign:${request.routeOptions.url}:${request.params.campaignId}`, campaignLimit],
		];
		for (const [key, max] of keys) {
			const current = multiTargetRateWindows.get(key);
			const window = !current || now - current.startedAt >= minute
				? {startedAt: now, count: 0}
				: current;
			if (window.count >= max) {
				return reply.code(429).send({error: "RATE_LIMITED"});
			}
			window.count++;
			multiTargetRateWindows.set(key, window);
		}
	};
	const hasOnlyKeys = (value, allowedKeys) => (
		!!value
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& Object.keys(value).every(key => allowedKeys.has(key))
	);
	const hasStrictSafeItemTypes = item => (
		typeof item.name === "string"
		&& typeof item.source === "string"
		&& (item.page === undefined || (typeof item.page === "number" && Number.isSafeInteger(item.page)))
		&& (item.rarity === undefined || typeof item.rarity === "string")
		&& (item.weight === undefined || (typeof item.weight === "number" && Number.isFinite(item.weight)))
		&& (item.value === undefined || (typeof item.value === "number" && Number.isFinite(item.value)))
		&& (item.typeCode === undefined || typeof item.typeCode === "string")
		&& (item.edition === undefined || typeof item.edition === "string")
	);
	const rejectUnknownAwardFields = async (request, reply) => {
		const body = request.body;
		if (
			!hasOnlyKeys(body, new Set(["source", "targetCharacterIds", "quantity", "note", "rulesVersionId"]))
			|| !Array.isArray(body.targetCharacterIds)
			|| body.targetCharacterIds.some(id => typeof id !== "string")
			|| !Number.isSafeInteger(body.quantity)
			|| (body.note !== undefined && body.note !== null && typeof body.note !== "string")
		) {
			return reply.code(400).send({error: "INVALID_REQUEST"});
		}
		const source = body.source;
		const sourceKeys = source?.kind === "party_inventory"
			? new Set(["kind", "entryId"])
			: new Set(["kind", "item"]);
		if (!hasOnlyKeys(source, sourceKeys)) return reply.code(400).send({error: "INVALID_REQUEST"});
		if (
			typeof source.kind !== "string"
			|| (source.kind === "party_inventory" && typeof source.entryId !== "string")
			|| (
				source.kind !== "party_inventory"
				&& (
					!hasOnlyKeys(source.item, SAFE_ITEM_SUMMARY_KEYS)
					|| !hasStrictSafeItemTypes(source.item)
				)
			)
		) {
			return reply.code(400).send({error: "INVALID_REQUEST"});
		}
	};
	const rejectUnknownLegacyItemGrantFields = async (request, reply) => {
		if (
			!hasOnlyKeys(request.body, new Set(["item", "quantity", "rulesVersionId"]))
			|| !hasOnlyKeys(request.body?.item, SAFE_ITEM_SUMMARY_KEYS)
			|| !hasStrictSafeItemTypes(request.body.item)
			|| (request.body.quantity !== undefined && !Number.isSafeInteger(request.body.quantity))
		) return reply.code(400).send({error: "INVALID_REQUEST"});
	};
	const rejectUnknownSemanticActionFields = async (request, reply) => {
		const body = request.body;
		if (!hasOnlyKeys(body, new Set([
			"contractVersion",
			"commandId",
			"targetCharacterId",
			"operation",
			"sourceCharacterId",
			"sourceEntity",
			"effectTemplateId",
			"choice",
			"targetRef",
			"rulesVersionId",
		]))) return reply.code(400).send({error: "INVALID_REQUEST"});
		if (
			body.sourceEntity != null
			&& !hasOnlyKeys(body.sourceEntity, new Set(["type", "uid", "version"]))
		) return reply.code(400).send({error: "INVALID_REQUEST"});
		if (
			body.choice != null
			&& !hasOnlyKeys(body.choice, new Set(["amount", "castLevel"]))
		) return reply.code(400).send({error: "INVALID_REQUEST"});
		if (body.operation != null) {
			if (!hasOnlyKeys(body.operation, new Set(["kind", "version", "arguments"]))) {
				return reply.code(400).send({error: "INVALID_REQUEST"});
			}
			if (!hasOnlyKeys(body.operation.arguments, new Set(["amount", "condition", "level"]))) {
				return reply.code(400).send({error: "INVALID_REQUEST"});
			}
			if (
				body.operation.arguments.condition != null
				&& !hasOnlyKeys(body.operation.arguments.condition, new Set(["name", "source"]))
			) return reply.code(400).send({error: "INVALID_REQUEST"});
		}
	};
	const rejectUnknownSemanticResolutionFields = async (request, reply) => {
		if (!hasOnlyKeys(request.body, new Set(["contractVersion", "commandId", "decision"]))) {
			return reply.code(400).send({error: "INVALID_REQUEST"});
		}
	};

	const getIdempotencyKey = request => {
		const idempotencyKey = request.headers["idempotency-key"];
		if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200) {
			throw new HubStoreError("IDEMPOTENCY_KEY_REQUIRED", `A valid idempotency key is required.`);
		}
		const body = request.body && typeof request.body === "object"
			? Object.fromEntries(Object.entries(request.body).filter(([key]) => !["baseRevision", "leaseEpoch"].includes(key)))
			: request.body || null;
		return {
			key: idempotencyKey,
			requestHash: getSha256(JSON.stringify({
				method: request.method,
				route: request.routeOptions?.url || request.url,
				params: request.params || {},
				query: request.query || {},
				body,
			})),
		};
	};
	const requireIdentityMutationSecurity = async (request, reply) => {
		if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
		let auth = await pGetAuth(request);
		if (!auth) {
			const token = getSignedCookie(request, SESSION_COOKIE);
			if (token) {
				auth = await store.pGetIdentityUnlinkRecovery?.({
					tokenHash: getSha256(token),
					idempotencyKey: getIdempotencyKey(request),
				});
			}
		}
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		const expected = getCsrfToken({csrfSecret: config.csrfSecret, sessionId: auth.session.id});
		if (!isConstantTimeEqual(request.headers["x-csrf-token"], expected)) {
			return reply.code(403).send({error: "INVALID_CSRF"});
		}
		if (!SUPPORTED_HUB_PROTOCOL_VERSIONS.has(request.headers["x-hub-protocol-version"])) {
			return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
		}
		request.hubAuth = auth;
	};
	const getSemanticCommand = request => {
		const idempotencyKey = getIdempotencyKey(request);
		if (idempotencyKey.key !== request.body.commandId) {
			throw new HubStoreError("IDEMPOTENCY_KEY_MISMATCH", `Command ID must match the idempotency key.`);
		}
		return {
			commandId: request.body.commandId,
			requestHash: idempotencyKey.requestHash,
		};
	};

	const requireCampaignRole = roles => async (request, reply) => {
		const membership = await store.pGetMembership({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		});
		if (!membership) return reply.code(404).send({error: "CAMPAIGN_NOT_FOUND"});
		if (!roles.includes(membership.role)) return reply.code(403).send({error: "FORBIDDEN"});
		request.hubMembership = membership;
	};

	const requireWebSocketMembership = async (request, reply) => {
		if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
		const auth = await pGetAuth(request);
		if (!auth) return reply.code(401).send({error: "AUTH_REQUIRED"});
		if (auth.account.status !== "active") return reply.code(423).send({error: "ACCOUNT_DELETION_PENDING"});
		const membership = await store.pGetMembership({
			accountId: auth.account.id,
			campaignId: request.params.campaignId,
		});
		if (!membership) return reply.code(404).send({error: "CAMPAIGN_NOT_FOUND"});
		if (![PEER_SOURCE_COSTS_PROTOCOL_VERSION, HUB_PROTOCOL_5_VERSION, HUB_PROTOCOL_VERSION].includes(request.query.v)) {
			const [capability, isProtocol4History] = await Promise.all([
				store.pGetPeerSourceCostsCapability?.({
					accountId: auth.account.id,
					campaignId: request.params.campaignId,
				}),
				store.pCampaignRequiresProtocol4?.({campaignId: request.params.campaignId}),
			]);
			if (capability?.enabled || isProtocol4History) {
				return reply.code(426).send({
					error: "PROTOCOL_UPDATE_REQUIRED",
					protocolVersion: HUB_PROTOCOL_VERSION,
				});
			}
		}
		if (request.query.v !== MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION) {
			const [capability, isProtocol6History] = await Promise.all([
				store.pGetMultiTargetOperationsCapability?.({
					accountId: auth.account.id,
					campaignId: request.params.campaignId,
				}),
				store.pCampaignRequiresProtocol6?.({campaignId: request.params.campaignId}),
			]);
			if (capability?.enabled || isProtocol6History) {
				return reply.code(426).send({
					error: "PROTOCOL_UPDATE_REQUIRED",
					protocolVersion: HUB_PROTOCOL_VERSION,
				});
			}
		}
		request.hubMembership = membership;
	};

	app.get("/api/live", async () => ({ok: true}));

	const pHandleReadiness = async (request, reply) => {
		try {
			await store.pCheckHealth();
			return {ok: true};
		} catch {
			return reply.code(503).send({ok: false, error: "DATABASE_UNAVAILABLE"});
		}
	};
	app.get("/api/ready", pHandleReadiness);
	app.get("/api/health", pHandleReadiness);

	app.get("/api/metrics", async (request, reply) => {
		if (!config.metricsToken) return reply.code(404).send({error: "NOT_FOUND"});
		const authorization = request.headers.authorization;
		const supplied = typeof authorization === "string" && authorization.startsWith("Bearer ")
			? authorization.slice(7)
			: null;
		if (!isConstantTimeEqual(supplied, config.metricsToken)) return reply.code(401).send({error: "AUTH_REQUIRED"});
		const operational = await store.pGetOperationalMetrics();
		reply.type("text/plain; version=0.0.4; charset=utf-8");
		return metrics.toPrometheus({
			operational,
			websocketConnections: realtime.getConnectionCount(),
			dispatcher: outboxDispatcher.getStatus(),
		});
	});

	app.get("/api/meta", async () => ({
		protocolVersion: HUB_PROTOCOL_VERSION,
		appVersion: process.env.npm_package_version || null,
		capabilities: [
			HUB_CAPABILITY_ROLL_HISTORY,
			AUTH_PROVIDER_REGISTRY_CAPABILITY,
			ACTIVE_CAMPAIGN_CONTEXT_CAPABILITY,
			...(config.isInviteAccountAdmissionEnabled ? [INVITE_ADMISSION_CAPABILITY] : []),
			...(config.isCampaignRulesPolicyEnabled ? [CAMPAIGN_RULES_POLICY_CAPABILITY] : []),
			...(config.isAccountEntitlementsEnabled ? [ACCOUNT_ENTITLEMENTS_CAPABILITY] : []),
			...(config.isAccountIdentityLinkingEnabled ? [ACCOUNT_IDENTITY_LINKING_CAPABILITY] : []),
		],
		authProviders: providerRegistry.getPublicMetadata(),
	}));

	app.post("/api/auth/invite-contexts", {
		config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
		schema: {
			body: {
				type: "object",
				required: ["token", "provider", "returnTo"],
				additionalProperties: false,
				properties: {
					token: {type: "string", minLength: 32, maxLength: 500},
					provider: {type: "string", minLength: 1, maxLength: 32},
					returnTo: {type: "string", minLength: 1, maxLength: 2_048},
				},
			},
		},
	}, async (request, reply) => {
		if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
		if (request.headers["x-hub-protocol-version"] !== HUB_PROTOCOL_VERSION) {
			return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
		}
		const provider = providerRegistry.getAvailableProviders()
			.find(it => it.slug === request.body.provider);
		if (!provider) return reply.code(403).send({error: "INVITE_ADMISSION_INVALID"});
		const transactionId = crypto.randomUUID();
		const state = getOAuthState(transactionId);
		const pkceVerifier = provider.capabilities.pkce ? getRandomToken(48) : null;
		const oidcNonce = provider.capabilities.oidcNonce ? getRandomToken() : null;
		const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
		const returnTo = getSafeInviteReturnTo({
			rawReturnTo: request.body.returnTo,
			appOrigin: config.appOrigin,
		});
		const authorizationUrl = provider.getAuthorizationUrl({
			state,
			codeChallenge: pkceVerifier == null ? null : getPkceChallenge(pkceVerifier),
			nonce: oidcNonce,
			redirectUri,
		});
		const retryToken = getRandomToken();
		await store.pCreateInviteOAuthTransaction({
			transaction: {
				id: transactionId,
				stateHash: getSha256(state),
				provider: provider.slug,
				operation: "sign_in",
				redirectUri,
				returnTo,
				pkceVerifier,
				oidcNonce,
				ttlSeconds: config.oauthStateTtlSeconds,
			},
			inviteTokenHash: getSha256(request.body.token),
			retryTokenHash: getSha256(retryToken),
			contextTtlSeconds: config.inviteContextTtlSeconds,
		});
		reply.setCookie(getOAuthTransactionCookieName(transactionId), transactionId, getCookieOptions({
			isSecure: config.isSecure,
			maxAge: config.oauthStateTtlSeconds,
		}));
		// Preserve one legacy correlation cookie for in-flight pre-r9 starts. New callbacks use
		// the transaction-specific cookie selected by the transaction id embedded in state.
		reply.setCookie(OAUTH_COOKIE, transactionId, getCookieOptions({
			isSecure: config.isSecure,
			maxAge: config.oauthStateTtlSeconds,
		}));
		metrics.observeAuth?.({provider: provider.slug, outcome: "invite_started"});
		return reply.code(201).send({authorizationUrl, retryToken});
	});

	app.post("/api/auth/invite-contexts/retry", {
		config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
		schema: {
			body: {
				type: "object",
				required: ["retryToken", "provider", "returnTo"],
				additionalProperties: false,
				properties: {
					retryToken: {type: "string", minLength: 32, maxLength: 500},
					provider: {type: "string", minLength: 1, maxLength: 32},
					returnTo: {type: "string", minLength: 1, maxLength: 2_048},
				},
			},
		},
	}, async (request, reply) => {
		if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
		if (request.headers["x-hub-protocol-version"] !== HUB_PROTOCOL_VERSION) {
			return reply.code(426).send({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: HUB_PROTOCOL_VERSION});
		}
		const provider = providerRegistry.getAvailableProviders()
			.find(it => it.slug === request.body.provider);
		if (!provider) return reply.code(403).send({error: "INVITE_ADMISSION_INVALID"});
		const transactionId = crypto.randomUUID();
		const state = getOAuthState(transactionId);
		const pkceVerifier = provider.capabilities.pkce ? getRandomToken(48) : null;
		const oidcNonce = provider.capabilities.oidcNonce ? getRandomToken() : null;
		const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
		const returnTo = getSafeInviteReturnTo({
			rawReturnTo: request.body.returnTo,
			appOrigin: config.appOrigin,
		});
		const authorizationUrl = provider.getAuthorizationUrl({
			state,
			codeChallenge: pkceVerifier == null ? null : getPkceChallenge(pkceVerifier),
			nonce: oidcNonce,
			redirectUri,
		});
		const retryToken = getRandomToken();
		const retried = await store.pRetryInviteOAuthTransaction({
			transaction: {
				id: transactionId,
				stateHash: getSha256(state),
				provider: provider.slug,
				operation: "sign_in",
				redirectUri,
				returnTo,
				pkceVerifier,
				oidcNonce,
				ttlSeconds: config.oauthStateTtlSeconds,
			},
			retryTokenHash: getSha256(request.body.retryToken),
			nextRetryTokenHash: getSha256(retryToken),
			contextTtlSeconds: config.inviteContextTtlSeconds,
			browserTransactionIds: getOAuthTransactionCookieIds(request),
		});
		reply.clearCookie(getOAuthTransactionCookieName(retried.replacedTransactionId), getClearCookieOptions({isSecure: config.isSecure}));
		reply.setCookie(getOAuthTransactionCookieName(transactionId), transactionId, getCookieOptions({
			isSecure: config.isSecure,
			maxAge: config.oauthStateTtlSeconds,
		}));
		reply.setCookie(OAUTH_COOKIE, transactionId, getCookieOptions({
			isSecure: config.isSecure,
			maxAge: config.oauthStateTtlSeconds,
		}));
		metrics.observeAuth?.({provider: provider.slug, outcome: "invite_restarted"});
		return reply.code(201).send({authorizationUrl, retryToken});
	});

	app.get("/ws/campaign/:campaignId", {
		websocket: true,
		preValidation: requireWebSocketMembership,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			querystring: {
				type: "object",
				required: ["v"],
				additionalProperties: false,
				properties: {v: {type: "string", enum: [...SUPPORTED_HUB_PROTOCOL_VERSIONS]}},
			},
		},
	}, (socket, request) => {
		realtime.addConnection({
			socket,
			account: request.hubAuth.account,
			session: request.hubAuth.session,
			membership: request.hubMembership,
			campaignId: request.params.campaignId,
			protocolVersion: request.query.v,
			clientIp: request.hubClientIp,
		});
	});

	const pCompleteProviderSession = async ({request, reply, provider, transaction, identity, clearTransactionCookies, redirectStatus = 302}) => {
		const priorAuth = await pGetAuth(request);
		const token = transaction.operation === "link"
			? getDeterministicToken({
				secret: config.cookieSecret,
				namespace: "hub-identity-link-session",
				parts: [transaction.id],
			})
			: getRandomToken();
		let completed;
		try {
			if (transaction.operation === "reauthenticate") {
				completed = await store.pCompleteOAuthReauthentication({
					identity,
					tokenHash: getSha256(token),
					expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
					userAgent: request.headers["user-agent"] || null,
					currentSessionId: priorAuth?.session.id || null,
					oauthTransactionId: transaction.id,
				});
			} else if (transaction.operation === "sign_in") {
				completed = await store.pCompleteOAuthSignIn({
					identity,
					tokenHash: getSha256(token),
					expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
					userAgent: request.headers["user-agent"] || null,
					priorSessionId: priorAuth?.session.id || null,
					oauthTransactionId: transaction.id,
					isNewAccountAdmissionEnabled: config.isInviteAccountAdmissionEnabled,
				});
			} else if (transaction.operation === "link") {
				completed = await store.pCompleteOAuthLink({
					identity,
					tokenHash: getSha256(token),
					expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
					userAgent: request.headers["user-agent"] || null,
					currentAccountId: priorAuth?.account.id || null,
					currentSessionId: priorAuth?.session.id || null,
					oauthTransactionId: transaction.id,
					availableProviders: providerRegistry.getAvailableProviders().map(current => current.slug),
				});
			} else {
				throw new HubStoreError("INVALID_OAUTH_STATE", `OAuth transaction is invalid.`, {status: 400});
			}
		} catch (error) {
			if ([
				"INVITE_ADMISSION_REQUIRED",
				"INVITE_ADMISSION_INVALID",
				"ACCOUNT_UNAVAILABLE",
				"IDENTITY_ALREADY_LINKED",
				"INVALID_OAUTH_STATE",
				"REAUTHENTICATION_REQUIRED",
			].includes(error?.code)) {
				clearTransactionCookies();
			}
			if (["INVITE_ADMISSION_REQUIRED", "INVITE_ADMISSION_INVALID", "INVITE_ADMISSION_UNAVAILABLE"].includes(error?.code)) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "not_allowed"});
			}
			if (error?.code === "IDENTITY_ALREADY_LINKED") {
				metrics.observeAuth?.({provider: provider.slug, outcome: "already_linked"});
			}
			throw error;
		}
		clearTransactionCookies();
		completed.revokedSessionIds.forEach(sessionId => realtime.closeSession({sessionId}));
		reply.setCookie(SESSION_COOKIE, token, getCookieOptions({
			isSecure: config.isSecure,
			maxAge: config.sessionTtlSeconds,
		}));
		metrics.observeAuth?.({
			provider: provider.slug,
			outcome: transaction.operation === "link" ? "linked" : "succeeded",
		});
		return reply.code(redirectStatus).redirect(transaction.returnTo);
	};

	for (const provider of providerRegistry.getAvailableProviders()) {
		app.post(`/api/account/reauthentication/${provider.slug}`, {
			preHandler: [requireMutationSecurity, requireCurrentProtocolVersion],
			config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
			schema: {
				body: {
					type: "object",
					additionalProperties: false,
					properties: {returnTo: {type: "string", minLength: 1, maxLength: 2_048}},
				},
			},
		}, async (request, reply) => {
			const transactionId = crypto.randomUUID();
			const state = getOAuthState(transactionId);
			const pkceVerifier = provider.capabilities.pkce ? getRandomToken(48) : null;
			const oidcNonce = provider.capabilities.oidcNonce ? getRandomToken() : null;
			const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
			const returnTo = getSafeReturnTo({
				rawReturnTo: request.body?.returnTo,
				appOrigin: config.appOrigin,
			});
			const authorizationUrl = provider.getAuthorizationUrl({
				state,
				codeChallenge: pkceVerifier == null ? null : getPkceChallenge(pkceVerifier),
				nonce: oidcNonce,
				redirectUri,
			});
			await store.pCreateOAuthTransaction({
				id: transactionId,
				stateHash: getSha256(state),
				provider: provider.slug,
				operation: "reauthenticate",
				initiatingAccountId: request.hubAuth.account.id,
				initiatingSessionId: request.hubAuth.session.id,
				redirectUri,
				returnTo,
				pkceVerifier,
				oidcNonce,
				ttlSeconds: config.oauthStateTtlSeconds,
			});
			reply.setCookie(getOAuthTransactionCookieName(transactionId), transactionId, getCookieOptions({
				isSecure: config.isSecure,
				maxAge: config.oauthStateTtlSeconds,
			}));
			metrics.observeAuth?.({provider: provider.slug, outcome: "reauthentication_started"});
			return reply.code(201).send({authorizationUrl});
		});

		app.get(provider.startPath, {
			config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
			schema: {
				querystring: {
					type: "object",
					additionalProperties: false,
					properties: {returnTo: {type: "string", minLength: 1, maxLength: 2_048}},
				},
			},
		}, async (request, reply) => {
			const transactionId = crypto.randomUUID();
			const state = getOAuthState(transactionId);
			const pkceVerifier = provider.capabilities.pkce ? getRandomToken(48) : null;
			const oidcNonce = provider.capabilities.oidcNonce ? getRandomToken() : null;
			const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
			const returnTo = getSafeReturnTo({
				rawReturnTo: request.query?.returnTo,
				appOrigin: config.appOrigin,
			});
			const authorizationUrl = provider.getAuthorizationUrl({
				state,
				codeChallenge: pkceVerifier == null ? null : getPkceChallenge(pkceVerifier),
				nonce: oidcNonce,
				redirectUri,
			});
			await store.pCreateOAuthTransaction({
				id: transactionId,
				stateHash: getSha256(state),
				provider: provider.slug,
				operation: "sign_in",
				redirectUri,
				returnTo,
				pkceVerifier,
				oidcNonce,
				ttlSeconds: config.oauthStateTtlSeconds,
			});
			reply.setCookie(getOAuthTransactionCookieName(transactionId), transactionId, getCookieOptions({
				isSecure: config.isSecure,
				maxAge: config.oauthStateTtlSeconds,
			}));
			reply.setCookie(OAUTH_COOKIE, transactionId, getCookieOptions({
				isSecure: config.isSecure,
				maxAge: config.oauthStateTtlSeconds,
			}));
			metrics.observeAuth?.({provider: provider.slug, outcome: "started"});
			return reply.redirect(authorizationUrl);
		});

		if (provider.authenticationType === "password") {
			const getLoginState = request => {
				const state = request.method === "POST" ? request.body?.state : request.query?.state;
				const id = getOAuthTransactionIdFromState(state);
				if (!id || getSignedCookie(request, getOAuthTransactionCookieName(id)) !== id) {
					throw new HubStoreError("INVALID_OAUTH_STATE", "Login expired. Start again from the Campaign Hub.", {status: 400});
				}
				return {state, id};
			};
			app.get("/auth/local/login", {config: {rateLimit: {max: 20, timeWindow: "1 minute"}}}, async (request, reply) => {
				const {state} = getLoginState(request);
				return reply.type("text/html; charset=utf-8").send(getLocalLoginHtml({state}));
			});
			app.post(provider.callbackPath, {
				bodyLimit: 8_192,
				config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
				schema: {body: {
					type: "object",
					additionalProperties: false,
					required: ["username", "password", "state"],
					properties: {
						username: {type: "string", minLength: 1, maxLength: 64},
						password: {type: "string", minLength: 1, maxLength: 256},
						state: {type: "string", minLength: 1, maxLength: 512},
					},
				}},
			}, async (request, reply) => {
				if (request.headers.origin !== config.appOrigin) return reply.code(403).send({error: "INVALID_ORIGIN"});
				const {state, id} = getLoginState(request);
				const identity = await provider.pVerifyCredentials(request.body);
				if (!identity) {
					metrics.observeAuth?.({provider: provider.slug, outcome: "invalid_credentials"});
					return reply.code(401).type("text/html; charset=utf-8").send(getLocalLoginHtml({state, isError: true}));
				}
				const transaction = await store.pConsumeOAuthTransaction({
					id,
					stateHash: getSha256(state),
					provider: provider.slug,
					operation: null,
					redirectUri: `${config.appOrigin}${provider.callbackPath}`,
				});
				const clearTransactionCookies = () => {
					reply.clearCookie(getOAuthTransactionCookieName(id), getClearCookieOptions({isSecure: config.isSecure}));
					if (getSignedCookie(request, OAUTH_COOKIE) === id) reply.clearCookie(OAUTH_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
				};
				return pCompleteProviderSession({request, reply, provider, transaction, identity, clearTransactionCookies, redirectStatus: 303});
			});
			continue;
		}

		app.get(provider.callbackPath, {
			config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
			schema: {
				querystring: {
					type: "object",
					additionalProperties: true,
					properties: {
						code: {type: "string", minLength: 1, maxLength: 2_048},
						state: {type: "string", minLength: 1, maxLength: 512},
						error: {type: "string", maxLength: 200},
					},
				},
			},
		}, async (request, reply) => {
			const stateTransactionId = getOAuthTransactionIdFromState(request.query?.state);
			const legacyTransactionCookie = getSignedCookie(request, OAUTH_COOKIE);
			const transactionId = stateTransactionId || legacyTransactionCookie;
			const transactionCookie = transactionId == null
				? null
				: getSignedCookie(request, getOAuthTransactionCookieName(transactionId));
			if (
				!transactionId
				|| (transactionCookie !== transactionId && legacyTransactionCookie !== transactionId)
			) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "invalid_state"});
				return reply.code(400).send({error: "INVALID_OAUTH_STATE"});
			}
			const clearTransactionCookies = () => {
				reply.clearCookie(getOAuthTransactionCookieName(transactionId), getClearCookieOptions({isSecure: config.isSecure}));
				if (legacyTransactionCookie === transactionId) {
					reply.clearCookie(OAUTH_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
				}
			};
			const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
			let transaction;
			try {
				transaction = await store.pConsumeOAuthTransaction({
					id: transactionId,
					stateHash: getSha256(request.query.state),
					provider: provider.slug,
					operation: null,
					redirectUri,
				});
			} catch (error) {
				const isDeterministicLinkState = isConstantTimeEqual(
					request.query?.state,
					getOAuthLinkState({transactionId, secret: config.csrfSecret}),
				);
				const recovered = (
					error?.code === "INVALID_OAUTH_STATE"
					&& config.isAccountIdentityLinkingEnabled
					&& isDeterministicLinkState
				)
					? await store.pGetCompletedOAuthLink?.({
						oauthTransactionId: transactionId,
						provider: provider.slug,
						redirectUri,
					})
					: null;
				if (recovered) {
					const token = getDeterministicToken({
						secret: config.cookieSecret,
						namespace: "hub-identity-link-session",
						parts: [transactionId],
					});
					clearTransactionCookies();
					recovered.revokedSessionIds.forEach(sessionId => realtime.closeSession({sessionId}));
					reply.setCookie(SESSION_COOKIE, token, getCookieOptions({
						isSecure: config.isSecure,
						maxAge: config.sessionTtlSeconds,
					}));
					metrics.observeAuth?.({provider: provider.slug, outcome: "link_recovered"});
					return reply.redirect(recovered.returnTo);
				}
				clearTransactionCookies();
				metrics.observeAuth?.({provider: provider.slug, outcome: "invalid_state"});
				throw error;
			}
			if (transaction.operation === "link" && !config.isAccountIdentityLinkingEnabled) {
				clearTransactionCookies();
				metrics.observeAuth?.({provider: provider.slug, outcome: "link_disabled"});
				return reply.code(403).send({error: "AUTH_PROVIDER_UNAVAILABLE"});
			}
			if (typeof request.query.code !== "string" || request.query.error) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "provider_cancelled"});
				return reply.code(400).send({error: "INVALID_OAUTH_STATE"});
			}

			let identity;
			try {
				identity = await provider.pExchangeCodeForIdentity({
					code: request.query.code,
					codeVerifier: transaction.pkceVerifier,
					nonce: transaction.oidcNonce,
					redirectUri,
				});
			} catch (error) {
				metrics.observeAuth?.({provider: provider.slug, outcome: "provider_error"});
				if (error instanceof AuthProviderError) throw error;
				throw new AuthProviderError();
			}
			return pCompleteProviderSession({request, reply, provider, transaction, identity, clearTransactionCookies});
		});
	}

	app.get("/api/session", async request => {
		const auth = await pGetAuth(request);
		if (!auth) return {signedIn: false};
		const entitlements = config.isAccountEntitlementsEnabled
			? await store.pGetOwnEntitlements({accountId: auth.account.id})
			: [];
		const linkedProviders = new Set(
			(await store.pListExternalIdentities({accountId: auth.account.id}))
				.map(identity => identity.provider),
		);
		const reauthenticationProviders = providerRegistry.getPublicMetadata()
			.filter(provider => provider.status === "available" && linkedProviders.has(provider.slug))
			.map(provider => provider.slug);
		return {
			signedIn: true,
			account: {
				id: auth.account.id,
				displayName: auth.account.displayName,
				status: auth.account.status,
				deletionRequestedAt: auth.account.deletionRequestedAt,
				purgeAfter: auth.account.purgeAfter,
			},
			entitlements,
			reauthenticationProviders,
			csrfToken: getCsrfToken({csrfSecret: config.csrfSecret, sessionId: auth.session.id}),
			capabilities: [
				HUB_CAPABILITY_ROLL_HISTORY,
				ACTIVE_CAMPAIGN_CONTEXT_CAPABILITY,
				...(config.isAccountEntitlementsEnabled ? [ACCOUNT_ENTITLEMENTS_CAPABILITY] : []),
				...(config.isAccountIdentityLinkingEnabled ? [ACCOUNT_IDENTITY_LINKING_CAPABILITY] : []),
			],
		};
	});

	if (config.isAccountIdentityLinkingEnabled) {
		const providerMetadata = new Map(
			providerRegistry.getPublicMetadata().map(provider => [provider.slug, provider]),
		);
		const pGetPublicIdentities = async (auth, {identities: suppliedIdentities = null} = {}) => {
			const identities = suppliedIdentities
				|| await store.pListExternalIdentities({accountId: auth.account.id});
			const availableProviders = providerRegistry.getAvailableProviders().map(provider => provider.slug);
			return identities.map(identity => getPublicExternalIdentity({
				identity,
				accountStatus: auth.account.status,
				identities,
				currentSessionIdentityId: auth.session.authenticatedViaIdentityId,
				providerStatus: providerMetadata.get(identity.provider)?.status || "disabled",
				retentionRequiredProviders: config.identityRetentionRequiredProviders,
				availableProviders,
			}));
		};

		app.get("/api/account/identities", {
			preHandler: [requireAuth, requireCurrentProtocolVersion],
		}, async request => ({
			identities: await pGetPublicIdentities(request.hubAuth),
		}));

		app.post("/api/account/identities/:provider/link-intents", {
			preHandler: [requireMutationSecurity, requireCurrentProtocolVersion],
			config: {rateLimit: {max: 5, timeWindow: "1 minute"}},
			schema: {
				params: {
					type: "object",
					required: ["provider"],
					additionalProperties: false,
					properties: {provider: {type: "string", minLength: 1, maxLength: 32}},
				},
				body: {
					type: "object",
					additionalProperties: false,
					properties: {returnTo: {type: "string", minLength: 1, maxLength: 2_048}},
				},
			},
		}, async (request, reply) => {
			const provider = providerRegistry.getAvailableProviders()
				.find(current => current.slug === request.params.provider);
			if (!provider) return reply.code(404).send({error: "NOT_FOUND"});
			const transactionId = crypto.randomUUID();
			const state = getOAuthLinkState({transactionId, secret: config.csrfSecret});
			const pkceVerifier = provider.capabilities.pkce ? getRandomToken(48) : null;
			const oidcNonce = provider.capabilities.oidcNonce ? getRandomToken() : null;
			const redirectUri = `${config.appOrigin}${provider.callbackPath}`;
			const returnTo = getSafeReturnTo({
				rawReturnTo: request.body?.returnTo,
				appOrigin: config.appOrigin,
			});
			const created = await store.pCreateOAuthLinkTransaction({
				accountId: request.hubAuth.account.id,
				sessionId: request.hubAuth.session.id,
				transaction: {
					id: transactionId,
					stateHash: getSha256(state),
					provider: provider.slug,
					redirectUri,
					returnTo,
					pkceVerifier,
					oidcNonce,
					expiresAt: new Date(Date.now() + ACCOUNT_IDENTITY_LINK_TTL_SECONDS * 1_000),
				},
				idempotencyKey: getIdempotencyKey(request),
			});
			const replayState = getOAuthLinkState({
				transactionId: created.transaction.id,
				secret: config.csrfSecret,
			});
			const authorizationUrl = provider.getAuthorizationUrl({
				state: replayState,
				codeChallenge: created.transaction.pkceVerifier == null
					? null
					: getPkceChallenge(created.transaction.pkceVerifier),
				nonce: created.transaction.oidcNonce,
				redirectUri: created.transaction.redirectUri,
			});
			reply.setCookie(
				getOAuthTransactionCookieName(created.transaction.id),
				created.transaction.id,
				getCookieOptions({
					isSecure: config.isSecure,
					maxAge: ACCOUNT_IDENTITY_LINK_TTL_SECONDS,
				}),
			);
			metrics.observeAuth?.({provider: provider.slug, outcome: "link_started"});
			return reply.code(201).send({authorizationUrl});
		});

		app.delete("/api/account/identities/:identityId", {
			preHandler: [requireIdentityMutationSecurity, requireCurrentProtocolVersion],
			config: {rateLimit: {max: 5, timeWindow: "1 minute"}},
			schema: {
				params: {
					type: "object",
					required: ["identityId"],
					additionalProperties: false,
					properties: {identityId: {type: "string", format: "uuid"}},
				},
			},
		}, async (request, reply) => {
			const idempotencyKey = getIdempotencyKey(request);
			const token = getDeterministicToken({
				secret: config.cookieSecret,
				namespace: "hub-identity-unlink-session",
				parts: [request.hubAuth.account.id, idempotencyKey.key],
			});
			const completed = await store.pUnlinkExternalIdentity({
				accountId: request.hubAuth.account.id,
				currentSessionId: request.hubAuth.session.id,
				identityId: request.params.identityId,
				tokenHash: getSha256(token),
				expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
				userAgent: request.headers["user-agent"] || null,
				idempotencyKey,
				retentionRequiredProviders: config.identityRetentionRequiredProviders,
				availableProviders: providerRegistry.getAvailableProviders().map(provider => provider.slug),
			});
			completed.revokedSessionIds.forEach(sessionId => realtime.closeSession({sessionId}));
			metrics.observeAuth?.({provider: completed.unlinkedProvider, outcome: "unlinked"});
			reply.setCookie(SESSION_COOKIE, token, getCookieOptions({
				isSecure: config.isSecure,
				maxAge: config.sessionTtlSeconds,
			}));
			return {
				ok: true,
				unlinkedIdentityId: completed.unlinkedIdentityId,
				csrfToken: getCsrfToken({
					csrfSecret: config.csrfSecret,
					sessionId: completed.session.id,
				}),
				identities: await pGetPublicIdentities({
					account: request.hubAuth.account,
					session: completed.session,
				}, {
					identities: completed.identities,
				}),
				otherDevicesSignedOut: completed.otherDevicesSignedOut,
			};
		});
	}

	if (config.isAccountEntitlementsEnabled) {
		const entitlementParamsSchema = {
			type: "object",
			required: ["accountId", "entitlement"],
			additionalProperties: false,
			properties: {
				accountId: {type: "string", format: "uuid"},
				entitlement: {type: "string", minLength: 1, maxLength: 50},
			},
		};
		app.get("/api/operator/accounts", {
			preHandler: [requireProtocolVersion, requireCurrentProtocolVersion],
		}, async request => ({
			accounts: await store.pListOperatorAccounts({
				accountId: request.hubAuth.account.id,
				sessionId: request.hubAuth.session.id,
			}),
		}));
		app.post("/api/operator/accounts/:accountId/entitlements/:entitlement/grant", {
			preHandler: [requireMutationSecurity, requireCurrentProtocolVersion],
			schema: {params: entitlementParamsSchema},
		}, async request => store.pGrantAccountEntitlement({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			targetAccountId: request.params.accountId,
			entitlementName: request.params.entitlement,
			idempotencyKey: getIdempotencyKey(request),
		}));
		app.post("/api/operator/accounts/:accountId/entitlements/:entitlement/revoke", {
			preHandler: [requireMutationSecurity, requireCurrentProtocolVersion],
			schema: {params: entitlementParamsSchema},
		}, async request => store.pRevokeAccountEntitlement({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			targetAccountId: request.params.accountId,
			entitlementName: request.params.entitlement,
			idempotencyKey: getIdempotencyKey(request),
		}));
	}

	app.get("/api/account/export", {preHandler: requireAuth}, async (request, reply) => {
		const exported = await store.pExportAccountData({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
		});
		reply.header("cache-control", "no-store");
		reply.header("content-disposition", `attachment; filename="campaign-hub-export.json"`);
		return exported;
	});

	app.get("/api/account/sessions", {preHandler: requireAuth}, async request => ({
		sessions: await store.pListSessions({
			accountId: request.hubAuth.account.id,
			currentSessionId: request.hubAuth.session.id,
		}),
	}));

	app.post("/api/account/sessions/:sessionId/revoke", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["sessionId"],
				additionalProperties: false,
				properties: {sessionId: {type: "string", format: "uuid"}},
			},
		},
	}, async (request, reply) => {
		const response = await store.pRevokeAccountSession({
			accountId: request.hubAuth.account.id,
			sessionId: request.params.sessionId,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeSession({sessionId: request.params.sessionId});
		if (request.params.sessionId === request.hubAuth.session.id) reply.clearCookie(SESSION_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
		return response;
	});

	app.post("/api/account/sessions/revoke-others", {preHandler: requireMutationSecurity}, async request => {
		const response = await store.pRevokeOtherSessions({
			accountId: request.hubAuth.account.id,
			currentSessionId: request.hubAuth.session.id,
			idempotencyKey: getIdempotencyKey(request),
		});
		response.revokedSessionIds.forEach(sessionId => realtime.closeSession({sessionId}));
		return response;
	});

	app.get("/api/account/deletion", {preHandler: requireAuth}, async request => ({
		deletion: await store.pGetAccountDeletion({accountId: request.hubAuth.account.id}),
	}));

	app.post("/api/account/deletion/request", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["confirmation"],
				additionalProperties: false,
				properties: {confirmation: {type: "string", const: "DELETE"}},
			},
		},
	}, async (request, reply) => {
		const response = await store.pRequestAccountDeletion({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeAccount({accountId: request.hubAuth.account.id, reason: "Account deletion requested"});
		reply.clearCookie(SESSION_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
		return response;
	});

	app.post("/api/account/deletion/cancel", {preHandler: requireMutationSecurity}, async request => store.pCancelAccountDeletion({
		accountId: request.hubAuth.account.id,
		sessionId: request.hubAuth.session.id,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/logout", {preHandler: requireMutationSecurity}, async (request, reply) => {
		await store.pRevokeSession({sessionId: request.hubAuth.session.id});
		realtime.closeSession({sessionId: request.hubAuth.session.id});
		reply.clearCookie(SESSION_COOKIE, getClearCookieOptions({isSecure: config.isSecure}));
		return {ok: true};
	});

	app.get("/api/campaigns", {preHandler: requireAuth}, async request => ({
		campaigns: await store.pListCampaigns({accountId: request.hubAuth.account.id}),
	}));

	app.get("/api/campaigns/:campaignId", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				additionalProperties: false,
				required: ["campaignId"],
				properties: {
					campaignId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async (request, reply) => {
		const campaign = await store.pGetCampaign({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		});

		if (!campaign) return reply.code(404).send({error: "CAMPAIGN_NOT_FOUND"});
		return {campaign};
	});

	app.post("/api/campaigns/:campaignId/archive", {
		preHandler: requireMutationSecurity,
	}, async request => store.pArchiveCampaign({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/transfer-ownership", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["targetAccountId"],
				additionalProperties: false,
				properties: {targetAccountId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pTransferCampaignOwnership({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		targetAccountId: request.body.targetAccountId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.get("/api/campaigns/:campaignId/members", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				additionalProperties: false,
				required: ["campaignId"],
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		members: await store.pListMembers({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.patch("/api/campaigns/:campaignId/members/:membershipId", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "membershipId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					membershipId: {type: "string", format: "uuid"},
				},
			},
			body: {
				type: "object",
				required: ["role"],
				additionalProperties: false,
				properties: {role: {type: "string", enum: ["co_dm", "player", "spectator"]}},
			},
		},
	}, async request => store.pChangeMemberRole({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		membershipId: request.params.membershipId,
		role: request.body.role,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.delete("/api/campaigns/:campaignId/members/:membershipId", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "membershipId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					membershipId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => {
		const response = await store.pRemoveMember({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			membershipId: request.params.membershipId,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeAccount({accountId: response.removedAccountId, campaignId: request.params.campaignId, reason: "Membership removed"});
		return response;
	});

	app.post("/api/campaigns/:campaignId/leave", {preHandler: requireMutationSecurity}, async request => {
		const response = await store.pLeaveCampaign({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			idempotencyKey: getIdempotencyKey(request),
		});
		realtime.closeAccount({accountId: request.hubAuth.account.id, campaignId: request.params.campaignId, reason: "Membership left"});
		return response;
	});

	app.get("/api/campaigns/:campaignId/context", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => {
		const context = await store.pGetCampaignContext({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		});
		return {
			context: {
				...context,
				contentCatalog: await pGetCampaignContentCatalog({brewBundle: context.brewBundle}),
			},
		};
	});

	app.get("/api/campaigns/:campaignId/compatibility", {
		preHandler: requireAuth,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		compatibility: await store.pGetCampaignCompatibility({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/character-projections", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pListCampaignCharacterProjections({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
	}));

	app.get("/api/campaigns/:campaignId/snapshot", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		snapshot: await store.pGetCampaignSnapshot({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/events", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			querystring: {
				type: "object",
				additionalProperties: false,
				properties: {
					afterSequence: {type: "integer", minimum: 0},
					beforeSequence: {type: "integer", minimum: 1},
					limit: {type: "integer", minimum: 1, maximum: 500, default: 200},
				},
			},
		},
	}, async request => {
		if (request.query.afterSequence != null && request.query.beforeSequence != null) {
			throw new HubStoreError("INVALID_EVENT_CURSOR", "Only one event cursor may be supplied.", {status: 400});
		}
		if (request.headers["x-hub-protocol-version"] !== MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION) {
			const [capability, isProtocol6History] = await Promise.all([
				store.pGetMultiTargetOperationsCapability?.({
					accountId: request.hubAuth.account.id,
					campaignId: request.params.campaignId,
				}),
				store.pCampaignRequiresProtocol6?.({campaignId: request.params.campaignId}),
			]);
			if (capability?.enabled || isProtocol6History) {
				throw new HubStoreError("PROTOCOL_UPDATE_REQUIRED", `Hub protocol 6 is required.`, {status: 426});
			}
		}
		return store.pListVisibleEventPage({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			afterSequence: request.query.afterSequence,
			beforeSequence: request.query.beforeSequence,
			limit: request.query.limit,
		});
	});

	app.get("/api/campaigns/:campaignId/characters/:characterId/roll-history", {
		preValidation: async (request, reply) => {
			const query = new URL(request.url, config.appOrigin).searchParams;
			if ([...query.keys()].some(key => !["beforeSequence", "commandId", "limit"].includes(key))) {
				return reply.code(400).send({error: "INVALID_ROLL_HISTORY_CURSOR"});
			}
		},
		preHandler: [requireProtocolVersion, requireCurrentProtocolVersion],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "characterId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}, characterId: {type: "string", format: "uuid"}},
			},
			querystring: {
				type: "object",
				additionalProperties: false,
				properties: {
					beforeSequence: {type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER},
					commandId: {type: "string", format: "uuid"},
					limit: {type: "integer", minimum: 1, maximum: 200, default: 200},
				},
			},
		},
	}, async request => store.pListCharacterRollHistory({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		characterId: request.params.characterId,
		...request.query,
	}));

	app.post("/api/campaigns/:campaignId/rolls", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["formula", "total", "visibility"],
				additionalProperties: false,
				properties: {
					characterId: {type: ["string", "null"], format: "uuid"},
					formula: {type: "string", minLength: 1, maxLength: 200},
					total: {type: "number"},
					context: {type: "string", maxLength: 100},
					visibility: {type: "string", enum: ["all_members", "dm_only", "actor_and_dm"]},
					detail: {type: "object"},
				},
			},
		},
	}, async request => store.pLogRoll({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		characterId: request.body.characterId || null,
		visibility: request.body.visibility,
		payload: {
			formula: request.body.formula,
			total: request.body.total,
			context: request.body.context || null,
			detail: request.body.detail || {},
		},
		idempotencyKey: getIdempotencyKey(request),
	}));

	const multiTargetParamsSchema = {
		type: "object",
		required: ["campaignId"],
		additionalProperties: false,
		properties: {campaignId: {type: "string", format: "uuid"}},
	};
	const multiTargetOperationParamsSchema = {
		type: "object",
		required: ["campaignId", "operationId"],
		additionalProperties: false,
		properties: {
			campaignId: {type: "string", format: "uuid"},
			operationId: {type: "string", format: "uuid"},
		},
	};
	const multiTargetReadQuerySchema = {
		type: "object",
		additionalProperties: false,
		properties: {
			cursor: {type: "string", minLength: 1, maxLength: 1_000},
			limit: {type: "integer", minimum: 1, maximum: 100, default: 100},
			mode: {type: "string", enum: ["pending", "recovery"], default: "pending"},
		},
	};

	app.post("/api/campaigns/:campaignId/multi-target-operations", {
		preHandler: requireMultiTargetMutation({accountLimit: 10, campaignLimit: 30}),
		schema: {
			params: multiTargetParamsSchema,
			body: {
				type: "object",
				required: [
					"contractVersion",
					"commandId",
					"sourceCharacterId",
					"sourceEntity",
					"effectTemplateId",
					"choice",
					"targetRefs",
					"rulesVersionId",
				],
				additionalProperties: false,
				properties: {
					contractVersion: {type: "integer", const: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION},
					commandId: {type: "string", format: "uuid"},
					sourceCharacterId: {type: "string", format: "uuid"},
					sourceEntity: {
						type: "object",
						required: ["type", "uid", "version"],
						additionalProperties: false,
						properties: {
							type: {type: "string", enum: ["spell", "ability"]},
							uid: {type: "string", minLength: 1, maxLength: 200},
							version: {type: "string", minLength: 1, maxLength: 80},
						},
					},
					effectTemplateId: {type: "string", minLength: 1, maxLength: 120},
					choice: {
						type: "object",
						additionalProperties: false,
						maxProperties: 10,
						properties: {
							amount: {type: "integer", minimum: 1, maximum: 100},
							castLevel: {type: "integer", minimum: 1, maximum: 9},
						},
					},
					targetRefs: {
						type: "array",
						minItems: 1,
						maxItems: MULTI_TARGET_OPERATIONS_MAX_TARGETS,
						items: {type: "string", format: "uuid"},
					},
					rulesVersionId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async (request, reply) => {
		const command = getSemanticCommand(request);
		const response = await store.pCreateMultiTargetOperation({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			...request.body,
			protocolVersion: request.headers["x-hub-protocol-version"],
			...command,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
		return reply.code(201).send(response);
	});

	app.post("/api/campaigns/:campaignId/multi-target-operations/:operationId/invitations/:invitationId/respond", {
		preHandler: requireMultiTargetMutation({accountLimit: 30, campaignLimit: 120}),
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "operationId", "invitationId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					operationId: {type: "string", format: "uuid"},
					invitationId: {type: "string", format: "uuid"},
				},
			},
			body: {
				type: "object",
				required: ["contractVersion", "commandId", "decision"],
				additionalProperties: false,
				properties: {
					contractVersion: {type: "integer", const: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION},
					commandId: {type: "string", format: "uuid"},
					decision: {type: "string", enum: ["approve", "reject"]},
				},
			},
		},
	}, async request => {
		const command = getSemanticCommand(request);
		return store.pRespondMultiTargetInvitation({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			operationId: request.params.operationId,
			invitationId: request.params.invitationId,
			decision: request.body.decision,
			contractVersion: request.body.contractVersion,
			protocolVersion: request.headers["x-hub-protocol-version"],
			...command,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
	});

	app.post("/api/campaigns/:campaignId/multi-target-operations/:operationId/finalize", {
		preHandler: requireMultiTargetMutation({accountLimit: 20, campaignLimit: 60}),
		schema: {
			params: multiTargetOperationParamsSchema,
			body: {
				type: "object",
				required: ["contractVersion", "commandId", "selectedInvitationIds"],
				additionalProperties: false,
				properties: {
					contractVersion: {type: "integer", const: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION},
					commandId: {type: "string", format: "uuid"},
					selectedInvitationIds: {
						type: "array",
						maxItems: MULTI_TARGET_OPERATIONS_MAX_TARGETS,
						uniqueItems: true,
						items: {type: "string", format: "uuid"},
					},
				},
			},
		},
	}, async request => {
		const command = getSemanticCommand(request);
		return store.pFinalizeMultiTargetOperation({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			operationId: request.params.operationId,
			selectedInvitationIds: request.body.selectedInvitationIds,
			contractVersion: request.body.contractVersion,
			protocolVersion: request.headers["x-hub-protocol-version"],
			...command,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
	});

	app.post("/api/campaigns/:campaignId/multi-target-operations/:operationId/cancel", {
		preHandler: requireMultiTargetMutation({accountLimit: 20, campaignLimit: 60}),
		schema: {
			params: multiTargetOperationParamsSchema,
			body: {
				type: "object",
				required: ["contractVersion", "commandId"],
				additionalProperties: false,
				properties: {
					contractVersion: {type: "integer", const: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION},
					commandId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => {
		const command = getSemanticCommand(request);
		return store.pCancelMultiTargetOperation({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			operationId: request.params.operationId,
			contractVersion: request.body.contractVersion,
			protocolVersion: request.headers["x-hub-protocol-version"],
			...command,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
	});

	app.get("/api/campaigns/:campaignId/multi-target-operations/inbox", {
		preHandler: requireMultiTargetProtocol,
		schema: {params: multiTargetParamsSchema, querystring: multiTargetReadQuerySchema},
	}, async request => store.pListMultiTargetInbox({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		cursor: request.query.cursor,
		limit: request.query.limit,
		mode: request.query.mode,
	}));

	app.get("/api/campaigns/:campaignId/multi-target-operations/outgoing", {
		preHandler: requireMultiTargetProtocol,
		schema: {params: multiTargetParamsSchema, querystring: multiTargetReadQuerySchema},
	}, async request => store.pListMultiTargetOutgoing({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		cursor: request.query.cursor,
		limit: request.query.limit,
	}));

	app.get("/api/campaigns/:campaignId/multi-target-operations/:operationId", {
		preHandler: requireMultiTargetProtocol,
		schema: {params: multiTargetOperationParamsSchema},
	}, async request => store.pGetMultiTargetOperation({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		operationId: request.params.operationId,
	}));

	app.get("/api/campaigns/:campaignId/actions", {
		preHandler: requireProtocolVersion,
	}, async request => {
		const actions = await store.pListPendingActions({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		});
		return {
			actions: getProtocolCompatiblePendingActions({
				actions,
				protocolVersion: request.headers["x-hub-protocol-version"],
			}),
		};
	});

	app.get("/api/campaigns/:campaignId/characters/:characterId/pending-actions", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "characterId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					characterId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => {
		const actions = await store.pListCharacterPendingActions({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			characterId: request.params.characterId,
		});
		return {
			actions: getProtocolCompatiblePendingActions({
				actions,
				protocolVersion: request.headers["x-hub-protocol-version"],
			}),
		};
	});

	app.get("/api/campaigns/:campaignId/characters/:characterId/outgoing-actions", {
		preHandler: requirePeerSourceCostsProtocol,
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "characterId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					characterId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async (request, reply) => {
		reply.header("Cache-Control", "no-store");
		return {
			actions: await store.pListCharacterOutgoingActions({
				accountId: request.hubAuth.account.id,
				campaignId: request.params.campaignId,
				characterId: request.params.characterId,
			}),
		};
	});

	app.post("/api/campaigns/:campaignId/actions", {
		preValidation: rejectUnknownSemanticActionFields,
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				additionalProperties: false,
				properties: {
					contractVersion: {type: "integer", const: 1},
					commandId: {type: "string", format: "uuid"},
					targetCharacterId: {type: "string", format: "uuid"},
					operation: {
						type: "object",
						required: ["kind", "version", "arguments"],
						additionalProperties: false,
						properties: {
							kind: {type: "string", enum: ["hp.damage", "hp.heal", "condition.add", "condition.remove", "spell_slot.spend", "spell_slot.restore"]},
							version: {type: "integer", const: 1},
							arguments: {
								type: "object",
								additionalProperties: false,
								properties: {
									amount: {type: "number", exclusiveMinimum: 0},
									condition: {
										type: "object",
										required: ["name", "source"],
										additionalProperties: false,
										properties: {
											name: {type: "string", minLength: 1, maxLength: 100},
											source: {type: "string", minLength: 1, maxLength: 30},
										},
									},
									level: {type: "integer", minimum: 1, maximum: 9},
								},
							},
						},
					},
					sourceCharacterId: {type: "string", format: "uuid"},
					sourceEntity: {
						type: "object",
						required: ["type", "uid", "version"],
						additionalProperties: false,
						properties: {
							type: {type: "string", enum: ["spell", "ability"]},
							uid: {type: "string", minLength: 1, maxLength: 200},
							version: {type: "string", minLength: 1, maxLength: 80},
						},
					},
					effectTemplateId: {type: "string", minLength: 1, maxLength: 100},
					choice: {
						type: "object",
						additionalProperties: false,
						maxProperties: 10,
						properties: {
							amount: {type: "integer", minimum: 1, maximum: 100},
							castLevel: {type: "integer", minimum: 1, maximum: 9},
						},
					},
					targetRef: {type: "string", format: "uuid"},
					rulesVersionId: {type: "string", format: "uuid"},
				},
				oneOf: [
					{
						required: ["commandId", "targetCharacterId", "operation"],
						not: {required: ["contractVersion"]},
					},
					{
						required: ["commandId", "sourceCharacterId", "sourceEntity", "effectTemplateId", "choice", "targetRef"],
						not: {required: ["contractVersion"]},
					},
					{
						required: [
							"contractVersion",
							"commandId",
							"sourceCharacterId",
							"sourceEntity",
							"effectTemplateId",
							"choice",
							"targetRef",
							"rulesVersionId",
						],
					},
				],
			},
		},
	}, async (request, reply) => {
		reply.header("Cache-Control", "no-store");
		const command = getSemanticCommand(request);
		const created = await store.pCreateStructuredAction({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			targetCharacterId: request.body.targetCharacterId,
			operation: request.body.operation,
			sourceCharacterId: request.body.sourceCharacterId,
			sourceEntity: request.body.sourceEntity,
			effectTemplateId: request.body.effectTemplateId,
			choice: request.body.choice,
			targetRef: request.body.targetRef,
			contractVersion: request.body.contractVersion,
			rulesVersionId: request.body.rulesVersionId,
			protocolVersion: request.headers["x-hub-protocol-version"],
			commandId: command.commandId,
			requestHash: command.requestHash,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/actions/:actionId/resolve", {
		preValidation: rejectUnknownSemanticResolutionFields,
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["commandId", "decision"],
				additionalProperties: false,
				properties: {
					contractVersion: {type: "integer", const: 1},
					commandId: {type: "string", format: "uuid"},
					decision: {type: "string", enum: ["accept", "reject", "cancel"]},
				},
			},
		},
	}, async (request, reply) => {
		reply.header("Cache-Control", "no-store");
		const command = getSemanticCommand(request);
		return store.pResolveStructuredAction({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			actionId: request.params.actionId,
			decision: request.body.decision,
			contractVersion: request.body.contractVersion,
			protocolVersion: request.headers["x-hub-protocol-version"],
			...command,
			idempotencyKey: {key: command.commandId, requestHash: command.requestHash},
		});
	});

	app.post("/api/campaigns/:campaignId/characters/:characterId/xp-grants", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			body: {
				type: "object",
				required: ["amount"],
				additionalProperties: false,
				properties: {
					amount: {type: "integer", minimum: 1, maximum: 1000000},
					reason: {type: ["string", "null"], maxLength: 500},
				},
			},
		},
	}, async request => store.pGrantXp({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		characterId: request.params.characterId,
		amount: request.body.amount,
		reason: request.body.reason || null,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/characters/:characterId/item-grants", {
		preValidation: rejectUnknownLegacyItemGrantFields,
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			body: {
				type: "object",
				required: ["item"],
				additionalProperties: false,
				properties: {
					item: getSafeItemSummarySchema(),
					quantity: {type: "integer", minimum: 1, maximum: 100000, default: 1},
					rulesVersionId: {type: ["string", "null"], format: "uuid"},
				},
			},
		},
	}, async request => store.pGrantItem({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		characterId: request.params.characterId,
		item: request.body.item,
		quantity: request.body.quantity || 1,
		rulesVersionId: request.body.rulesVersionId || null,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/item-awards", {
		preValidation: rejectUnknownAwardFields,
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["source", "targetCharacterIds", "quantity"],
				additionalProperties: false,
				properties: {
					source: {
						oneOf: [
							{
								type: "object",
								required: ["kind", "item"],
								additionalProperties: false,
								properties: {
									kind: {type: "string", enum: ["catalog", "recent", "campaign_item"]},
									item: getSafeItemSummarySchema(),
								},
							},
							{
								type: "object",
								required: ["kind", "entryId"],
								additionalProperties: false,
								properties: {
									kind: {type: "string", const: "party_inventory"},
									entryId: {type: "string", minLength: 1, maxLength: 200},
								},
							},
						],
					},
					targetCharacterIds: {
						type: "array",
						minItems: 1,
						maxItems: 50,
						uniqueItems: true,
						items: {type: "string", format: "uuid"},
					},
					quantity: {type: "integer", minimum: 1, maximum: 100000},
					note: {type: ["string", "null"], maxLength: 500},
					rulesVersionId: {type: ["string", "null"], format: "uuid"},
				},
			},
		},
	}, async request => store.pAwardItems({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		source: request.body.source,
		targetCharacterIds: request.body.targetCharacterIds,
		quantity: request.body.quantity,
		note: request.body.note ?? null,
		rulesVersionId: request.body.rulesVersionId || null,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.get("/api/campaigns/:campaignId/party-inventory", {
		preHandler: requireAuth,
	}, async request => ({
		partyInventory: await store.pGetPartyInventory({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.get("/api/campaigns/:campaignId/transfers", {
		preHandler: requireAuth,
	}, async request => ({
		transfers: await store.pListTransfers({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.post("/api/campaigns/:campaignId/transfers", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["sourceKind", "sourceId", "targetKind", "targetId", "payload"],
				additionalProperties: false,
				properties: {
					sourceKind: {type: "string", enum: ["character", "party_inventory"]},
					sourceId: {type: "string", format: "uuid"},
					targetKind: {type: "string", enum: ["character", "party_inventory"]},
					targetId: {type: "string", format: "uuid"},
					rulesVersionId: {type: ["string", "null"], format: "uuid"},
					payload: {
						type: "object",
						additionalProperties: false,
						properties: {
							items: {
								type: "array",
								maxItems: 100,
								items: {
									type: "object",
									required: ["entryId", "quantity"],
									additionalProperties: false,
									properties: {
										entryId: {type: "string", minLength: 1, maxLength: 200},
										quantity: {type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER},
									},
								},
							},
							currency: {
								type: "object",
								additionalProperties: false,
								properties: Object.fromEntries(["cp", "sp", "ep", "gp", "pp"].map(type => [type, {type: "integer", minimum: 0}])),
							},
						},
					},
				},
			},
		},
	}, async (request, reply) => {
		const created = await store.pProposeTransfer({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			...request.body,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/transfers/:transferId/resolve", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["decision"],
				additionalProperties: false,
				properties: {
					decision: {type: "string", enum: ["accept", "reject"]},
					rulesVersionId: {type: ["string", "null"], format: "uuid"},
				},
			},
		},
	}, async request => store.pResolveTransfer({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		transferId: request.params.transferId,
		decision: request.body.decision,
		rulesVersionId: request.body.rulesVersionId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.get("/api/campaigns/:campaignId/invites", {
		preHandler: [requireAuth, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		invites: await store.pListInvites({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
		}),
	}));

	app.post("/api/campaigns/:campaignId/invites", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["role"],
				additionalProperties: false,
				properties: {
					role: {type: "string", enum: ["co_dm", "player", "spectator"]},
					expiresInHours: {type: "integer", minimum: 1, maximum: 720, default: 168},
					maxUses: {type: "integer", minimum: 1, maximum: 20, default: 1},
				},
			},
		},
	}, async (request, reply) => {
		const idempotencyKey = getIdempotencyKey(request);
		const getToken = secret => getDeterministicToken({
			secret,
			namespace: "campaign-invite",
			parts: [
				request.hubAuth.account.id,
				request.params.campaignId,
				idempotencyKey.key,
				idempotencyKey.requestHash,
			],
		});
		const token = getToken(config.inviteTokenSecrets[0]);
		const created = await store.pCreateInvite({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			role: request.body.role,
			tokenHash: getSha256(token),
			expiresAt: new Date(Date.now() + (request.body.expiresInHours || 168) * 60 * 60 * 1000),
			maxUses: request.body.maxUses || 1,
			idempotencyKey,
		});
		const replayToken = config.inviteTokenSecrets
			.map(getToken)
			.find(candidate => isConstantTimeEqual(getSha256(candidate), created.inviteTokenHash));
		if (!replayToken) {
			throw new HubStoreError(
				"INVITE_TOKEN_RECOVERY_UNAVAILABLE",
				`Invite token cannot be recovered with the configured key ring.`,
				{status: 409},
			);
		}
		const {inviteTokenHash: _inviteTokenHash, ...response} = created;
		return reply.code(201).send({...response, token: replayToken});
	});

	app.post("/api/campaigns/:campaignId/invites/:inviteId/revoke", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "inviteId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					inviteId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => store.pRevokeInvite({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		inviteId: request.params.inviteId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/invites/redeem", {
		preHandler: requireMutationSecurity,
		config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
		schema: {
			body: {
				type: "object",
				required: ["token"],
				additionalProperties: false,
				properties: {token: {type: "string", minLength: 32, maxLength: 500}},
			},
		},
	}, async request => store.pRedeemInvite({
		accountId: request.hubAuth.account.id,
		tokenHash: getSha256(request.body.token),
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/brew-versions", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["brewDocs"],
				additionalProperties: false,
				properties: {brewDocs: {type: "array", minItems: 1, maxItems: 100}},
			},
		},
	}, async (request, reply) => {
		const manifest = validateCampaignBrewBundle(request.body.brewDocs);
		const created = await store.pCreateBrewBundleVersion({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			contentHash: getCampaignBrewHash(request.body.brewDocs),
			content: request.body.brewDocs,
			manifest,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/brew-versions/:versionId/activate", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "versionId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					versionId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => store.pActivateBrewBundleVersion({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		brewBundleId: request.params.versionId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns/:campaignId/rules-versions", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["rules"],
				additionalProperties: false,
				properties: {rules: {type: "object"}},
			},
		},
	}, async (request, reply) => {
		const created = await store.pCreateRulesVersion({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			schemaVersion: CAMPAIGN_RULES_SCHEMA_VERSION,
			rules: normalizeCampaignRules(request.body.rules),
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	app.post("/api/campaigns/:campaignId/rules-versions/:versionId/activate", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "versionId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					versionId: {type: "string", format: "uuid"},
				},
			},
		},
	}, async request => store.pActivateRulesVersion({
		accountId: request.hubAuth.account.id,
		campaignId: request.params.campaignId,
		rulesVersionId: request.params.versionId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	if (config.isCampaignRulesPolicyEnabled) {
		const rulesPolicyParamsSchema = {
			type: "object",
			required: ["campaignId"],
			additionalProperties: false,
			properties: {campaignId: {type: "string", format: "uuid"}},
		};
		const nullableVersionIdSchema = {
			anyOf: [
				{type: "string", format: "uuid"},
				{type: "null"},
			],
		};

		app.get("/api/campaigns/:campaignId/rules-policy", {
			preHandler: [requireAuth, requireCampaignRole(["dm", "co_dm"])],
			schema: {params: rulesPolicyParamsSchema},
		}, async request => {
			const [management, context] = await Promise.all([
				store.pGetRulesPolicyManagement({
					accountId: request.hubAuth.account.id,
					campaignId: request.params.campaignId,
				}),
				store.pGetCampaignContext({
					accountId: request.hubAuth.account.id,
					campaignId: request.params.campaignId,
				}),
			]);
			return {
				catalog: getPublicCampaignRulesCatalog(),
				contentCatalog: await pGetCampaignContentCatalog({brewBundle: context.brewBundle}),
				management,
			};
		});

		app.post("/api/campaigns/:campaignId/rules-policy", {
			preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
			config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
			schema: {
				params: rulesPolicyParamsSchema,
				body: {
					type: "object",
					required: ["policy", "expectedActiveRulesVersionId"],
					additionalProperties: false,
					properties: {
						policy: {type: "object"},
						expectedActiveRulesVersionId: nullableVersionIdSchema,
					},
				},
			},
		}, async (request, reply) => {
			const policy = normalizeCampaignRulesPolicyForStorage(request.body.policy);
			const result = await store.pCreateAndActivateRulesPolicy({
				accountId: request.hubAuth.account.id,
				campaignId: request.params.campaignId,
				policy,
				expectedActiveRulesVersionId: request.body.expectedActiveRulesVersionId,
				idempotencyKey: getIdempotencyKey(request),
			});
			return reply.code(201).send(result);
		});

		app.post("/api/campaigns/:campaignId/rules-policy/activate", {
			preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
			config: {rateLimit: {max: 20, timeWindow: "1 minute"}},
			schema: {
				params: rulesPolicyParamsSchema,
				body: {
					type: "object",
					required: ["rulesVersionId", "expectedActiveRulesVersionId"],
					additionalProperties: false,
					properties: {
						rulesVersionId: {type: "string", format: "uuid"},
						expectedActiveRulesVersionId: nullableVersionIdSchema,
					},
				},
			},
		}, async request => store.pActivateRulesPolicyVersion({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			rulesVersionId: request.body.rulesVersionId,
			expectedActiveRulesVersionId: request.body.expectedActiveRulesVersionId,
			idempotencyKey: getIdempotencyKey(request),
		}));
	}

	app.get("/api/campaigns/:campaignId/dm-workspace", {
		preHandler: [requireAuth, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId"],
				additionalProperties: false,
				properties: {campaignId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		workspace: await store.pGetOrCreateDmWorkspace({
			accountId: request.hubAuth.account.id,
			campaignId: request.params.campaignId,
			defaultState: DEFAULT_DM_WORKSPACE,
		}),
	}));

	app.post("/api/campaigns/:campaignId/dm-workspace/:workspaceId/lease", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "workspaceId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					workspaceId: {type: "string", format: "uuid"},
				},
			},
			body: {
				type: "object",
				additionalProperties: false,
				properties: {takeover: {type: "boolean", default: false}},
			},
		},
	}, async request => ({
		lease: await store.pAcquireDmWorkspaceLease({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			campaignId: request.params.campaignId,
			workspaceId: request.params.workspaceId,
			isTakeover: !!request.body?.takeover,
		}),
	}));

	app.put("/api/campaigns/:campaignId/dm-workspace/:workspaceId", {
		preHandler: [requireMutationSecurity, requireCampaignRole(["dm", "co_dm"])],
		schema: {
			params: {
				type: "object",
				required: ["campaignId", "workspaceId"],
				additionalProperties: false,
				properties: {
					campaignId: {type: "string", format: "uuid"},
					workspaceId: {type: "string", format: "uuid"},
				},
			},
			body: {
				type: "object",
				required: ["baseRevision", "leaseEpoch", "state"],
				additionalProperties: false,
				properties: {
					baseRevision: {type: "integer", minimum: 1},
					leaseEpoch: {type: "integer", minimum: 1},
					state: {type: "object"},
				},
			},
		},
	}, async request => store.pWriteDmWorkspace({
		accountId: request.hubAuth.account.id,
		sessionId: request.hubAuth.session.id,
		campaignId: request.params.campaignId,
		workspaceId: request.params.workspaceId,
		baseRevision: request.body.baseRevision,
		leaseEpoch: request.body.leaseEpoch,
		state: request.body.state,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/campaigns", {
		preHandler: requireMutationSecurity,
		config: {rateLimit: {max: 10, timeWindow: "1 minute"}},
		schema: {
			body: {
				type: "object",
				additionalProperties: false,
				required: ["name"],
				properties: {
					name: {type: "string", minLength: 1, maxLength: 120},
				},
			},
		},
	}, async (request, reply) => {
		const name = request.body.name.trim();
		if (!name) return reply.code(400).send({error: "INVALID_CAMPAIGN_NAME"});
		const created = await store.pCreateCampaign({
			accountId: request.hubAuth.account.id,
			name,
			idempotencyKey: getIdempotencyKey(request),
		});
		return reply.code(201).send(created);
	});

	// Protocol-gated: the response shape changed when the owner's sharing policy stopped
	// being part of a canonical character response.
	app.get("/api/characters", {preHandler: requireProtocolVersion}, async request => ({
		characters: await store.pListCharacters({
			accountId: request.hubAuth.account.id,
			campaignId: request.query?.campaignId || null,
		}),
	}));

	app.post("/api/characters", {
		preHandler: requireMutationSecurity,
		schema: {
			body: {
				type: "object",
				required: ["clientImportId", "schemaVersion", "data"],
				additionalProperties: false,
				properties: {
					clientImportId: {type: "string", minLength: 1, maxLength: 200},
					campaignId: {type: ["string", "null"], format: "uuid"},
					schemaVersion: {type: "integer", minimum: 1},
					data: {type: "object"},
					rulesVersionId: {type: ["string", "null"], format: "uuid"},
				},
			},
		},
	}, async (request, reply) => {
		const created = await store.pCreateCharacter({
			accountId: request.hubAuth.account.id,
			campaignId: request.body.campaignId || null,
			data: request.body.data,
			schemaVersion: request.body.schemaVersion,
			clientImportId: request.body.clientImportId,
			rulesVersionId: request.body.rulesVersionId || null,
			idempotencyKey: getIdempotencyKey(request),
			protocolVersion: request.headers["x-hub-protocol-version"],
		});
		return reply.code(201).send(created);
	});

	app.get("/api/characters/:characterId", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => ({
		projection: await store.pGetCharacter({
			accountId: request.hubAuth.account.id,
			characterId: request.params.characterId,
		}),
	}));

	app.get("/api/characters/:characterId/projection-policy", {
		preHandler: requireProtocolVersion,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pGetProjectionPolicy({
		accountId: request.hubAuth.account.id,
		characterId: request.params.characterId,
	}));

	app.put("/api/characters/:characterId/projection-policy", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["policy", "expectedProjectionRevision"],
				additionalProperties: false,
				properties: {
					expectedProjectionRevision: {type: "integer", minimum: 1},
					policy: {
						type: "object",
						required: ["version", "preset"],
						additionalProperties: false,
						properties: {
							version: {type: "integer", enum: [PROJECTION_POLICY_VERSION]},
							preset: {type: "string", enum: [...PROJECTION_PRESET_KEYS]},
							overrides: {type: "object"},
						},
					},
				},
			},
		},
	}, async request => store.pSetProjectionPolicy({
		accountId: request.hubAuth.account.id,
		characterId: request.params.characterId,
		policy: request.body.policy,
		expectedProjectionRevision: request.body.expectedProjectionRevision,
		idempotencyKey: getIdempotencyKey(request),
	}));

	app.post("/api/characters/:characterId/lease", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				additionalProperties: false,
				properties: {takeover: {type: "boolean", default: false}},
			},
		},
	}, async request => ({
		lease: await store.pAcquireCharacterLease({
			accountId: request.hubAuth.account.id,
			sessionId: request.hubAuth.session.id,
			characterId: request.params.characterId,
			isTakeover: !!request.body?.takeover,
		}),
	}));

	app.post("/api/characters/:characterId/lease/release", {
		preValidation: [requireMutationSecurity, requireCurrentProtocolVersion],
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["leaseEpoch", "expiresAt"],
				additionalProperties: false,
				properties: {
					leaseEpoch: {type: "integer", minimum: 1},
					expiresAt: {type: "string", format: "date-time"},
				},
			},
		},
	}, async request => store.pReleaseCharacterLease({
		accountId: request.hubAuth.account.id,
		sessionId: request.hubAuth.session.id,
		characterId: request.params.characterId,
		leaseEpoch: request.body.leaseEpoch,
		expiresAt: request.body.expiresAt,
	}));

	app.patch("/api/characters/:characterId", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
			body: {
				type: "object",
				required: ["baseRevision", "leaseEpoch", "patches"],
				additionalProperties: false,
				properties: {
					baseRevision: {type: "integer", minimum: 1},
					leaseEpoch: {type: "integer", minimum: 1},
					patches: {
						type: "array",
						maxItems: 500,
						items: {
							type: "object",
							required: ["op", "path"],
							additionalProperties: true,
							properties: {
								op: {type: "string", enum: ["add", "remove", "replace"]},
								path: {type: "string", maxLength: 500},
							},
						},
					},
					activity: {
						type: ["object", "null"],
						required: ["type", "spellName", "spellSource", "spellLevel", "slotLevel", "mode"],
						additionalProperties: false,
						properties: {
							type: {type: "string", const: "spell.used"},
							spellName: {type: "string", minLength: 1, maxLength: 100},
							spellSource: {type: "string", minLength: 1, maxLength: 20},
							spellLevel: {type: "integer", minimum: 0, maximum: 9},
							slotLevel: {type: "integer", minimum: 0, maximum: 9},
							mode: {type: "string", enum: ["cantrip", "ritual", "spell_slot", "pact_slot", "resource", "free"]},
						},
					},
					rulesVersionId: {type: ["string", "null"], format: "uuid"},
				},
			},
		},
	}, async request => store.pPatchCharacter({
		accountId: request.hubAuth.account.id,
		sessionId: request.hubAuth.session.id,
		characterId: request.params.characterId,
		baseRevision: request.body.baseRevision,
		leaseEpoch: request.body.leaseEpoch,
		patches: request.body.patches,
		activity: request.body.activity || null,
		rulesVersionId: request.body.rulesVersionId || null,
		idempotencyKey: getIdempotencyKey(request),
		protocolVersion: request.headers["x-hub-protocol-version"],
	}));

	app.delete("/api/characters/:characterId", {
		preHandler: requireMutationSecurity,
		schema: {
			params: {
				type: "object",
				required: ["characterId"],
				additionalProperties: false,
				properties: {characterId: {type: "string", format: "uuid"}},
			},
		},
	}, async request => store.pArchiveCharacter({
		accountId: request.hubAuth.account.id,
		characterId: request.params.characterId,
		idempotencyKey: getIdempotencyKey(request),
	}));

	for (const action of ["clone", "move"]) {
		app.post(`/api/characters/:characterId/${action}`, {
			preHandler: requireMutationSecurity,
			schema: {
				params: {
					type: "object",
					required: ["characterId"],
					additionalProperties: false,
					properties: {characterId: {type: "string", format: "uuid"}},
				},
				body: {
					type: "object",
					required: ["campaignId"],
					additionalProperties: false,
					properties: {
						campaignId: {type: "string", format: "uuid"},
						rulesVersionId: {type: ["string", "null"], format: "uuid"},
					},
				},
			},
		}, async request => store[action === "clone" ? "pCloneCharacter" : "pMoveCharacter"]({
			accountId: request.hubAuth.account.id,
			characterId: request.params.characterId,
			campaignId: request.body.campaignId,
			rulesVersionId: request.body.rulesVersionId || null,
			idempotencyKey: getIdempotencyKey(request),
		}));
	}

	return app;
}

export {
	SESSION_COOKIE,
	OAUTH_COOKIE,
	HUB_PROTOCOL_VERSION,
	HUB_LEGACY_PROTOCOL_VERSION,
	PEER_SOURCE_COSTS_PROTOCOL_VERSION as HUB_PEER_SOURCE_COSTS_PROTOCOL_VERSION,
};
