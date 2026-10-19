import {provisionLocalAccounts} from "./local-password-provider.js";
import {createHubApp} from "./app.js";
import {createAuthProviderConfiguration} from "./auth-provider-config.js";
import {getClientIpHeader} from "./client-ip.js";
import {parsePeerSourceCostsCampaignIds} from "./peer-source-cost-rollout.js";
import {parseMultiTargetOperationsCampaignIds} from "./multi-target-operation-rollout.js";
import {PostgresHubStore} from "./postgres-hub-store.js";
import {getSafeRequestLog, HUB_LOG_REDACT_PATHS} from "./observability.js";
import {parseOperatorAccountIds} from "./account-entitlements.js";

function requireEnv (name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable ${name}.`);
	return value;
}

function getCsv (name) {
	return (process.env[name] || "")
		.split(",")
		.map(it => it.trim())
		.filter(Boolean);
}

function getTrustProxy () {
	const proxies = getCsv("HUB_TRUST_PROXY");
	return proxies.length ? proxies : false;
}

const clientIpHeader = getClientIpHeader(process.env.HUB_CLIENT_IP_HEADER);
const isAccountEntitlementsEnabled = process.env.HUB_ACCOUNT_ENTITLEMENTS_ENABLED === "true";
const isInviteAccountAdmissionEnabled = process.env.HUB_INVITE_ACCOUNT_ADMISSION_ENABLED === "true";
const operatorAccountIds = parseOperatorAccountIds(process.env.HUB_OPERATOR_ACCOUNT_IDS);
const multiTargetOperationsCampaignIds = parseMultiTargetOperationsCampaignIds(
	process.env.HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS,
);
if (isInviteAccountAdmissionEnabled && !isAccountEntitlementsEnabled) {
	throw new Error(`Invite account admission requires account entitlement enforcement.`);
}
const store = PostgresHubStore.fromConnectionString({
	connectionString: requireEnv("DATABASE_URL"),
	ssl: process.env.HUB_DATABASE_SSL !== "false",
	peerSourceCostsEnabled: parsePeerSourceCostsCampaignIds(
		process.env.HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS,
	),
	multiTargetOperationsEnabled: multiTargetOperationsCampaignIds,
	isAccountEntitlementsEnabled,
});
await store.pCheckHealth();
if (multiTargetOperationsCampaignIds.length) {
	await store.pCheckMultiTargetOperationsCampaignReadiness({
		campaignIds: multiTargetOperationsCampaignIds,
	});
}
const {
	authProviderRegistry,
	identityRetentionRequiredProviders,
} = createAuthProviderConfiguration({
	onConfigurationError: ({slug, code}) => {
		process.stderr.write(`Authentication provider ${slug} configuration failed (${code}).\n`);
	},
});
for (const provider of authProviderRegistry.getAvailableProviders()) {
	if (provider.authenticationType === "password") await provisionLocalAccounts({store, provider});
}
await store.pReconcileConfiguredOperatorEntitlements({
	accountIds: operatorAccountIds,
	onWarning: ({accountId}) => {
		process.stderr.write(`Configured Hub operator account was not found (${accountId}).\n`);
	},
});
if (isAccountEntitlementsEnabled && !await store.pHasActivePlatformOperator()) {
	throw new Error(`Account entitlement enforcement requires an active platform operator.`);
}

const app = await createHubApp({
	store,
	authProviderRegistry,
	logger: {
		level: process.env.HUB_LOG_LEVEL || "info",
		redact: {paths: [...HUB_LOG_REDACT_PATHS], censor: "[REDACTED]"},
		serializers: {req: request => getSafeRequestLog(request, {clientIpHeader})},
	},
	isStartOutboxDispatcher: true,
	config: {
		appOrigin: requireEnv("HUB_APP_ORIGIN"),
		cookieSecret: requireEnv("HUB_COOKIE_SECRET"),
		csrfSecret: requireEnv("HUB_CSRF_SECRET"),
		inviteTokenSecrets: [
			requireEnv("HUB_INVITE_TOKEN_SECRET"),
			...getCsv("HUB_INVITE_TOKEN_PREVIOUS_SECRETS"),
		],
		trustProxy: getTrustProxy(),
		metricsToken: requireEnv("HUB_METRICS_TOKEN"),
		clientIpHeader,
		isInviteAccountAdmissionEnabled,
		isCampaignRulesPolicyEnabled: process.env.HUB_CAMPAIGN_RULES_POLICY_ENABLED === "true",
		isAccountEntitlementsEnabled,
		isAccountIdentityLinkingEnabled: process.env.HUB_ACCOUNT_IDENTITY_LINKING_ENABLED === "true",
		identityRetentionRequiredProviders,
		operatorAccountIds,
		isOperatorReconciliationComplete: true,
	},
});

const port = Number(process.env.HUB_PORT || 5052);
await app.listen({host: process.env.HUB_HOST || "127.0.0.1", port});

const pClose = async signal => {
	app.log.info({signal}, "Stopping campaign hub");
	await app.close();
	await store.pClose();
	process.exit(0);
};

process.once("SIGINT", () => void pClose("SIGINT"));
process.once("SIGTERM", () => void pClose("SIGTERM"));
