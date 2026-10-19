import crypto from "node:crypto";
import {readFileSync, statSync} from "node:fs";
import {promisify} from "node:util";

const scrypt = promisify(crypto.scrypt);
const HASH_PATTERN = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/;
const USERNAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUMMY_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export async function hashLocalPassword (password) {
	if (typeof password !== "string" || password.length < 8 || password.length > 256) {
		throw new TypeError("Use a password between 8 and 256 characters.");
	}
	const salt = crypto.randomBytes(16).toString("hex");
	const key = await scrypt(password, Buffer.from(salt, "hex"), 64);
	return `scrypt$${salt}$${key.toString("hex")}`;
}

export class LocalPasswordProvider {
	#users;

	constructor (document) {
		if (document?.version !== 1 || !Array.isArray(document.users) || !document.users.length || document.users.length > 100) {
			throw new TypeError("Local users file must contain version: 1 and between 1 and 100 users. Run npm run hub:user to add a user.");
		}
		const names = new Set();
		const ids = new Set();
		this.#users = document.users.map(user => {
			const username = user?.username?.toLowerCase();
			if (!UUID_PATTERN.test(user?.id || "") || typeof username !== "string" || !USERNAME_PATTERN.test(username)
				|| names.has(username) || ids.has(user.id.toLowerCase()) || !HASH_PATTERN.test(user.passwordHash || "")
				|| typeof user.displayName !== "string" || !user.displayName.trim() || user.displayName.length > 100
				|| (user.disabled != null && typeof user.disabled !== "boolean") || Object.hasOwn(user, "password")) {
				throw new TypeError("Invalid or duplicate local user. Use hub:user to create password hashes and preserve each user's id.");
			}
			names.add(username);
			ids.add(user.id.toLowerCase());
			return {...user, id: user.id.toLowerCase(), username};
		});
		if (!this.#users.some(user => !user.disabled)) throw new TypeError("At least one local user must be enabled.");
		this.slug = "local";
		this.label = "Username and password";
		this.authenticationType = "password";
		this.startPath = "/auth/local/start";
		this.callbackPath = "/auth/local/callback";
		this.capabilities = Object.freeze({pkce: false, oidcNonce: false});
	}

	static fromFile (path) {
		if (!path) throw new TypeError("HUB_LOCAL_USERS_FILE is required in local login mode.");
		if (statSync(path).size > 256 * 1024) throw new TypeError("Local users file is too large.");
		return new LocalPasswordProvider(JSON.parse(readFileSync(path, "utf8")));
	}

	getAuthorizationUrl ({state}) {
		return `/auth/local/login?${new URLSearchParams({state})}`;
	}

	getIdentities () {
		return this.#users.filter(user => !user.disabled).map(user => ({
			provider: this.slug, subject: user.id, handle: user.username, displayName: user.displayName,
		}));
	}

	hasIdentity (subject) {
		return this.#users.some(user => user.id === subject && !user.disabled);
	}

	async pVerifyCredentials ({username, password}) {
		const user = typeof username === "string" ? this.#users.find(candidate => candidate.username === username.toLowerCase()) : null;
		const [, salt, expected] = (user?.passwordHash || DUMMY_HASH).match(HASH_PATTERN);
		const key = await scrypt(typeof password === "string" && password.length <= 256 ? password : "", Buffer.from(salt, "hex"), 64);
		const matches = crypto.timingSafeEqual(key, Buffer.from(expected, "hex"));
		if (!matches || !user || user.disabled) return null;
		return {provider: this.slug, subject: user.id, handle: user.username, displayName: user.displayName};
	}
}

export async function provisionLocalAccounts ({store, provider}) {
	for (const identity of provider.getIdentities()) {
		await store.pUpsertOAuthAccount({
			provider: identity.provider, providerSubject: identity.subject, handle: identity.handle, displayName: identity.displayName,
		});
	}
}
