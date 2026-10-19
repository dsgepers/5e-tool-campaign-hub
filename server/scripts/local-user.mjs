import crypto from "node:crypto";
import {chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {createInterface} from "node:readline/promises";
import {Writable} from "node:stream";
import {parseArgs} from "node:util";
import {pathToFileURL} from "node:url";
import {hashLocalPassword, LocalPasswordProvider} from "../src/local-password-provider.js";

export async function saveLocalUser ({filePath, username, password, displayName = null}) {
	if (typeof username !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/i.test(username)) {
		throw new TypeError("Username must start with a letter and contain only letters, digits, dots, underscores or hyphens (up to 64 characters).");
	}
	const target = resolve(filePath);
	mkdirSync(dirname(target), {recursive: true, mode: 0o700});
	if ((statSync(dirname(target)).mode & 0o077) !== 0) {
		throw new Error("Store users in a private directory (permissions 0700), such as .hub/users.json.");
	}
	let document;
	try {
		document = JSON.parse(readFileSync(target, "utf8"));
		const validated = new LocalPasswordProvider(document);
		if (!validated.getIdentities().length) throw new Error("At least one enabled user is required.");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		document = {version: 1, users: []};
	}
	const normalizedUsername = username.toLowerCase();
	const existing = document.users.find(user => user.username.toLowerCase() === normalizedUsername);
	const user = {
		id: existing?.id || crypto.randomUUID(),
		username: normalizedUsername,
		displayName: displayName || existing?.displayName || username,
		passwordHash: await hashLocalPassword(password),
	};
	if (existing) Object.assign(existing, user);
	else document.users.push(user);
	const validated = new LocalPasswordProvider(document);
	if (!validated.getIdentities().length) throw new Error("At least one enabled user is required.");
	const temporary = `${target}.${crypto.randomUUID()}.tmp`;
	try {
		// The parent is private. A file bind mount lets the non-root BFF read this
		// file without exposing that host directory or baking hashes into an image.
		writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, {flag: "wx", mode: 0o644});
		chmodSync(temporary, 0o644);
		renameSync(temporary, target);
	} finally {
		// The target remains unchanged if writing or renaming failed.
		try { unlinkSync(temporary); } catch { /* Already renamed or no temporary file was created. */ }
	}
	return {id: user.id, username: normalizedUsername, filePath: target};
}

async function main () {
	const {values} = parseArgs({options: {
		username: {type: "string"},
		name: {type: "string"},
		file: {type: "string", default: ".hub/users.json"},
		"password-stdin": {type: "boolean", default: false},
	}});
	if (!values.username) throw new Error("Usage: npm run hub:user -- --username dennis [--name Dennis] [--password-stdin]");
	let password;
	if (values["password-stdin"]) {
		const chunks = [];
		let length = 0;
		for await (const chunk of process.stdin) {
			length += chunk.length;
			if (length > 1_024) throw new Error("Password input is too long.");
			chunks.push(chunk);
		}
		password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
	} else {
		if (!process.stdin.isTTY) throw new Error("Use an interactive terminal or supply the password with --password-stdin.");
		let muted = false;
		const output = new Writable({write (chunk, encoding, next) {
			if (!muted) process.stdout.write(chunk, encoding);
			next();
		}});
		const prompt = createInterface({input: process.stdin, output, terminal: true});
		const ask = async label => {
			const answer = prompt.question(label);
			muted = true;
			try { return await answer; } finally { muted = false; process.stdout.write("\n"); }
		};
		try {
			password = await ask("Password: ");
			if (password !== await ask("Repeat password: ")) throw new Error("Passwords did not match.");
		} finally { prompt.close(); }
	}
	const user = await saveLocalUser({filePath: values.file, username: values.username, displayName: values.name, password});
	process.stdout.write(`Saved local user ${user.username} in ${user.filePath}. Recreate the Hub BFF to load changes.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
