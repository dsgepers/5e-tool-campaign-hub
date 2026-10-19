const MAX_PROVIDER_COUNT = 10;

export const HUB_ACCOUNT_REAUTHENTICATION_TRIGGER = Object.freeze({
	INITIAL: "initial",
	MANUAL: "manual",
	LINK_REQUIRED: "link-required",
	UNLINK_REQUIRED: "unlink-required",
	OPERATOR_REQUIRED: "operator-required",
	DELETION_REQUIRED: "deletion-required",
	DELETION_PENDING: "deletion-pending",
});

const ACCOUNT_REAUTHENTICATION_TRIGGERS = new Set(Object.values(HUB_ACCOUNT_REAUTHENTICATION_TRIGGER));

export function setHubAccountReauthenticationPanelVisibility ({container, providers, trigger}) {
	if (!container?.classList || !ACCOUNT_REAUTHENTICATION_TRIGGERS.has(trigger)) {
		throw new Error("Account reauthentication panel state is invalid.");
	}
	const isVisible = trigger !== HUB_ACCOUNT_REAUTHENTICATION_TRIGGER.INITIAL && !!providers?.length;
	container.classList.toggle("ve-hidden", !isVisible);
	return isVisible;
}

function getProviders (metadata) {
	if (!Array.isArray(metadata?.authProviders) || metadata.authProviders.length > MAX_PROVIDER_COUNT) {
		throw new Error("Authentication providers are unavailable.");
	}
	return metadata.authProviders.map(provider => {
		if (
			!provider
			|| typeof provider.slug !== "string"
			|| !/^[a-z][a-z0-9-]{0,31}$/.test(provider.slug)
			|| typeof provider.label !== "string"
			|| !provider.label.trim()
			|| Array.from(provider.label.trim()).length > 50
			|| provider.startPath !== `/auth/${provider.slug}/start`
			|| !["available", "disabled", "configuration_error"].includes(provider.status)
		) throw new Error("Authentication providers are unavailable.");
		return {
			slug: provider.slug,
			label: provider.label.trim(),
			startPath: provider.startPath,
			status: provider.status,
		};
	});
}

function getNote ({documentRef, text}) {
	const note = documentRef.createElement("p");
	note.className = "hub-inline-status";
	note.setAttribute("role", "status");
	note.textContent = text;
	return note;
}

export async function pRenderHubAuthProviders ({
	signIn,
	returnTo,
	inviteToken = null,
	inviteRetry = null,
	pCreateInviteAdmission = null,
	pRetryInviteAdmission = null,
	onInviteStarted = () => {},
	onInviteRetryInvalid = () => {},
	onError = () => {},
	fnFetch = fetch,
	documentRef = document,
}) {
	if (!signIn) throw new Error("Authentication providers are unavailable.");
	signIn.removeAttribute("href");
	signIn.hidden = true;

	const response = await fnFetch("/api/meta", {
		headers: {accept: "application/json"},
		credentials: "same-origin",
	});
	if (!response?.ok) throw new Error("Authentication providers are unavailable.");
	const providers = getProviders(await response.json());
	const available = providers.filter(provider =>
		provider.status === "available"
		&& (!inviteRetry || provider.slug === inviteRetry.provider),
	);
	if (!available.length) {
		if (inviteRetry) return onInviteRetryInvalid();
		throw new Error("Authentication providers are unavailable.");
	}

	const group = documentRef.createElement("div");
	group.className = "hub-button-row hub-button-row--centered";
	group.setAttribute("role", "group");
	group.setAttribute("aria-label", "Sign-in providers");
	for (const provider of available) {
		const isInviteFlow = !!(inviteToken || inviteRetry);
		const link = documentRef.createElement(isInviteFlow ? "button" : "a");
		link.className = "hub-button hub-button--primary";
		if (isInviteFlow) {
			link.type = "button";
			link.addEventListener("click", async () => {
				for (const control of group.querySelectorAll("button")) control.disabled = true;
				try {
					const result = inviteRetry
						? await pRetryInviteAdmission({
							retryToken: inviteRetry.retryToken,
							provider: provider.slug,
							returnTo,
						})
						: await pCreateInviteAdmission({
							token: inviteToken,
							provider: provider.slug,
							returnTo,
						});
					onInviteStarted({provider: provider.slug, retryToken: result.retryToken});
					window.location.assign(result.authorizationUrl);
				} catch (error) {
					for (const control of group.querySelectorAll("button")) control.disabled = false;
					if (inviteRetry && error?.code === "INVITE_ADMISSION_INVALID") {
						onInviteRetryInvalid();
						return;
					}
					onError(error);
				}
			});
		} else {
			link.href = `${provider.startPath}?${new URLSearchParams({returnTo})}`;
		}
		link.textContent = provider.slug === "local" ? "Sign in with username and password" : `Sign in with ${provider.label}`;
		group.append(link);
	}
	signIn.replaceWith(group);

	if (available.length > 1) {
		group.after(getNote({
			documentRef,
			text: "Already have a Hub account? Sign in with a provider already linked to it. New provider links will require account reauthentication when that flow is enabled.",
		}));
	}
	if (providers.some(provider => provider.status === "configuration_error")) {
		group.after(getNote({
			documentRef,
			text: "One sign-in provider is temporarily unavailable. Other sign-in options remain available.",
		}));
	}
}
