import crypto from "node:crypto";
import {createHubApp} from "../../../server/src/app.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {AuthProviderRegistry} from "../../../server/src/auth-provider-registry.js";
import {hashLocalPassword, LocalPasswordProvider, provisionLocalAccounts} from "../../../server/src/local-password-provider.js";
import {HUB_PROTOCOL_VERSION} from "../../../js/hub/hub-capabilities.js";

const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;
const ORIGIN = "https://tools.example";
const cookieHeader = response => (response.cookies || []).filter(cookie => cookie.value && cookie.maxAge !== 0).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");

describePostgres("Personal password login with PostgreSQL", () => {
	let store;
	let app;
	let subject;
	let provider;
	beforeAll(async () => {
		store = PostgresHubStore.fromConnectionString({connectionString: process.env.HUB_TEST_POSTGRES_URL, ssl: false, maxConnections: 4});
		await store.pCheckHealth();
		subject = crypto.randomUUID();
		provider = new LocalPasswordProvider({version: 1,
			users: [{
				id: subject, username: "host", displayName: "Personal host", passwordHash: await hashLocalPassword("integration password"),
			}]});
		await provisionLocalAccounts({store, provider});
		app = await createHubApp({
			store,
			authProviderRegistry: new AuthProviderRegistry({registrations: [{status: "available", provider}]}),
			config: {appOrigin: ORIGIN, cookieSecret: "c".repeat(32), csrfSecret: "s".repeat(32), identityRetentionRequiredProviders: ["local"]},
		});
	});
	afterAll(async () => {
		await app?.close();
		await store?.pClose();
	});
	async function signIn () {
		const start = await app.inject({url: "/auth/local/start"});
		const state = new URL(start.headers.location, ORIGIN).searchParams.get("state");
		const login = await app.inject({
			method: "POST",
			url: "/auth/local/callback",
			headers: {cookie: cookieHeader(start), origin: ORIGIN, "content-type": "application/x-www-form-urlencoded"},
			payload: new URLSearchParams({state, username: "host", password: "integration password"}).toString(),
		});
		expect(login.statusCode).toBe(303);
		const cookie = cookieHeader(login);
		const session = (await app.inject({url: "/api/session", headers: {cookie}})).json();
		expect(session.signedIn).toBe(true);
		return {cookie, session};
	}
	const headersFor = ({cookie, session}) => ({
		cookie,
		origin: ORIGIN,
		"x-csrf-token": session.csrfToken,
		"x-hub-protocol-version": HUB_PROTOCOL_VERSION,
		"idempotency-key": crypto.randomUUID(),
	});

	it("provisions only the configured local identity, persists campaigns and reuses the account", async () => {
		const first = await signIn();
		const campaign = await app.inject({method: "POST", url: "/api/campaigns", headers: headersFor(first), payload: {name: "Password login campaign"}});
		expect(campaign.statusCode).toBe(201);
		await provisionLocalAccounts({store, provider});
		const second = await signIn();
		expect(second.session.account.id).toBe(first.session.account.id);
		const campaigns = await app.inject({url: "/api/campaigns", headers: {cookie: second.cookie}});
		expect(campaigns.json().campaigns.map(value => value.id)).toContain(campaign.json().campaign.id);
		const identities = await store.pListExternalIdentities({accountId: first.session.account.id});
		expect(identities).toHaveLength(1);
		expect(identities[0]).toMatchObject({provider: "local", subject});
	});

	it("reauthenticates with the same file password through the real transactional session rotation", async () => {
		const original = await signIn();
		const begin = await app.inject({method: "POST", url: "/api/account/reauthentication/local", headers: headersFor(original), payload: {returnTo: "/hub.html"}});
		expect(begin.statusCode).toBe(201);
		const state = new URL(begin.json().authorizationUrl, ORIGIN).searchParams.get("state");
		const response = await app.inject({
			method: "POST",
			url: "/auth/local/callback",
			headers: {origin: ORIGIN, cookie: `${original.cookie}; ${cookieHeader(begin)}`, "content-type": "application/x-www-form-urlencoded"},
			payload: new URLSearchParams({state, username: "host", password: "integration password"}).toString(),
		});
		expect(response.statusCode).toBe(303);
		expect((await app.inject({url: "/api/session", headers: {cookie: original.cookie}})).json().signedIn).toBe(false);
		expect((await app.inject({url: "/api/session", headers: {cookie: cookieHeader(response)}})).json().signedIn).toBe(true);
	});
});
