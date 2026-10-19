import {getRequestClientIp} from "./client-ip.js";

const LABEL_ESCAPE_RE = /[\\"]/g;

function escapeLabel (value) {
	return `${value}`.replace(LABEL_ESCAPE_RE, match => match === "\\" ? "\\\\" : "\\\"");
}

function metricLine (name, labels, value) {
	const labelText = Object.keys(labels).length
		? `{${Object.entries(labels).map(([key, label]) => `${key}="${escapeLabel(label)}"`).join(",")}}`
		: "";
	return `${name}${labelText} ${Number(value) || 0}`;
}

export class HubMetrics {
	constructor ({fnNow = () => Date.now()} = {}) {
		this._fnNow = fnNow;
		this._startedAt = fnNow();
		this._requests = new Map();
		this._authOutcomes = new Map();
	}

	observeAuth ({provider, outcome}) {
		const labels = {provider, outcome};
		const key = JSON.stringify(labels);
		const current = this._authOutcomes.get(key) || {labels, count: 0};
		current.count++;
		this._authOutcomes.set(key, current);
	}

	observeRequest ({method, route, statusCode, durationMs}) {
		const labels = {method, route: route || "unknown", status: `${statusCode}`};
		const key = JSON.stringify(labels);
		const current = this._requests.get(key) || {labels, count: 0, durationMs: 0};
		current.count++;
		current.durationMs += Math.max(0, Number(durationMs) || 0);
		this._requests.set(key, current);
	}

	toPrometheus ({operational = {}, websocketConnections = 0, dispatcher = {}} = {}) {
		const lines = [
			"# HELP hub_process_uptime_seconds Campaign Hub process uptime.",
			"# TYPE hub_process_uptime_seconds gauge",
			metricLine("hub_process_uptime_seconds", {}, (this._fnNow() - this._startedAt) / 1000),
			"# HELP hub_websocket_connections Current authorized WebSocket connections.",
			"# TYPE hub_websocket_connections gauge",
			metricLine("hub_websocket_connections", {}, websocketConnections),
			"# HELP hub_http_requests_total HTTP responses by bounded route template.",
			"# TYPE hub_http_requests_total counter",
		];
		for (const current of this._requests.values()) {
			lines.push(metricLine("hub_http_requests_total", current.labels, current.count));
			lines.push(metricLine("hub_http_request_duration_milliseconds_sum", current.labels, current.durationMs));
			lines.push(metricLine("hub_http_request_duration_milliseconds_count", current.labels, current.count));
		}
		lines.push("# HELP hub_auth_outcomes_total Authentication outcomes by configured provider.");
		lines.push("# TYPE hub_auth_outcomes_total counter");
		for (const current of this._authOutcomes.values()) {
			lines.push(metricLine("hub_auth_outcomes_total", current.labels, current.count));
		}
		for (const [key, value] of Object.entries({
			outbox_pending: operational.outboxPending,
			outbox_failed: operational.outboxFailed,
			outbox_oldest_age_seconds: operational.outboxOldestAgeSeconds,
			active_sessions: operational.activeSessions,
			expired_receipts: operational.expiredReceipts,
			expired_oauth_transactions: operational.expiredOAuthTransactions,
			expired_invite_contexts: operational.expiredInviteContexts,
			deletion_due_accounts: operational.deletionDueAccounts,
			last_maintenance_age_seconds: operational.lastMaintenanceAgeSeconds,
			last_backup_age_seconds: operational.lastBackupAgeSeconds,
			last_restore_drill_age_seconds: operational.lastRestoreDrillAgeSeconds,
			dispatcher_last_batch_count: dispatcher.lastBatchCount,
			dispatcher_last_success_age_seconds: dispatcher.lastSuccessAgeSeconds,
			dispatcher_consecutive_errors: dispatcher.consecutiveErrors,
		})) lines.push(metricLine(`hub_${key}`, {}, value));
		return `${lines.join("\n")}\n`;
	}
}

export function getSafeRequestId (request) {
	const candidate = request.headers["x-request-id"];
	if (typeof candidate === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(candidate)) return candidate;
	return null;
}

export function getSafeRequestLog (request, {clientIpHeader = null} = {}) {
	return {
		method: request.method,
		url: `${request.url || ""}`.split("?")[0],
		host: request.headers?.host,
		remoteAddress: getRequestClientIp({request, clientIpHeader}),
		remotePort: request.socket?.remotePort,
	};
}

export const HUB_LOG_REDACT_PATHS = Object.freeze([
	"req.headers.authorization",
	"req.headers.cookie",
	"req.headers[\"x-csrf-token\"]",
	"req.headers[\"idempotency-key\"]",
	"res.headers[\"set-cookie\"]",
	"response.headers[\"set-cookie\"]",
	"databaseUrl",
	"clientSecret",
	"password",
	"passwordHash",
	"req.body.password",
	"token",
	"tokenHash",
	"inviteToken",
	"retryToken",
	"inviteContext",
	"inviteContextId",
	"state",
	"stateHash",
	"code",
	"codeVerifier",
	"pkceVerifier",
	"oidcNonce",
	"accessToken",
	"refreshToken",
	"idToken",
]);
