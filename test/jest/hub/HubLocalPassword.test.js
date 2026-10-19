import {jest} from "@jest/globals";
import crypto from "node:crypto";
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHubApp} from "../../../server/src/app.js";
import {AuthProviderRegistry} from "../../../server/src/auth-provider-registry.js";
import {createAuthProviderConfiguration} from "../../../server/src/auth-provider-config.js";
import {hashLocalPassword, LocalPasswordProvider, provisionLocalAccounts} from "../../../server/src/local-password-provider.js";
import {saveLocalUser} from "../../../server/scripts/local-user.mjs";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {HUB_PROTOCOL_VERSION} from "../../../js/hub/hub-capabilities.js";

const ORIGIN = "https://tools.example";
const PASSWORD = "a private test password";
let passwordHash;
let temporary;
beforeAll(async () => {
	passwordHash = await hashLocalPassword(PASSWORD);
	temporary = mkdtempSync(join(tmpdir(), "hub-local-login-"));
});
afterAll(() => rmSync(temporary, {recursive: true, force: true}));
const getDocument = () => ({version: 1,
	users: [
		{id: "72538cb4-d266-44cb-8936-14a6ac5161ce", username: "dennis", displayName: "Dennis", passwordHash},
		{id: "4588798d-3daf-489d-887f-77407feb4d3d", username: "player", displayName: "Player", passwordHash},
	]});
function getCookies (...responses) {
	const jar = new Map();
	for (const response of responses) {
		for (const cookie of response.cookies || []) {
			if (cookie.maxAge === 0 || !cookie.value) jar.delete(cookie.name);
			else jar.set(cookie.name, cookie.value);
		}
	}
	return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

describe("Private JSON credentials", () => {
	it("hashes passwords with unique salts and verifies known, unknown and disabled users", async () => {
		const provider = new LocalPasswordProvider(getDocument());
		expect(passwordHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
		expect(await hashLocalPassword(PASSWORD)).not.toBe(passwordHash);
		expect(await provider.pVerifyCredentials({username: "DENNIS", password: PASSWORD})).toMatchObject({provider: "local", subject: getDocument().users[0].id});
		expect(await provider.pVerifyCredentials({username: "dennis", password: "incorrect"})).toBeNull();
		expect(await provider.pVerifyCredentials({username: "missing", password: PASSWORD})).toBeNull();
		const document = getDocument();
		document.users[0].disabled = true;
		expect(await new LocalPasswordProvider(document).pVerifyCredentials({username: "dennis", password: PASSWORD})).toBeNull();
	});

	it("rejects plaintext, ambiguous identities, malformed hashes and empty allowlists", () => {
		for (const change of [
			document => { document.users[0].password = PASSWORD; },
			document => { document.users[0].passwordHash = "plaintext"; },
			document => { document.users[1].username = "DENNIS"; },
			document => { document.users[1].id = document.users[0].id; },
			document => { document.users = []; },
			document => { document.users.forEach(user => { user.disabled = true; }); },
		]) {
			const document = getDocument();
			change(document);
			expect(() => new LocalPasswordProvider(document)).toThrow();
		}
	});

	it("selects local login with no OAuth credentials and does not expose hashes", () => {
		const path = join(temporary, "configured-users.json");
		writeFileSync(path, JSON.stringify(getDocument()));
		const config = createAuthProviderConfiguration({env: {HUB_AUTH_MODE: "local", HUB_LOCAL_USERS_FILE: path}});
		expect(config.identityRetentionRequiredProviders).toEqual(["local"]);
		expect(config.authProviderRegistry.getPublicMetadata()).toEqual([{
			slug: "local", label: "Username and password", startPath: "/auth/local/start", status: "available",
		}]);
		expect(JSON.stringify(config)).not.toContain(passwordHash);
		expect(() => createAuthProviderConfiguration({env: {HUB_AUTH_MODE: "typo"}})).toThrow("HUB_AUTH_MODE");
		expect(() => createAuthProviderConfiguration({env: {HUB_AUTH_MODE: "local"}})).toThrow("HUB_LOCAL_USERS_FILE");
	});

	it("the user command writes only hashes, preserves identities on password changes and validates existing data", async () => {
		const filePath = join(temporary, "managed", "users.json");
		let first;
		const previousMask = process.umask(0o077);
		try {
			first = await saveLocalUser({filePath, username: "Dennis", displayName: "Dennis", password: PASSWORD});
		} finally { process.umask(previousMask); }
		const raw = readFileSync(filePath, "utf8");
		expect(raw).not.toContain(PASSWORD);
		expect(statSync(join(temporary, "managed")).mode & 0o777).toBe(0o700);
		expect(statSync(filePath).mode & 0o777).toBe(0o644);
		const second = await saveLocalUser({filePath, username: "dennis", password: "a replacement password"});
		expect(second.id).toBe(first.id);
		const document = JSON.parse(readFileSync(filePath, "utf8"));
		expect(document.users).toHaveLength(1);
		const provider = new LocalPasswordProvider(document);
		expect(await provider.pVerifyCredentials({username: "dennis", password: PASSWORD})).toBeNull();
		expect(await provider.pVerifyCredentials({username: "dennis", password: "a replacement password"})).not.toBeNull();
		writeFileSync(filePath, "{}");
		await expect(saveLocalUser({filePath, username: "dennis", password: PASSWORD})).rejects.toThrow();
		expect(readFileSync(filePath, "utf8")).toBe("{}");
	});
});

describe("Local login uses normal Hub sessions and authorization", () => {
	let app;
	let store;
	let provider;
	beforeEach(async () => {
		store = new MemoryHubStore();
		provider = new LocalPasswordProvider(getDocument());
		await provisionLocalAccounts({store, provider});
		app = await createHubApp({
			store,
			authProviderRegistry: new AuthProviderRegistry({registrations: [{status: "available", provider}]}),
			config: {appOrigin: ORIGIN, cookieSecret: "c".repeat(32), csrfSecret: "s".repeat(32), identityRetentionRequiredProviders: ["local"]},
		});
	});
	afterEach(async () => app.close());
	async function start (returnTo = "/hub.html") {
		const response = await app.inject({url: `/auth/local/start?${new URLSearchParams({returnTo})}`});
		expect(response.statusCode).toBe(302);
		return {response, cookie: getCookies(response), state: new URL(response.headers.location, ORIGIN).searchParams.get("state")};
	}
	async function submit (started, {username = "dennis", password = PASSWORD, headers = {}} = {}) {
		return app.inject({
			method: "POST",
			url: "/auth/local/callback",
			headers: {origin: ORIGIN, cookie: started.cookie, "content-type": "application/x-www-form-urlencoded", ...headers},
			payload: new URLSearchParams({state: started.state, username, password}).toString(),
		});
	}
	async function signIn (username = "dennis") {
		const started = await start();
		const response = await submit(started, {username});
		expect(response.statusCode).toBe(303);
		const cookie = getCookies(response);
		const sessionResponse = await app.inject({url: "/api/session", headers: {cookie}});
		return {cookie, session: sessionResponse.json()};
	}
	const mutationHeaders = ({cookie, session}) => ({
		cookie,
		origin: ORIGIN,
		"x-csrf-token": session.csrfToken,
		"x-hub-protocol-version": HUB_PROTOCOL_VERSION,
		"idempotency-key": crypto.randomUUID(),
	});

	it("renders a password form, sets secure cookies, survives reload and logs out", async () => {
		const started = await start();
		const form = await app.inject({url: `/auth/local/login?${new URLSearchParams({state: started.state})}`, headers: {cookie: started.cookie}});
		expect(form.statusCode).toBe(200);
		expect(form.headers["cache-control"]).toBe("no-store");
		expect(form.body).toContain("type=\"password\"");
		expect(form.body).not.toContain(passwordHash);
		const login = await submit(started);
		expect(login.statusCode).toBe(303);
		expect(login.headers.location).toBe("/hub.html");
		expect(login.headers["set-cookie"].join(";")).toMatch(/HttpOnly.*Secure|Secure.*HttpOnly/);
		const cookie = getCookies(login);
		const session = (await app.inject({url: "/api/session", headers: {cookie}})).json();
		expect(session).toMatchObject({signedIn: true, account: {displayName: "Dennis"}, reauthenticationProviders: ["local"]});
		expect(JSON.stringify(session)).not.toContain(passwordHash);
		const logout = await app.inject({method: "POST", url: "/api/logout", headers: mutationHeaders({cookie, session})});
		expect(logout.statusCode).toBe(200);
		expect((await app.inject({url: "/api/session", headers: {cookie}})).json()).toEqual({signedIn: false});
	});

	it("uses the same generic error for unknown users and wrong passwords, allowing a corrected retry", async () => {
		const started = await start();
		for (const credentials of [{username: "missing"}, {password: "wrong"}]) {
			const response = await submit(started, credentials);
			expect(response.statusCode).toBe(401);
			expect(response.body).toContain("Username or password is incorrect.");
			expect(getCookies(response)).not.toContain("__Host-hub_session");
		}
		expect((await submit(started)).statusCode).toBe(303);
		expect((await submit(started)).statusCode).toBe(400);
	});

	it("rejects cross-origin requests and missing browser-bound state before password verification", async () => {
		const started = await start();
		const verify = jest.spyOn(provider, "pVerifyCredentials");
		expect((await submit(started, {headers: {origin: "https://other.example"}})).statusCode).toBe(403);
		expect((await submit({...started, cookie: ""})).statusCode).toBe(400);
		expect(verify).not.toHaveBeenCalled();
		expect((await app.inject({url: "/auth/local/callback?code=password"})).statusCode).toBe(404);
	});

	it("does not redirect to another origin and rejects expired login transactions", async () => {
		const started = await start("https://other.example/steal");
		expect((await submit(started)).headers.location).toBe("/hub.html");
		const expired = await start();
		store._oauthTransactions.get(expired.state.split(".")[0]).expiresAt = new Date(0).toISOString();
		expect((await submit(expired)).statusCode).toBe(400);
	});

	it("creates campaigns while keeping them private to their members", async () => {
		const owner = await signIn();
		const created = await app.inject({method: "POST", url: "/api/campaigns", headers: mutationHeaders(owner), payload: {name: "Personal campaign"}});
		expect(created.statusCode).toBe(201);
		const other = await signIn("player");
		const campaigns = await app.inject({url: "/api/campaigns", headers: {cookie: other.cookie}});
		expect(campaigns.json().campaigns).toEqual([]);
		const id = created.json().campaign.id;
		expect((await app.inject({url: `/api/campaigns/${id}`, headers: {cookie: other.cookie}})).statusCode).toBe(404);
	});

	it("reauthenticates using the password form and revokes the previous session", async () => {
		const original = await signIn();
		const begin = await app.inject({method: "POST", url: "/api/account/reauthentication/local", headers: mutationHeaders(original), payload: {returnTo: "/hub.html"}});
		expect(begin.statusCode).toBe(201);
		const state = new URL(begin.json().authorizationUrl, ORIGIN).searchParams.get("state");
		const response = await submit({state, cookie: `${original.cookie}; ${getCookies(begin)}`});
		expect(response.statusCode).toBe(303);
		expect((await app.inject({url: "/api/session", headers: {cookie: original.cookie}})).json().signedIn).toBe(false);
		expect((await app.inject({url: "/api/session", headers: {cookie: getCookies(response)}})).json().signedIn).toBe(true);
	});

	it("rejects an established session after the host disables its file identity", async () => {
		const loggedIn = await signIn();
		jest.spyOn(provider, "hasIdentity").mockReturnValue(false);
		expect((await app.inject({url: "/api/session", headers: {cookie: loggedIn.cookie}})).json()).toEqual({signedIn: false});
	});

	it("cannot reauthenticate one account using another file user's valid password", async () => {
		const original = await signIn();
		const begin = await app.inject({method: "POST", url: "/api/account/reauthentication/local", headers: mutationHeaders(original), payload: {returnTo: "/hub.html"}});
		const state = new URL(begin.json().authorizationUrl, ORIGIN).searchParams.get("state");
		const response = await submit({state, cookie: `${original.cookie}; ${getCookies(begin)}`}, {username: "player"});
		expect(response.statusCode).toBe(403);
		expect(response.json().error).toBe("REAUTHENTICATION_FAILED");
		expect(getCookies(response)).not.toContain("__Host-hub_session");
		const session = (await app.inject({url: "/api/session", headers: {cookie: original.cookie}})).json();
		expect(session).toMatchObject({signedIn: true, account: {id: original.session.account.id, displayName: "Dennis"}});
	});

	it("rate limits repeated password guesses", async () => {
		const started = await start();
		for (let attempt = 0; attempt < 10; ++attempt) expect((await submit(started, {password: "wrong"})).statusCode).toBe(401);
		expect((await submit(started, {password: "wrong"})).statusCode).toBe(429);
	});
});
